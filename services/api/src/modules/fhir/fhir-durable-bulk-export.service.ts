import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { randomToken, type AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";
import { SmartConfigurationService } from "../../security/smart-configuration.service";
import type { SmartAccessContext } from "../../security/smart-token.service";
import { FhirBulkExportJobStoreService, type DurableBulkJobRecord } from "./fhir-bulk-export-job-store.service";
import { FhirBulkExportStorageService } from "./fhir-bulk-export-storage.service";
import { FhirBulkExportService, type BulkExportDownload, type BulkExportPollResult } from "./fhir-bulk-export.service";
import { FhirSearchSupportService, type FhirSearchQuery } from "./fhir-search-support.service";
import { FhirSystemService } from "./fhir-system.service";

const LEGACY_STATE_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_WORKER_POLL_MS = 2_000;
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_SECONDS = 5;
const DEFAULT_CLEANUP_INTERVAL_SECONDS = 60;

@Injectable()
export class FhirDurableBulkExportService extends FhirBulkExportService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId = `bulk-${process.pid}-${randomToken(8)}`;
  private workerTimer?: ReturnType<typeof setInterval>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private cleaning = false;

  constructor(
    redis: RedisSecurityService,
    audit: DatabaseAuditService,
    config: SmartConfigurationService,
    support: FhirSearchSupportService,
    system: FhirSystemService,
    storage: FhirBulkExportStorageService,
    private readonly jobs: FhirBulkExportJobStoreService,
    private readonly durableRedis: RedisSecurityService,
    private readonly durableAudit: DatabaseAuditService,
    private readonly durableStorage: FhirBulkExportStorageService,
  ) {
    super(redis, audit, config, support, system, storage);
  }

  onModuleInit(): void {
    if (process.env.BULK_EXPORT_WORKER_ENABLED === "false") return;
    const pollMs = this.integerEnv("BULK_EXPORT_WORKER_POLL_MS", DEFAULT_WORKER_POLL_MS, 250, 60_000);
    this.workerTimer = setInterval(() => void this.tick(), pollMs);
    this.workerTimer.unref?.();
    const cleanupMs = this.integerEnv(
      "BULK_EXPORT_CLEANUP_INTERVAL_SECONDS",
      DEFAULT_CLEANUP_INTERVAL_SECONDS,
      5,
      86_400,
    ) * 1000;
    this.cleanupTimer = setInterval(() => void this.cleanup(), cleanupMs);
    this.cleanupTimer.unref?.();
    setTimeout(() => void this.tick(), 0);
    setTimeout(() => void this.cleanup(), 0);
  }

  onModuleDestroy(): void {
    if (this.workerTimer) clearInterval(this.workerTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  override async kickoff(
    context: SmartAccessContext,
    query: FhirSearchQuery,
    preferHeader: string | undefined,
    acceptHeader: string | undefined,
  ): Promise<{ jobId: string; contentLocation: string }> {
    const result = await super.kickoff(context, query, preferHeader, acceptHeader);
    await this.capture(result.jobId);
    return result;
  }

  override async poll(context: SmartAccessContext, jobId: string): Promise<BulkExportPollResult> {
    await this.restore(jobId);
    try {
      return await super.poll(context, jobId);
    } finally {
      await this.capture(jobId).catch(() => undefined);
      this.captureSoon(jobId);
    }
  }

  override async cancel(context: SmartAccessContext, jobId: string): Promise<void> {
    await this.restore(jobId);
    await super.cancel(context, jobId);
    await this.jobs.remove(jobId);
  }

  override async download(context: SmartAccessContext, jobId: string, fileName: string): Promise<BulkExportDownload> {
    await this.restore(jobId);
    try {
      return await super.download(context, jobId, fileName);
    } finally {
      await this.capture(jobId).catch(() => undefined);
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const batchSize = this.integerEnv("BULK_EXPORT_WORKER_BATCH_SIZE", DEFAULT_BATCH_SIZE, 1, 100);
      await this.scheduleRetries(batchSize);
      const candidates = await this.jobs.recoverable(batchSize);
      for (const candidate of candidates) await this.recover(candidate);
    } catch {
      // Worker failures must not terminate the API process. Per-job failures are audited by the export engine.
    } finally {
      this.ticking = false;
    }
  }

  private async recover(candidate: DurableBulkJobRecord): Promise<void> {
    const leaseSeconds = this.integerEnv("BULK_EXPORT_WORKER_LEASE_SECONDS", DEFAULT_LEASE_SECONDS, 30, 1_800);
    const claimed = await this.jobs.claim(candidate.id, this.workerId, leaseSeconds);
    if (!claimed) return;
    try {
      const currentLegacy = await this.durableRedis.getEphemeral(this.legacyKey(claimed.id));
      if (currentLegacy) {
        const synced = await this.jobs.syncFromLegacy(claimed.id, LEGACY_STATE_TTL_SECONDS);
        if (synced && (synced.status === "COMPLETED" || synced.status === "FAILED")) return;
      } else {
        await this.jobs.restoreLegacy(claimed);
      }
      const context = this.context(claimed);
      await super.poll(context, claimed.id).catch(() => undefined);
      this.captureSoon(claimed.id, this.workerId);
    } finally {
      // The short delayed capture normally releases the lease. If the process crashes first,
      // lease expiry makes the job recoverable by another instance.
    }
  }

  private async scheduleRetries(limit: number): Promise<void> {
    const maxAttempts = this.integerEnv("BULK_EXPORT_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, 1, 10);
    const baseSeconds = this.integerEnv("BULK_EXPORT_RETRY_BASE_SECONDS", DEFAULT_RETRY_BASE_SECONDS, 1, 300);
    const failures = await this.jobs.retryableFailures(limit, maxAttempts);
    for (const failure of failures) {
      const exponent = Math.max(0, failure.attemptCount);
      const delaySeconds = Math.min(300, baseSeconds * (2 ** exponent));
      const availableAt = new Date(Date.now() + delaySeconds * 1000);
      await this.jobs.requeue(failure, availableAt);
      await this.durableAudit.write({
        actorId: `smart-system:${failure.clientId}`,
        action: "FHIR_BULK_EXPORT_RETRY_SCHEDULED",
        objectType: "FHIR_BULK_EXPORT_JOB",
        objectId: failure.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          clientId: failure.clientId,
          attemptCount: failure.attemptCount,
          availableAt: availableAt.toISOString(),
        },
      });
    }
  }

  private async cleanup(): Promise<void> {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const batchSize = this.integerEnv("BULK_EXPORT_CLEANUP_BATCH_SIZE", 25, 1, 200);
      const expired = await this.jobs.expired(batchSize);
      for (const record of expired) {
        for (const objectKey of this.artifactKeys(record.payload)) {
          await this.durableStorage.remove(objectKey).catch(() => undefined);
        }
        await this.jobs.remove(record.id);
        await this.durableAudit.write({
          actorId: `smart-system:${record.clientId}`,
          action: "FHIR_BULK_EXPORT_EXPIRED_CLEANUP",
          objectType: "FHIR_BULK_EXPORT_JOB",
          objectId: record.id,
          purpose: "SYSTEM_ACCESS",
          result: "SUCCESS",
          metadata: { clientId: record.clientId },
        });
      }
    } catch {
      // Storage lifecycle remains a production defense-in-depth fallback for cleanup failures.
    } finally {
      this.cleaning = false;
    }
  }

  private async capture(jobId: string): Promise<DurableBulkJobRecord | null> {
    return this.jobs.syncFromLegacy(jobId, LEGACY_STATE_TTL_SECONDS);
  }

  private async restore(jobId: string): Promise<void> {
    const existing = await this.durableRedis.getEphemeral(this.legacyKey(jobId));
    if (existing) {
      await this.capture(jobId);
      return;
    }
    const record = await this.jobs.get(jobId);
    if (record) await this.jobs.restoreLegacy(record);
  }

  private captureSoon(jobId: string, leaseOwner?: string): void {
    setTimeout(() => {
      void (async () => {
        await this.capture(jobId).catch(() => undefined);
        if (leaseOwner) await this.jobs.releaseLease(jobId, leaseOwner).catch(() => undefined);
      })();
    }, 500).unref?.();
  }

  private context(record: DurableBulkJobRecord): SmartAccessContext {
    const payload = this.objectPayload(record.payload);
    const tokenId = typeof payload.kickoffTokenId === "string" ? payload.kickoffTokenId : `durable-${record.id}`;
    const scopes = Array.isArray(payload.authorizedScopes)
      ? payload.authorizedScopes.filter((value): value is string => typeof value === "string")
      : [];
    const createdAt = typeof payload.createdAt === "string" ? payload.createdAt : new Date().toISOString();
    const principal: AuthPrincipal = {
      accountId: `smart-system:${record.clientId}`,
      role: "SUPPORT",
      sessionId: tokenId,
    };
    return {
      principal,
      authorizationType: "system",
      tokenId,
      clientId: record.clientId,
      patientId: null,
      scopes,
      expiresAt: createdAt,
    };
  }

  private artifactKeys(payload: unknown): string[] {
    const object = this.objectPayload(payload);
    if (!Array.isArray(object.artifacts)) return [];
    return object.artifacts.flatMap((artifact) => {
      const item = this.objectPayload(artifact);
      return typeof item.objectKey === "string" ? [item.objectKey] : [];
    });
  }

  private objectPayload(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private integerEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return value;
  }

  private legacyKey(jobId: string): string {
    return `carepoint:fhir:bulk-export:${jobId}`;
  }
}
