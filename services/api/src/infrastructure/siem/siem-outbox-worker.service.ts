import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { SiemAuditOutboxStoreService, type DurableSiemAuditWorkItem } from "./siem-audit-outbox-store.service";
import { SiemEventPresenterService } from "./siem-event-presenter.service";
import { SiemGatewayHttpError, SiemGatewayService } from "./siem-gateway.service";

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_RETRY_BASE_SECONDS = 5;
const MAX_RETRY_SECONDS = 15 * 60;

export interface SiemWorkerConfiguration {
  enabled: boolean;
  pollMs: number;
  leaseSeconds: number;
  batchSize: number;
  maxAttempts: number;
  retryBaseSeconds: number;
}

export interface SiemWorkerRunResult {
  claimed: number;
  exported: number;
  requeued: number;
  failed: number;
}

export function siemWorkerConfiguration(env: NodeJS.ProcessEnv = process.env): SiemWorkerConfiguration {
  const enabled = booleanEnv(env.SIEM_WORKER_ENABLED, true, "SIEM_WORKER_ENABLED");
  if (env.NODE_ENV === "production" && !enabled) {
    throw new Error("SIEM_WORKER_ENABLED=false is forbidden in production for Phase C9 durable audit forwarding.");
  }
  return {
    enabled,
    pollMs: integerEnv(env.SIEM_WORKER_POLL_MS, DEFAULT_POLL_MS, 100, 60_000, "SIEM_WORKER_POLL_MS"),
    leaseSeconds: integerEnv(env.SIEM_WORKER_LEASE_SECONDS, DEFAULT_LEASE_SECONDS, 60, 1_800, "SIEM_WORKER_LEASE_SECONDS"),
    batchSize: integerEnv(env.SIEM_WORKER_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 200, "SIEM_WORKER_BATCH_SIZE"),
    maxAttempts: integerEnv(env.SIEM_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 50, "SIEM_MAX_ATTEMPTS"),
    retryBaseSeconds: integerEnv(env.SIEM_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS, 1, 300, "SIEM_RETRY_BASE_SECONDS"),
  };
}

@Injectable()
export class SiemOutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId = `siem-${process.pid}-${randomBytes(8).toString("hex")}`;
  private timer: ReturnType<typeof setInterval> | undefined;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(
    private readonly store: SiemAuditOutboxStoreService,
    private readonly presenter: SiemEventPresenterService,
    private readonly gateway: SiemGatewayService,
  ) {}

  onModuleInit(): void {
    const config = siemWorkerConfiguration();
    this.gateway.assertProductionReady();
    if (!config.enabled) return;
    this.timer = setInterval(() => void this.runOnce(), config.pollMs);
    this.timer.unref?.();
    this.wake();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
  }

  wake(): void {
    if (this.wakeTimer || !siemWorkerConfiguration().enabled) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      void this.runOnce();
    }, 0);
    this.wakeTimer.unref?.();
  }

  async runOnce(): Promise<SiemWorkerRunResult> {
    const result: SiemWorkerRunResult = { claimed: 0, exported: 0, requeued: 0, failed: 0 };
    if (this.running) return result;
    const config = siemWorkerConfiguration();
    if (!config.enabled) return result;
    this.running = true;
    try {
      const candidates = await this.store.recoverable(config.batchSize);
      for (const candidate of candidates) {
        const item = await this.store.claim(candidate.id, this.workerId, config.leaseSeconds);
        if (!item) continue;
        result.claimed += 1;
        await this.process(item, config, result);
      }
    } catch {
      // PostgreSQL remains the durable source of truth; a poll failure must not terminate the API.
    } finally {
      this.running = false;
    }
    return result;
  }

  private async process(item: DurableSiemAuditWorkItem, config: SiemWorkerConfiguration, result: SiemWorkerRunResult): Promise<void> {
    try {
      const actorRole = await this.store.actorRole(item.auditEvent.actorId);
      const payload = this.presenter.present({ ...item.auditEvent, actorRole });
      await this.gateway.send(payload);
      if (await this.store.markExported(item.id, this.workerId)) result.exported += 1;
    } catch (error) {
      const errorCode = this.safeErrorCode(error);
      if (item.attemptCount >= config.maxAttempts) {
        if (await this.store.markFailed(item.id, this.workerId, errorCode)) result.failed += 1;
        return;
      }
      const delaySeconds = Math.min(
        MAX_RETRY_SECONDS,
        config.retryBaseSeconds * (2 ** Math.max(0, item.attemptCount - 1)),
      );
      const availableAt = new Date(Date.now() + delaySeconds * 1000);
      if (await this.store.requeue(item.id, this.workerId, availableAt, errorCode)) result.requeued += 1;
    }
  }

  private safeErrorCode(error: unknown): string {
    if (error instanceof SiemGatewayHttpError) return `SiemGatewayHttpError:${error.statusCode}`;
    const name = error instanceof Error ? error.constructor.name : "SiemExportError";
    const normalized = name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80);
    return normalized || "SiemExportError";
  }
}

function integerEnv(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}

function booleanEnv(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (!raw?.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
