import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { NotificationGatewayService } from "./notification-gateway.service";
import {
  NotificationOutboxStoreService,
  type DurableNotificationWorkItem,
} from "./notification-outbox-store.service";

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_SECONDS = 5;
const MAX_RETRY_SECONDS = 15 * 60;

export interface NotificationWorkerConfiguration {
  enabled: boolean;
  pollMs: number;
  leaseSeconds: number;
  batchSize: number;
  maxAttempts: number;
  retryBaseSeconds: number;
}

export interface NotificationWorkerRunResult {
  claimed: number;
  sent: number;
  skipped: number;
  requeued: number;
  failed: number;
}

export function notificationWorkerConfiguration(env: NodeJS.ProcessEnv = process.env): NotificationWorkerConfiguration {
  const enabled = booleanEnv(env.NOTIFICATION_WORKER_ENABLED, true, "NOTIFICATION_WORKER_ENABLED");
  if (env.NODE_ENV === "production" && !enabled) {
    throw new Error("NOTIFICATION_WORKER_ENABLED=false is forbidden in production for the C7 in-process outbox worker.");
  }
  return {
    enabled,
    pollMs: integerEnv(env.NOTIFICATION_WORKER_POLL_MS, DEFAULT_POLL_MS, 100, 60_000, "NOTIFICATION_WORKER_POLL_MS"),
    leaseSeconds: integerEnv(env.NOTIFICATION_WORKER_LEASE_SECONDS, DEFAULT_LEASE_SECONDS, 60, 1_800, "NOTIFICATION_WORKER_LEASE_SECONDS"),
    batchSize: integerEnv(env.NOTIFICATION_WORKER_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 100, "NOTIFICATION_WORKER_BATCH_SIZE"),
    maxAttempts: integerEnv(env.NOTIFICATION_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 20, "NOTIFICATION_MAX_ATTEMPTS"),
    retryBaseSeconds: integerEnv(env.NOTIFICATION_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS, 1, 300, "NOTIFICATION_RETRY_BASE_SECONDS"),
  };
}

@Injectable()
export class NotificationOutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId = `notification-${process.pid}-${randomBytes(8).toString("hex")}`;
  private timer?: ReturnType<typeof setInterval>;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(
    private readonly store: NotificationOutboxStoreService,
    private readonly gateway: NotificationGatewayService,
    private readonly audit: DatabaseAuditService,
  ) {}

  onModuleInit(): void {
    const config = notificationWorkerConfiguration();
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
    if (this.wakeTimer || !notificationWorkerConfiguration().enabled) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      void this.runOnce();
    }, 0);
    this.wakeTimer.unref?.();
  }

  async runOnce(): Promise<NotificationWorkerRunResult> {
    const result: NotificationWorkerRunResult = { claimed: 0, sent: 0, skipped: 0, requeued: 0, failed: 0 };
    if (this.running) return result;
    const config = notificationWorkerConfiguration();
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
      // A polling failure must not terminate the API. Unclaimed/leased work remains durable in PostgreSQL.
    } finally {
      this.running = false;
    }
    return result;
  }

  private async process(
    item: DurableNotificationWorkItem,
    config: NotificationWorkerConfiguration,
    result: NotificationWorkerRunResult,
  ): Promise<void> {
    try {
      const routing = await this.store.routingContext(item);
      if (!routing.enabled) {
        if (await this.store.markSkipped(item.id, this.workerId)) result.skipped += 1;
        return;
      }
      if (item.channel === "IN_APP") {
        if (await this.store.markSent(item.id, this.workerId)) result.sent += 1;
        return;
      }
      if (!routing.destinationRef) {
        if (await this.store.markSkipped(item.id, this.workerId)) result.skipped += 1;
        return;
      }

      const sent = await this.gateway.send({
        notificationId: item.notificationId,
        channel: item.channel,
        destinationRef: routing.destinationRef,
        locale: routing.locale,
        safeTitleKey: item.notification.safeTitleKey,
        safeBodyKey: item.notification.safeBodyKey,
        entityType: item.notification.entityType,
        entityId: item.notification.entityId,
      });
      if (await this.store.markSent(item.id, this.workerId, sent.reference)) result.sent += 1;
    } catch (error) {
      const errorCode = this.safeErrorCode(error);
      if (item.attemptCount >= config.maxAttempts) {
        if (await this.store.markFailed(item.id, this.workerId, errorCode)) {
          result.failed += 1;
          await this.audit.write({
            actorId: "notification-outbox-worker",
            action: "NOTIFICATION_DELIVERY_EXHAUSTED",
            objectType: "NOTIFICATION_DELIVERY",
            objectId: item.id,
            purpose: "SYSTEM_ACCESS",
            result: "FAILED",
            metadata: { channel: item.channel, attemptCount: item.attemptCount, errorCode },
          }).catch(() => undefined);
        }
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
    const name = error instanceof Error ? error.constructor.name : "DeliveryError";
    const normalized = name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80);
    return normalized || "DeliveryError";
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
