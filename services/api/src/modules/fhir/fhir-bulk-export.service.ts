import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { randomToken, type AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";
import { SmartConfigurationService } from "../../security/smart-configuration.service";
import type { SmartAccessContext } from "../../security/smart-token.service";
import { FhirBulkExportStorageService } from "./fhir-bulk-export-storage.service";
import { FhirSearchSupportService, type FhirSearchQuery } from "./fhir-search-support.service";
import { FhirSystemService, type FhirBulkResourceType } from "./fhir-system.service";

const QUEUED_JOB_TTL_SECONDS = 2 * 60 * 60;
const PROCESSING_LOCK_TTL_SECONDS = 5 * 60;
const DEFAULT_RETENTION_SECONDS = 24 * 60 * 60;
const MAX_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_MAX_RESOURCES_PER_TYPE = 10_000;
const MAX_RESOURCES_PER_TYPE = 50_000;
const OUTPUT_FORMAT = "application/fhir+ndjson";
const SUPPORTED_TYPES: readonly FhirBulkResourceType[] = ["Patient", "Appointment"];

type BulkExportStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

interface BulkExportArtifact {
  type: FhirBulkResourceType;
  objectKey: string;
  count: number;
  bytes: number;
  sha256: string;
}

interface BulkExportJob {
  version: 1;
  jobId: string;
  clientId: string;
  kickoffTokenId: string;
  authorizedScopes: string[];
  resourceTypes: FhirBulkResourceType[];
  since: string | null;
  outputFormat: typeof OUTPUT_FORMAT;
  status: BulkExportStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  transactionTime: string | null;
  expiresAt: string | null;
  artifacts: BulkExportArtifact[];
  error: string | null;
}

export type BulkExportPollResult =
  | { state: "in-progress"; progress: string; retryAfterSeconds: number }
  | { state: "complete"; manifest: Record<string, unknown>; expiresAt: string };

export interface BulkExportDownload {
  content: string;
  fileName: string;
  expiresAt: string;
}

@Injectable()
export class FhirBulkExportService {
  constructor(
    private readonly redis: RedisSecurityService,
    private readonly audit: DatabaseAuditService,
    private readonly config: SmartConfigurationService,
    private readonly support: FhirSearchSupportService,
    private readonly system: FhirSystemService,
    private readonly storage: FhirBulkExportStorageService,
  ) {}

  async kickoff(
    context: SmartAccessContext,
    query: FhirSearchQuery,
    preferHeader: string | undefined,
    acceptHeader: string | undefined,
  ): Promise<{ jobId: string; contentLocation: string }> {
    this.assertSystem(context);
    this.assertPrefer(preferHeader);
    this.assertAccept(acceptHeader);
    this.support.assertAllowed(query, ["_outputFormat", "_type", "_since"]);

    const outputFormat = this.outputFormat(this.support.optional(query, "_outputFormat"));
    const requestedTypes = this.resourceTypes(context, this.support.tokens(query, "_type"));
    const since = this.since(this.support.optional(query, "_since"));
    const jobId = randomToken(24);
    const createdAt = new Date().toISOString();
    const job: BulkExportJob = {
      version: 1,
      jobId,
      clientId: context.clientId,
      kickoffTokenId: context.tokenId,
      authorizedScopes: [...context.scopes],
      resourceTypes: requestedTypes,
      since: since?.toISOString() ?? null,
      outputFormat,
      status: "QUEUED",
      createdAt,
      startedAt: null,
      completedAt: null,
      transactionTime: null,
      expiresAt: null,
      artifacts: [],
      error: null,
    };
    await this.saveJob(job, QUEUED_JOB_TTL_SECONDS);
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_BULK_EXPORT_KICKOFF",
      objectType: "FHIR_BULK_EXPORT_JOB",
      objectId: jobId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: {
        clientId: context.clientId,
        tokenId: context.tokenId,
        resourceTypes: requestedTypes,
        since: job.since,
        outputFormat,
      },
    });
    setTimeout(() => void this.process(jobId), 0);
    return { jobId, contentLocation: this.statusUrl(jobId) };
  }

  async poll(context: SmartAccessContext, jobId: string): Promise<BulkExportPollResult> {
    const job = await this.authorizedJob(context, jobId);
    if (job.status === "FAILED") throw new InternalServerErrorException(job.error ?? "FHIR bulk export processing failed.");
    if (job.status === "QUEUED" || job.status === "RUNNING") {
      setTimeout(() => void this.process(job.jobId), 0);
      await this.audit.write({
        actorId: context.principal.accountId,
        action: "FHIR_BULK_EXPORT_STATUS",
        objectType: "FHIR_BULK_EXPORT_JOB",
        objectId: job.jobId,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: { clientId: context.clientId, tokenId: context.tokenId, status: job.status },
      });
      return { state: "in-progress", progress: job.status === "QUEUED" ? "queued" : "in progress", retryAfterSeconds: 2 };
    }

    this.assertNotExpired(job);
    const expiresAt = job.expiresAt as string;
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_BULK_EXPORT_STATUS",
      objectType: "FHIR_BULK_EXPORT_JOB",
      objectId: job.jobId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { clientId: context.clientId, tokenId: context.tokenId, status: job.status, outputCount: job.artifacts.length },
    });
    return { state: "complete", manifest: this.manifest(job), expiresAt };
  }

  async cancel(context: SmartAccessContext, jobId: string): Promise<void> {
    const job = await this.authorizedJob(context, jobId);
    await this.redis.setEphemeral(this.cancelKey(job.jobId), "cancelled", QUEUED_JOB_TTL_SECONDS);
    await this.removeArtifacts(job.artifacts);
    await this.redis.deleteEphemeral(this.jobKey(job.jobId));
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_BULK_EXPORT_CANCELLED",
      objectType: "FHIR_BULK_EXPORT_JOB",
      objectId: job.jobId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { clientId: context.clientId, tokenId: context.tokenId, previousStatus: job.status },
    });
  }

  async download(context: SmartAccessContext, jobId: string, fileName: string): Promise<BulkExportDownload> {
    const job = await this.authorizedJob(context, jobId);
    if (job.status !== "COMPLETED") throw new ConflictException("FHIR bulk export files are not available until the job completes.");
    this.assertNotExpired(job);
    const resourceType = this.fileResourceType(fileName);
    const artifact = job.artifacts.find((item) => item.type === resourceType);
    if (!artifact) throw new NotFoundException("FHIR bulk export file not found.");
    const content = await this.storage.get(artifact.objectKey);
    const digest = createHash("sha256").update(content, "utf8").digest("hex");
    if (digest !== artifact.sha256 || Buffer.byteLength(content, "utf8") !== artifact.bytes) {
      await this.audit.write({
        actorId: context.principal.accountId,
        action: "FHIR_BULK_EXPORT_INTEGRITY_FAILURE",
        objectType: "FHIR_BULK_EXPORT_JOB",
        objectId: job.jobId,
        purpose: "SYSTEM_ACCESS",
        result: "FAILED",
        metadata: { clientId: context.clientId, resourceType },
      });
      throw new InternalServerErrorException("FHIR bulk export file integrity validation failed.");
    }
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_BULK_EXPORT_FILE_DOWNLOADED",
      objectType: "FHIR_BULK_EXPORT_JOB",
      objectId: job.jobId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { clientId: context.clientId, tokenId: context.tokenId, resourceType, count: artifact.count, bytes: artifact.bytes },
    });
    return { content, fileName: `${resourceType}.ndjson`, expiresAt: job.expiresAt as string };
  }

  private async process(jobId: string): Promise<void> {
    if (!this.validJobId(jobId)) return;
    const lockKey = this.lockKey(jobId);
    const claimed = await this.redis.setEphemeralIfAbsent(lockKey, "processing", PROCESSING_LOCK_TTL_SECONDS);
    if (!claimed) return;

    let written: BulkExportArtifact[] = [];
    try {
      const raw = await this.redis.getEphemeral(this.jobKey(jobId));
      if (!raw || await this.redis.getEphemeral(this.cancelKey(jobId))) return;
      const job = this.parseJob(raw);
      if (job.status === "COMPLETED" || job.status === "FAILED") return;
      const registeredClient = this.config.backendClient(job.clientId);
      if (!registeredClient || !job.authorizedScopes.every((scope) => registeredClient.allowedScopes.includes(scope))) {
        throw new ForbiddenException("SMART backend client authorization changed before bulk export processing completed.");
      }

      const running: BulkExportJob = { ...job, status: "RUNNING", startedAt: job.startedAt ?? new Date().toISOString(), error: null };
      await this.saveJob(running, QUEUED_JOB_TTL_SECONDS);
      const context = this.jobContext(running);
      const snapshot = await this.system.bulkExportSnapshot(
        context,
        running.resourceTypes,
        running.since ? new Date(running.since) : null,
        this.maxResourcesPerType(),
      );
      const retentionSeconds = this.retentionSeconds();
      const completedAt = new Date();
      const expiresAt = new Date(completedAt.getTime() + retentionSeconds * 1000).toISOString();

      for (const resourceType of running.resourceTypes) {
        if (await this.redis.getEphemeral(this.cancelKey(jobId))) {
          await this.removeArtifacts(written);
          return;
        }
        const resources = snapshot.resources[resourceType] ?? [];
        if (resources.length === 0) continue;
        const content = `${resources.map((resource) => JSON.stringify(resource)).join("\n")}\n`;
        const objectKey = `${jobId}/${resourceType}.ndjson`;
        const artifact: BulkExportArtifact = {
          type: resourceType,
          objectKey,
          count: resources.length,
          bytes: Buffer.byteLength(content, "utf8"),
          sha256: createHash("sha256").update(content, "utf8").digest("hex"),
        };
        await this.storage.put(objectKey, content, expiresAt);
        written.push(artifact);
      }

      if (await this.redis.getEphemeral(this.cancelKey(jobId))) {
        await this.removeArtifacts(written);
        return;
      }
      const completed: BulkExportJob = {
        ...running,
        status: "COMPLETED",
        completedAt: completedAt.toISOString(),
        transactionTime: snapshot.transactionTime,
        expiresAt,
        artifacts: written,
        error: null,
      };
      await this.saveJob(completed, retentionSeconds);
      await this.audit.write({
        actorId: context.principal.accountId,
        action: "FHIR_BULK_EXPORT_COMPLETED",
        objectType: "FHIR_BULK_EXPORT_JOB",
        objectId: jobId,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          clientId: completed.clientId,
          resourceTypes: completed.resourceTypes,
          transactionTime: completed.transactionTime,
          expiresAt,
          output: written.map((item) => ({ type: item.type, count: item.count, bytes: item.bytes, sha256: item.sha256 })),
        },
      });
    } catch (error) {
      await this.removeArtifacts(written);
      if (!(await this.redis.getEphemeral(this.cancelKey(jobId)))) {
        const currentRaw = await this.redis.getEphemeral(this.jobKey(jobId));
        if (currentRaw) {
          const current = this.parseJob(currentRaw);
          const safeError = error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException
            ? error.message
            : "FHIR bulk export processing failed.";
          const failed: BulkExportJob = { ...current, status: "FAILED", error: safeError, completedAt: new Date().toISOString(), artifacts: [] };
          await this.saveJob(failed, QUEUED_JOB_TTL_SECONDS);
          await this.audit.write({
            actorId: `smart-system:${current.clientId}`,
            action: "FHIR_BULK_EXPORT_FAILED",
            objectType: "FHIR_BULK_EXPORT_JOB",
            objectId: jobId,
            purpose: "SYSTEM_ACCESS",
            result: "FAILED",
            metadata: { clientId: current.clientId, error: safeError },
          });
        }
      }
    } finally {
      await this.redis.deleteEphemeral(lockKey).catch(() => undefined);
    }
  }

  private manifest(job: BulkExportJob): Record<string, unknown> {
    if (!job.transactionTime || !job.expiresAt) throw new InternalServerErrorException("FHIR bulk export completion state is invalid.");
    return {
      manifestType: "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export",
      transactionTime: job.transactionTime,
      requiresAccessToken: true,
      outputFormat: OUTPUT_FORMAT,
      output: job.artifacts.map((artifact) => ({
        type: artifact.type,
        url: this.fileUrl(job.jobId, artifact.type),
        count: artifact.count,
      })),
      error: [],
    };
  }

  private async authorizedJob(context: SmartAccessContext, jobId: string): Promise<BulkExportJob> {
    this.assertSystem(context);
    if (!this.validJobId(jobId)) throw new NotFoundException("FHIR bulk export job not found.");
    const raw = await this.redis.getEphemeral(this.jobKey(jobId));
    if (!raw) throw new NotFoundException("FHIR bulk export job not found.");
    const job = this.parseJob(raw);
    if (job.clientId !== context.clientId) {
      await this.audit.write({
        actorId: context.principal.accountId,
        action: "FHIR_BULK_EXPORT_CLIENT_DENIED",
        objectType: "FHIR_BULK_EXPORT_JOB",
        objectId: jobId,
        purpose: "SYSTEM_ACCESS",
        result: "DENIED",
        metadata: { clientId: context.clientId, ownerClientId: job.clientId },
      });
      throw new ForbiddenException("FHIR bulk export job belongs to another SMART backend client.");
    }
    for (const resourceType of job.resourceTypes) this.assertTypeScope(context.scopes, resourceType);
    return job;
  }

  private resourceTypes(context: SmartAccessContext, requested: string[]): FhirBulkResourceType[] {
    if (requested.length === 0) {
      const authorized = SUPPORTED_TYPES.filter((type) => this.hasTypeScope(context.scopes, type));
      if (authorized.length === 0) throw new ForbiddenException("SMART backend token has no exportable system resource scopes.");
      return [...authorized];
    }
    const unique: FhirBulkResourceType[] = [];
    for (const value of requested) {
      if (value !== "Patient" && value !== "Appointment") throw new BadRequestException(`FHIR bulk export does not support resource type '${value}'.`);
      this.assertTypeScope(context.scopes, value);
      if (!unique.includes(value)) unique.push(value);
    }
    return unique;
  }

  private assertTypeScope(scopes: string[], resourceType: FhirBulkResourceType): void {
    if (!this.hasTypeScope(scopes, resourceType)) {
      throw new ForbiddenException(`SMART backend token does not grant read/search access required to bulk export ${resourceType}.`);
    }
  }

  private hasTypeScope(scopes: string[], resourceType: FhirBulkResourceType): boolean {
    return scopes.some((scope) => {
      const match = new RegExp(`^system\\/${resourceType}\\.([cruds]+)$`).exec(scope);
      return Boolean(match?.[1]?.includes("r") && match[1].includes("s"));
    });
  }

  private outputFormat(value: string | null): typeof OUTPUT_FORMAT {
    if (!value) return OUTPUT_FORMAT;
    const normalized = value.toLowerCase();
    if (!["application/fhir+ndjson", "application/ndjson", "ndjson"].includes(normalized)) {
      throw new BadRequestException(`Unsupported FHIR bulk export _outputFormat '${value}'.`);
    }
    return OUTPUT_FORMAT;
  }

  private since(value: string | null): Date | null {
    if (!value) return null;
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime()) || !/^\d{4}-\d{2}-\d{2}t/i.test(value)) {
      throw new BadRequestException("FHIR bulk export _since must be a valid FHIR instant.");
    }
    if (instant.getTime() > Date.now()) throw new BadRequestException("FHIR bulk export _since must not be in the future.");
    return instant;
  }

  private assertPrefer(value: string | undefined): void {
    const preferences = (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!preferences.includes("respond-async")) throw new BadRequestException("FHIR bulk export requires Prefer: respond-async.");
  }

  private assertAccept(value: string | undefined): void {
    if (!value) return;
    const accepted = value.toLowerCase();
    if (!accepted.includes("application/fhir+json") && !accepted.includes("application/json") && !accepted.includes("*/*")) {
      throw new BadRequestException("FHIR bulk export kickoff supports application/fhir+json response negotiation only.");
    }
  }

  private assertSystem(context: SmartAccessContext): void {
    if (context.authorizationType !== "system") throw new ForbiddenException("FHIR bulk export requires a SMART backend-services token.");
  }

  private assertNotExpired(job: BulkExportJob): void {
    if (!job.expiresAt || new Date(job.expiresAt).getTime() <= Date.now()) throw new NotFoundException("FHIR bulk export job has expired.");
  }

  private fileResourceType(fileName: string): FhirBulkResourceType {
    const match = /^(Patient|Appointment)\.ndjson$/.exec(fileName);
    if (!match) throw new NotFoundException("FHIR bulk export file not found.");
    return match[1] as FhirBulkResourceType;
  }

  private jobContext(job: BulkExportJob): SmartAccessContext {
    const principal: AuthPrincipal = {
      accountId: `smart-system:${job.clientId}`,
      role: "SUPPORT",
      sessionId: job.kickoffTokenId,
    };
    return {
      principal,
      authorizationType: "system",
      tokenId: job.kickoffTokenId,
      clientId: job.clientId,
      patientId: null,
      scopes: [...job.authorizedScopes],
      expiresAt: job.createdAt,
    };
  }

  private maxResourcesPerType(): number {
    return this.integerEnv("BULK_EXPORT_MAX_RESOURCES_PER_TYPE", DEFAULT_MAX_RESOURCES_PER_TYPE, 1, MAX_RESOURCES_PER_TYPE);
  }

  private retentionSeconds(): number {
    return this.integerEnv("BULK_EXPORT_RETENTION_SECONDS", DEFAULT_RETENTION_SECONDS, DEFAULT_RETENTION_SECONDS, MAX_RETENTION_SECONDS);
  }

  private integerEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    if (!/^\d+$/.test(raw)) throw new InternalServerErrorException(`${name} must be an integer.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new InternalServerErrorException(`${name} must be between ${min} and ${max}.`);
    }
    return value;
  }

  private async saveJob(job: BulkExportJob, ttlSeconds: number): Promise<void> {
    await this.redis.setEphemeral(this.jobKey(job.jobId), JSON.stringify(job), ttlSeconds);
  }

  private parseJob(raw: string): BulkExportJob {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new InternalServerErrorException("FHIR bulk export job state is invalid.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InternalServerErrorException("FHIR bulk export job state is invalid.");
    const job = value as Record<string, unknown>;
    if (
      job.version !== 1 ||
      typeof job.jobId !== "string" ||
      typeof job.clientId !== "string" ||
      typeof job.kickoffTokenId !== "string" ||
      !Array.isArray(job.authorizedScopes) || !job.authorizedScopes.every((item) => typeof item === "string") ||
      !Array.isArray(job.resourceTypes) || !job.resourceTypes.every((item) => item === "Patient" || item === "Appointment") ||
      (job.since !== null && typeof job.since !== "string") ||
      job.outputFormat !== OUTPUT_FORMAT ||
      !["QUEUED", "RUNNING", "COMPLETED", "FAILED"].includes(String(job.status)) ||
      typeof job.createdAt !== "string" ||
      (job.startedAt !== null && typeof job.startedAt !== "string") ||
      (job.completedAt !== null && typeof job.completedAt !== "string") ||
      (job.transactionTime !== null && typeof job.transactionTime !== "string") ||
      (job.expiresAt !== null && typeof job.expiresAt !== "string") ||
      !Array.isArray(job.artifacts) ||
      (job.error !== null && typeof job.error !== "string")
    ) throw new InternalServerErrorException("FHIR bulk export job state is invalid.");
    const artifacts = job.artifacts.map((item) => this.parseArtifact(item));
    return {
      version: 1,
      jobId: job.jobId,
      clientId: job.clientId,
      kickoffTokenId: job.kickoffTokenId,
      authorizedScopes: job.authorizedScopes as string[],
      resourceTypes: job.resourceTypes as FhirBulkResourceType[],
      since: job.since as string | null,
      outputFormat: OUTPUT_FORMAT,
      status: job.status as BulkExportStatus,
      createdAt: job.createdAt,
      startedAt: job.startedAt as string | null,
      completedAt: job.completedAt as string | null,
      transactionTime: job.transactionTime as string | null,
      expiresAt: job.expiresAt as string | null,
      artifacts,
      error: job.error as string | null,
    };
  }

  private parseArtifact(value: unknown): BulkExportArtifact {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InternalServerErrorException("FHIR bulk export artifact state is invalid.");
    const item = value as Record<string, unknown>;
    if (
      (item.type !== "Patient" && item.type !== "Appointment") ||
      typeof item.objectKey !== "string" ||
      typeof item.count !== "number" || !Number.isSafeInteger(item.count) || item.count < 0 ||
      typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
      typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)
    ) throw new InternalServerErrorException("FHIR bulk export artifact state is invalid.");
    return {
      type: item.type,
      objectKey: item.objectKey,
      count: item.count,
      bytes: item.bytes,
      sha256: item.sha256,
    };
  }

  private async removeArtifacts(artifacts: BulkExportArtifact[]): Promise<void> {
    await Promise.all(artifacts.map((artifact) => this.storage.remove(artifact.objectKey).catch(() => undefined)));
  }

  private validJobId(jobId: string): boolean {
    return /^[A-Za-z0-9_-]{20,128}$/.test(jobId);
  }

  private jobKey(jobId: string): string {
    return `carepoint:fhir:bulk-export:${jobId}`;
  }

  private lockKey(jobId: string): string {
    return `carepoint:fhir:bulk-export-lock:${jobId}`;
  }

  private cancelKey(jobId: string): string {
    return `carepoint:fhir:bulk-export-cancel:${jobId}`;
  }

  private statusUrl(jobId: string): string {
    return `${this.config.fhirBaseUrl()}/$export-status/${jobId}`;
  }

  private fileUrl(jobId: string, resourceType: FhirBulkResourceType): string {
    return `${this.config.fhirBaseUrl()}/$export-file/${jobId}/${resourceType}.ndjson`;
  }
}
