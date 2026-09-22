import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const CHECKLIST_KEY = /^[A-Za-z0-9_.:-]{1,80}$/;
const EVIDENCE_REF = /^[A-Za-z0-9._:/-]{1,240}$/;
const MAX_CHECKLIST_ITEMS = 100;
const MAX_NOTES = 10000;
const MAX_EVIDENCE_REFS = 30;

type ChecklistValue = boolean | number | string | null;

type OfflineFieldSnapshot = {
  schemaVersion: 1;
  appointmentId: string;
  checklist: Record<string, ChecklistValue>;
  notes: string | null;
  evidenceRefs: string[];
  clientUpdatedAt: string | null;
};

export interface SyncOfflineFieldDraftInput {
  appointmentId?: unknown;
  clientDraftId?: unknown;
  clientRevision?: unknown;
  baseServerVersion?: unknown;
  idempotencyKey?: unknown;
  checklist?: unknown;
  notes?: unknown;
  evidenceRefs?: unknown;
  clientUpdatedAt?: unknown;
}

export interface ResolveOfflineFieldConflictInput {
  resolution?: unknown;
}

type OfflineResolution = "KEEP_SERVER" | "USE_CLIENT";

@Injectable()
export class ProviderOfflineSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async sync(principal: AuthPrincipal, input: SyncOfflineFieldDraftInput) {
    const context = await this.requireOfflineContext(principal);
    const appointmentId = this.requiredId(input?.appointmentId, "appointmentId");
    const appointment = await this.requireAppointment(context.providerId, appointmentId);
    const clientDraftId = this.requiredId(input?.clientDraftId, "clientDraftId");
    const clientRevision = this.positiveInteger(input?.clientRevision, "clientRevision");
    const baseServerVersion = this.nonNegativeInteger(input?.baseServerVersion, "baseServerVersion");
    const idempotencyKey = this.idempotencyKey(input?.idempotencyKey);
    const snapshot = this.snapshot(appointment.id, input);
    const requestDigest = this.digest({
      providerId: context.providerId,
      patientId: appointment.patientId,
      appointmentId: appointment.id,
      clientDraftId,
      clientRevision,
      baseServerVersion,
      snapshot,
    });
    const encrypted = await this.envelope.encryptRecord(snapshot);

    return this.prisma.$transaction(async (tx) => {
      const replayRevision = await tx.offlineFieldDraftRevision.findUnique({ where: { idempotencyKey } });
      if (replayRevision) {
        const replayDraft = await tx.offlineFieldDraft.findUnique({ where: { id: replayRevision.draftId } });
        if (!replayDraft || replayDraft.providerId !== context.providerId || replayRevision.requestDigest !== requestDigest) {
          throw new ConflictException("idempotencyKey was already used for a different offline field sync.");
        }
        return {
          outcome: "SYNCED" as const,
          replay: true,
          draftId: replayDraft.id,
          appointmentId: replayDraft.appointmentId,
          clientDraftId: replayRevision.clientDraftId,
          clientRevision: replayRevision.clientRevision,
          serverVersion: replayRevision.version,
          syncedAt: replayDraft.lastSyncedAt?.toISOString() ?? replayRevision.createdAt.toISOString(),
        };
      }

      const replayConflict = await tx.offlineFieldSyncConflict.findUnique({ where: { idempotencyKey } });
      if (replayConflict) {
        if (replayConflict.providerId !== context.providerId || replayConflict.requestDigest !== requestDigest) {
          throw new ConflictException("idempotencyKey was already used for a different offline field sync.");
        }
        return this.conflictResult(replayConflict, true);
      }

      let draft = await tx.offlineFieldDraft.findUnique({
        where: { providerId_appointmentId: { providerId: context.providerId, appointmentId: appointment.id } },
      });

      if (!draft) {
        if (baseServerVersion !== 0) {
          throw new ConflictException({
            message: "The offline draft has no server baseline. Refresh before synchronizing.",
            code: "SERVER_BASELINE_MISSING",
            currentVersion: 0,
            baseServerVersion,
          });
        }
        const now = new Date();
        draft = await tx.offlineFieldDraft.create({
          data: {
            providerId: context.providerId,
            patientId: appointment.patientId,
            appointmentId: appointment.id,
            currentVersion: 1,
            lastSyncedAt: now,
          },
        });
        const revision = await tx.offlineFieldDraftRevision.create({
          data: {
            draftId: draft.id,
            version: 1,
            clientDraftId,
            clientRevision,
            idempotencyKey,
            requestDigest,
            authorActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await this.auditSync(tx, principal, draft, "OFFLINE_FIELD_DRAFT_SYNCED", {
          serverVersion: revision.version,
          clientRevision,
          created: true,
        });
        return {
          outcome: "SYNCED" as const,
          replay: false,
          draftId: draft.id,
          appointmentId: draft.appointmentId,
          clientDraftId,
          clientRevision,
          serverVersion: revision.version,
          syncedAt: now.toISOString(),
        };
      }

      await tx.$queryRaw(Prisma.sql`SELECT id FROM "OfflineFieldDraft" WHERE id = ${draft.id} FOR UPDATE`);
      draft = await tx.offlineFieldDraft.findUnique({ where: { id: draft.id } });
      if (!draft || draft.providerId !== context.providerId || draft.patientId !== appointment.patientId) {
        throw new ConflictException("Offline field draft ownership changed concurrently.");
      }

      if (baseServerVersion !== draft.currentVersion) {
        const conflict = await tx.offlineFieldSyncConflict.create({
          data: {
            draftId: draft.id,
            providerId: context.providerId,
            patientId: appointment.patientId,
            appointmentId: appointment.id,
            clientDraftId,
            clientRevision,
            baseServerVersion,
            serverVersionAtConflict: draft.currentVersion,
            idempotencyKey,
            requestDigest,
            actorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await this.auditSync(tx, principal, draft, "OFFLINE_FIELD_SYNC_CONFLICT_CREATED", {
          conflictId: conflict.id,
          baseServerVersion,
          serverVersionAtConflict: draft.currentVersion,
          clientRevision,
        });
        return this.conflictResult(conflict, false);
      }

      const nextVersion = draft.currentVersion + 1;
      const now = new Date();
      const revision = await tx.offlineFieldDraftRevision.create({
        data: {
          draftId: draft.id,
          version: nextVersion,
          clientDraftId,
          clientRevision,
          idempotencyKey,
          requestDigest,
          authorActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      const changed = await tx.offlineFieldDraft.updateMany({
        where: { id: draft.id, currentVersion: baseServerVersion },
        data: { currentVersion: nextVersion, lastSyncedAt: now },
      });
      if (changed.count !== 1) throw new ConflictException("Offline field draft changed concurrently. Retry synchronization.");
      await this.auditSync(tx, principal, draft, "OFFLINE_FIELD_DRAFT_SYNCED", {
        serverVersion: revision.version,
        clientRevision,
        created: false,
      });
      return {
        outcome: "SYNCED" as const,
        replay: false,
        draftId: draft.id,
        appointmentId: draft.appointmentId,
        clientDraftId,
        clientRevision,
        serverVersion: revision.version,
        syncedAt: now.toISOString(),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listConflicts(principal: AuthPrincipal) {
    const context = await this.requireOfflineContext(principal);
    const rows = await this.prisma.offlineFieldSyncConflict.findMany({
      where: { providerId: context.providerId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OFFLINE_FIELD_SYNC_CONFLICTS_READ",
      objectType: "PROVIDER",
      objectId: context.providerId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_OFFLINE_SYNC",
        providerId: context.providerId,
        pendingConflictCount: rows.length,
        decision: "ALLOW",
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        draftId: row.draftId,
        appointmentId: row.appointmentId,
        clientDraftId: row.clientDraftId,
        clientRevision: row.clientRevision,
        baseServerVersion: row.baseServerVersion,
        serverVersionAtConflict: row.serverVersionAtConflict,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
      })),
    };
  }

  async conflict(principal: AuthPrincipal, conflictId: string) {
    const context = await this.requireOfflineContext(principal);
    const id = this.requiredId(conflictId, "conflictId");
    const conflict = await this.prisma.offlineFieldSyncConflict.findUnique({ where: { id } });
    if (!conflict || conflict.providerId !== context.providerId) throw new NotFoundException("Offline sync conflict not found.");
    await this.requireAppointment(context.providerId, conflict.appointmentId);
    const draft = await this.prisma.offlineFieldDraft.findUnique({ where: { id: conflict.draftId } });
    if (!draft || draft.providerId !== context.providerId) throw new NotFoundException("Offline draft not found.");
    const server = await this.currentRevision(draft.id, draft.currentVersion);
    const [clientSnapshot, serverSnapshot] = await Promise.all([
      this.decrypt(conflict),
      this.decrypt(server),
    ]);
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OFFLINE_FIELD_SYNC_CONFLICT_READ",
      objectType: "OFFLINE_FIELD_SYNC_CONFLICT",
      objectId: conflict.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_OFFLINE_SYNC",
        providerId: context.providerId,
        patientId: conflict.patientId,
        appointmentId: conflict.appointmentId,
        conflictId: conflict.id,
        decision: "ALLOW",
      },
    });
    return {
      id: conflict.id,
      status: conflict.status,
      resolution: conflict.resolution,
      appointmentId: conflict.appointmentId,
      clientDraftId: conflict.clientDraftId,
      clientRevision: conflict.clientRevision,
      baseServerVersion: conflict.baseServerVersion,
      serverVersionAtConflict: conflict.serverVersionAtConflict,
      currentServerVersion: draft.currentVersion,
      createdAt: conflict.createdAt.toISOString(),
      resolvedAt: conflict.resolvedAt?.toISOString() ?? null,
      clientSnapshot,
      serverSnapshot,
    };
  }

  async resolve(principal: AuthPrincipal, conflictId: string, input: ResolveOfflineFieldConflictInput) {
    const context = await this.requireOfflineContext(principal);
    const id = this.requiredId(conflictId, "conflictId");
    const resolution = this.resolution(input?.resolution);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "OfflineFieldSyncConflict" WHERE id = ${id} FOR UPDATE`);
      const conflict = await tx.offlineFieldSyncConflict.findUnique({ where: { id } });
      if (!conflict || conflict.providerId !== context.providerId) throw new NotFoundException("Offline sync conflict not found.");
      if (conflict.status === "RESOLVED") {
        return {
          replay: true,
          draftId: conflict.draftId,
          appointmentId: conflict.appointmentId,
          resolution: conflict.resolution as OfflineResolution,
        };
      }
      await this.requireAppointment(context.providerId, conflict.appointmentId);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "OfflineFieldDraft" WHERE id = ${conflict.draftId} FOR UPDATE`);
      const draft = await tx.offlineFieldDraft.findUnique({ where: { id: conflict.draftId } });
      if (!draft || draft.providerId !== context.providerId) throw new NotFoundException("Offline draft not found.");

      if (resolution === "USE_CLIENT" && draft.currentVersion !== conflict.serverVersionAtConflict) {
        throw new ConflictException({
          message: "The server draft advanced after this conflict. Review the newest server version before applying the local draft.",
          code: "SERVER_ADVANCED_AFTER_CONFLICT",
          conflictId: conflict.id,
          serverVersionAtConflict: conflict.serverVersionAtConflict,
          currentServerVersion: draft.currentVersion,
        });
      }

      let serverVersion = draft.currentVersion;
      if (resolution === "USE_CLIENT") {
        serverVersion += 1;
        await tx.offlineFieldDraftRevision.create({
          data: {
            draftId: draft.id,
            version: serverVersion,
            clientDraftId: conflict.clientDraftId,
            clientRevision: conflict.clientRevision,
            idempotencyKey: `offline-conflict-use-client:${conflict.id}`,
            requestDigest: conflict.requestDigest,
            sourceConflictId: conflict.id,
            algorithm: conflict.algorithm,
            keyId: conflict.keyId,
            wrappedKey: conflict.wrappedKey,
            iv: conflict.iv,
            ciphertext: conflict.ciphertext,
            authorActorId: principal.accountId,
          },
        });
        await tx.offlineFieldDraft.update({
          where: { id: draft.id },
          data: { currentVersion: serverVersion, lastSyncedAt: new Date() },
        });
      }

      const resolvedAt = new Date();
      await tx.offlineFieldSyncConflict.update({
        where: { id: conflict.id },
        data: {
          status: "RESOLVED",
          resolution,
          resolvedByActorId: principal.accountId,
          resolvedAt,
        },
      });
      await this.auditSync(tx, principal, draft, "OFFLINE_FIELD_SYNC_CONFLICT_RESOLVED", {
        conflictId: conflict.id,
        resolution,
        serverVersion,
      });
      return {
        replay: false,
        draftId: draft.id,
        appointmentId: draft.appointmentId,
        resolution,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const draft = await this.prisma.offlineFieldDraft.findUnique({ where: { id: result.draftId } });
    if (!draft) throw new NotFoundException("Offline draft not found after conflict resolution.");
    const server = await this.currentRevision(draft.id, draft.currentVersion);
    return {
      outcome: "RESOLVED" as const,
      replay: result.replay,
      conflictId: id,
      resolution: result.resolution,
      draftId: draft.id,
      appointmentId: result.appointmentId,
      serverVersion: draft.currentVersion,
      serverSnapshot: await this.decrypt(server),
    };
  }

  private async requireOfflineContext(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.enabledModalities.has("HOME_VISIT")) {
      throw new ForbiddenException("Other Provider category is not authorized for HOME_VISIT offline field work.");
    }
    return context;
  }

  private async requireAppointment(providerId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId,
        modality: "HOME_VISIT",
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true, patientId: true, status: true },
    });
    if (!appointment) throw new ForbiddenException("Assigned HOME_VISIT appointment context is required for offline field sync.");
    return appointment;
  }

  private async currentRevision(draftId: string, version: number) {
    const revision = await this.prisma.offlineFieldDraftRevision.findUnique({
      where: { draftId_version: { draftId, version } },
    });
    if (!revision) throw new ConflictException("Offline field draft revision is missing.");
    return revision;
  }

  private snapshot(appointmentId: string, input: SyncOfflineFieldDraftInput): OfflineFieldSnapshot {
    return {
      schemaVersion: 1,
      appointmentId,
      checklist: this.checklist(input?.checklist),
      notes: this.notes(input?.notes),
      evidenceRefs: this.evidenceRefs(input?.evidenceRefs),
      clientUpdatedAt: this.optionalDate(input?.clientUpdatedAt, "clientUpdatedAt"),
    };
  }

  private checklist(value: unknown): Record<string, ChecklistValue> {
    if (value == null) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("checklist must be an object.");
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_CHECKLIST_ITEMS) throw new BadRequestException(`checklist must contain at most ${MAX_CHECKLIST_ITEMS} items.`);
    const normalized = entries.map(([rawKey, rawValue]) => {
      const key = rawKey.trim();
      if (!CHECKLIST_KEY.test(key)) throw new BadRequestException(`Invalid checklist key: ${rawKey}`);
      if (rawValue == null || typeof rawValue === "boolean") return [key, rawValue] as const;
      if (typeof rawValue === "number") {
        if (!Number.isFinite(rawValue)) throw new BadRequestException(`Checklist value for ${key} must be finite.`);
        return [key, rawValue] as const;
      }
      if (typeof rawValue === "string") {
        const text = rawValue.trim();
        if (text.length > 500 || this.hasUnsafeControl(text)) throw new BadRequestException(`Checklist value for ${key} is invalid.`);
        return [key, text] as const;
      }
      throw new BadRequestException(`Checklist value for ${key} must be scalar.`);
    });
    normalized.sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(normalized);
  }

  private notes(value: unknown): string | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("notes must be text.");
    const normalized = value.trim();
    if (normalized.length > MAX_NOTES || this.hasUnsafeControl(normalized)) throw new BadRequestException(`notes must contain at most ${MAX_NOTES} safe characters.`);
    return normalized || null;
  }

  private evidenceRefs(value: unknown): string[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS) throw new BadRequestException(`evidenceRefs must contain at most ${MAX_EVIDENCE_REFS} items.`);
    return [...new Set(value.map((item, index) => {
      if (typeof item !== "string" || !EVIDENCE_REF.test(item.trim())) throw new BadRequestException(`evidenceRefs[${index}] is invalid.`);
      return item.trim();
    }))];
  }

  private optionalDate(value: unknown, field: string): string | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO date-time.`);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO date-time.`);
    return parsed.toISOString();
  }

  private resolution(value: unknown): OfflineResolution {
    if (typeof value !== "string") throw new BadRequestException("resolution is required.");
    const normalized = value.trim().toUpperCase();
    if (normalized !== "KEEP_SERVER" && normalized !== "USE_CLIENT") {
      throw new BadRequestException("resolution must be KEEP_SERVER or USE_CLIENT.");
    }
    return normalized;
  }

  private conflictResult(conflict: {
    id: string;
    draftId: string;
    appointmentId: string;
    clientDraftId: string;
    clientRevision: number;
    baseServerVersion: number;
    serverVersionAtConflict: number;
    createdAt: Date;
  }, replay: boolean) {
    return {
      outcome: "CONFLICT" as const,
      replay,
      conflictId: conflict.id,
      draftId: conflict.draftId,
      appointmentId: conflict.appointmentId,
      clientDraftId: conflict.clientDraftId,
      clientRevision: conflict.clientRevision,
      baseServerVersion: conflict.baseServerVersion,
      currentServerVersion: conflict.serverVersionAtConflict,
      createdAt: conflict.createdAt.toISOString(),
    };
  }

  private async auditSync(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    draft: { id: string; providerId: string; patientId: string; appointmentId: string },
    action: string,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.writeClinicalInTransaction(tx, {
      actorId: principal.accountId,
      action,
      objectType: "OFFLINE_FIELD_DRAFT",
      objectId: draft.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_OFFLINE_SYNC",
        providerId: draft.providerId,
        patientId: draft.patientId,
        appointmentId: draft.appointmentId,
        draftId: draft.id,
        ...metadata,
        decision: "ALLOW",
      },
    });
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private nonNegativeInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 0) throw new BadRequestException(`${field} must be a non-negative integer.`);
    return Number(value);
  }

  private hasUnsafeControl(value: string): boolean {
    return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private async decrypt(row: { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string }) {
    return this.envelope.decryptRecord<OfflineFieldSnapshot>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private envelopeData(envelope: EncryptedEnvelope) {
    return {
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      wrappedKey: envelope.wrappedKey,
      iv: envelope.iv,
      ciphertext: envelope.ciphertext,
    };
  }
}
