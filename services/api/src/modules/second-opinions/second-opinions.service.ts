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
import { createHash } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ClinicalService } from "../clinical/clinical.service";
import {
  normalizeTemporaryShareScopes,
  resolveClinicalConsentPolicy,
} from "../clinical-governance/clinical-consent-policy";
import { NotificationsService } from "../communications/notifications.service";
import { DoctorSnapshotService } from "../doctor-snapshot/doctor-snapshot.service";
import { ReferralsService } from "../referrals/referrals.service";

const MAX_QUESTION_CHARS = 5000;
const MAX_RESPONSE_CHARS = 20000;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_EXPIRY_DAYS = 30;
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

type ScopeBinding = { scope: string; version: string };
type Audience = "REFERRING" | "DESTINATION";

export interface CreateSecondOpinionInput {
  destinationProviderId: string;
  scopes: string[];
  question: string;
  expiresAt: string;
  idempotencyKey: string;
}

export interface RespondSecondOpinionInput {
  response: string;
}

@Injectable()
export class SecondOpinionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly clinical: ClinicalService,
    private readonly snapshots: DoctorSnapshotService,
    private readonly referrals: ReferralsService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(principal: AuthPrincipal, patientIdRaw: string, raw: CreateSecondOpinionInput) {
    const doctor = await this.requireDoctor(principal);
    const patientId = this.id(patientIdRaw, "patientId");
    const destinationProviderId = this.id(raw?.destinationProviderId, "destinationProviderId");
    if (destinationProviderId === doctor.id) {
      throw new BadRequestException("Second-opinion destination must be a different Doctor.");
    }
    const question = this.text(raw?.question, "question", MAX_QUESTION_CHARS);
    const idempotencyKey = this.idempotency(raw?.idempotencyKey);
    const expiresAt = this.expiry(raw?.expiresAt);
    const bindings = normalizeTemporaryShareScopes(raw?.scopes);
    const scopes = bindings.map((item) => item.scope);

    await this.requireTreatmentRelationship(doctor.id, patientId);
    const consentIds = await this.requireExplicitDestinationConsents(
      patientId,
      destinationProviderId,
      bindings,
    );

    const existing = await this.prisma.secondOpinionRequest.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (
        existing.patientId !== patientId ||
        existing.referringProviderId !== doctor.id ||
        existing.destinationProviderId !== destinationProviderId
      ) {
        throw new ConflictException("idempotencyKey is bound to another second-opinion request.");
      }
      return this.present(existing, "REFERRING");
    }

    const [snapshot, patient] = await Promise.all([
      this.buildSnapshot(principal, patientId, scopes),
      this.prisma.patientProfile.findUnique({
        where: { id: patientId },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    if (!patient) throw new NotFoundException("Patient not found.");
    const capturedAt = new Date().toISOString();
    const requestPayload = {
      schemaVersion: 1,
      question,
      capturedAt,
      scopes,
      consentIds,
      patient: {
        id: patient.id,
        displayName: [patient.firstName, patient.lastName].filter(Boolean).join(" "),
      },
      snapshot,
    };
    const serialized = JSON.stringify(requestPayload);
    if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) {
      throw new BadRequestException("Selected second-opinion snapshot exceeds the maximum package size.");
    }
    const snapshotHash = createHash("sha256").update(serialized).digest("hex");
    const encrypted = await this.envelope.encryptRecord(requestPayload);

    const referral = await this.referrals.create(principal, patientId, {
      idempotencyKey: "second-opinion:" + idempotencyKey,
      destinationProviderId,
      priority: "ROUTINE",
      reason: "Second opinion clinical review",
      scopes,
      documentIds: [],
      expiresAt: expiresAt.toISOString(),
    });
    const referralId = this.id(this.object(referral).id, "referralId");

    let created;
    try {
      created = await this.prisma.secondOpinionRequest.create({
        data: {
          idempotencyKey,
          patientId,
          referringProviderId: doctor.id,
          destinationProviderId,
          referralId,
          scopes: scopes as unknown as Prisma.InputJsonValue,
          consentIds: consentIds as unknown as Prisma.InputJsonValue,
          expiresAt,
          snapshotHash,
          snapshotAlgorithm: encrypted.algorithm,
          snapshotKeyId: encrypted.keyId,
          snapshotWrappedKey: encrypted.wrappedKey,
          snapshotIv: encrypted.iv,
          snapshotCiphertext: encrypted.ciphertext,
        },
      });
    } catch (error) {
      const raced = await this.prisma.secondOpinionRequest.findUnique({ where: { idempotencyKey } });
      if (!raced) throw error;
      created = raced;
    }

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "SECOND_OPINION_REQUEST_CREATED",
      objectType: "SECOND_OPINION_REQUEST",
      objectId: created.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        patientId,
        providerId: doctor.id,
        destinationProviderId,
        referralId,
        scopeCount: scopes.length,
        consentCount: consentIds.length,
        snapshotHash,
        decision: "ALLOW",
      },
    });
    return this.present(created, "REFERRING");
  }

  async listForPatient(principal: AuthPrincipal, patientIdRaw: string) {
    const doctor = await this.requireDoctor(principal);
    const patientId = this.id(patientIdRaw, "patientId");
    await this.requireTreatmentRelationship(doctor.id, patientId);
    const rows = await this.prisma.secondOpinionRequest.findMany({
      where: { patientId, referringProviderId: doctor.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) items.push(await this.present(row, "REFERRING"));
    return { patientId, items };
  }

  async inbox(principal: AuthPrincipal) {
    const doctor = await this.requireDoctor(principal);
    const rows = await this.prisma.secondOpinionRequest.findMany({
      where: {
        destinationProviderId: doctor.id,
        status: "REQUESTED",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) {
      if (
        await this.shareActive(row.referralId, doctor.id) &&
        await this.destinationConsentsStillActive(row)
      ) {
        items.push(await this.present(row, "DESTINATION"));
      }
    }
    return { items };
  }

  async respond(principal: AuthPrincipal, requestIdRaw: string, raw: RespondSecondOpinionInput) {
    const doctor = await this.requireDoctor(principal);
    const requestId = this.id(requestIdRaw, "requestId");
    const responseText = this.text(raw?.response, "response", MAX_RESPONSE_CHARS);
    const request = await this.prisma.secondOpinionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.destinationProviderId !== doctor.id) {
      throw new NotFoundException("Second-opinion request not found.");
    }
    if (request.status !== "REQUESTED" || request.responseCiphertext) {
      throw new ConflictException("Second-opinion request is already answered.");
    }
    if (request.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException("Second-opinion request has expired.");
    }
    if (!(await this.shareActive(request.referralId, doctor.id))) {
      throw new ForbiddenException("Second-opinion clinical share is no longer active.");
    }
    if (!(await this.destinationConsentsStillActive(request))) {
      throw new ForbiddenException("Patient consent for this second-opinion package is no longer active.");
    }

    const referral = await this.prisma.referral.findUnique({ where: { id: request.referralId } });
    if (
      !referral ||
      referral.destinationProviderId !== doctor.id ||
      referral.status !== "IN_PROGRESS"
    ) {
      throw new ConflictException(
        "Accept and start the linked referral before submitting the second-opinion response.",
      );
    }

    const respondedAt = new Date();
    const encrypted = await this.envelope.encryptRecord({
      schemaVersion: 1,
      response: responseText,
      respondedAt: respondedAt.toISOString(),
    });

    const accounts = await Promise.all([
      this.prisma.provider.findUnique({
        where: { id: request.referringProviderId },
        select: { userId: true },
      }),
      this.prisma.patientProfile.findUnique({
        where: { id: request.patientId },
        select: { userId: true },
      }),
    ]);

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.secondOpinionRequest.updateMany({
        where: { id: request.id, status: "REQUESTED", responseCiphertext: null },
        data: {
          status: "RESPONDED",
          responseAlgorithm: encrypted.algorithm,
          responseKeyId: encrypted.keyId,
          responseWrappedKey: encrypted.wrappedKey,
          responseIv: encrypted.iv,
          responseCiphertext: encrypted.ciphertext,
          respondedAt,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException("Second-opinion request changed concurrently.");
      }

      const referralChanged = await tx.referral.updateMany({
        where: { id: referral.id, status: "IN_PROGRESS", version: referral.version },
        data: { status: "COMPLETED", version: { increment: 1 }, completedAt: respondedAt },
      });
      if (referralChanged.count !== 1) {
        throw new ConflictException("Linked referral changed concurrently. Refresh and retry.");
      }
      await tx.referralStatusEvent.create({
        data: {
          referralId: referral.id,
          fromStatus: referral.status,
          toStatus: "COMPLETED",
          actorAccountId: principal.accountId,
          reasonCode: "SECOND_OPINION_RESPONDED",
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "SECOND_OPINION_RESPONDED",
        objectType: "SECOND_OPINION_REQUEST",
        objectId: request.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          patientId: request.patientId,
          providerId: doctor.id,
          referringProviderId: request.referringProviderId,
          referralId: request.referralId,
          snapshotHash: request.snapshotHash,
          decision: "ALLOW",
        },
      });
      if (accounts[0]?.userId) {
        await this.notifications.enqueueAccountInTransaction(tx, {
          accountId: accounts[0].userId,
          dedupeKey: "second-opinion:" + request.id + ":responded:referrer",
          type: "CARE_COORDINATION",
          entityType: "SECOND_OPINION_REQUEST",
          entityId: request.id,
          safeTitleKey: "second-opinion.responded.title",
          safeBodyKey: "second-opinion.responded.body",
        });
      }
      if (accounts[1]?.userId) {
        await this.notifications.enqueueAccountInTransaction(tx, {
          accountId: accounts[1].userId,
          dedupeKey: "second-opinion:" + request.id + ":responded:patient",
          type: "CARE_COORDINATION",
          entityType: "SECOND_OPINION_REQUEST",
          entityId: request.id,
          safeTitleKey: "second-opinion.responded.title",
          safeBodyKey: "second-opinion.responded.body",
        });
      }
      const current = await tx.secondOpinionRequest.findUnique({ where: { id: request.id } });
      if (!current) throw new NotFoundException("Second-opinion request not found after response.");
      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.notifications.wakeOutbox();
    return this.present(updated, "DESTINATION");
  }

  private async buildSnapshot(principal: AuthPrincipal, patientId: string, scopes: string[]) {
    const wantsRecord = scopes.includes("CLINICAL_RECORD_READ");
    const wantsHealth = scopes.includes("HEALTH_PROFILE_READ");
    const wantsQuestionnaire = scopes.includes("QUESTIONNAIRE_READ");
    const wantsClinicalProfile = scopes.includes("CLINICAL_PROFILE_READ");
    const wantsObservationAll = scopes.includes("OBSERVATION_READ");
    const observationCodes = new Set(
      scopes
        .filter((scope) => scope.startsWith("OBSERVATION_READ:"))
        .map((scope) => scope.slice("OBSERVATION_READ:".length)),
    );
    const needsSnapshot =
      wantsHealth || wantsQuestionnaire || wantsClinicalProfile ||
      wantsObservationAll || observationCodes.size > 0;

    const [snapshot, clinicalRecords] = await Promise.all([
      needsSnapshot ? this.snapshots.patientSnapshot(principal, patientId) : Promise.resolve(null),
      wantsRecord ? this.clinical.providerPatientTimeline(principal, patientId) : Promise.resolve(null),
    ]);

    const result: Record<string, unknown> = {};
    if (wantsRecord) result.clinicalRecord = clinicalRecords;
    if (snapshot) {
      if (wantsHealth) result.healthProfile = this.available(snapshot.healthProfile, "HEALTH_PROFILE_READ");
      if (wantsClinicalProfile) {
        result.clinicalProfile = this.available(snapshot.clinicalProfile, "CLINICAL_PROFILE_READ");
      }
      if (wantsQuestionnaire) {
        result.questionnaires = this.available(snapshot.questionnaires, "QUESTIONNAIRE_READ");
      }
      if (wantsObservationAll || observationCodes.size > 0) {
        const selected = snapshot.observations.filter((item) =>
          wantsObservationAll || observationCodes.has(item.code),
        );
        for (const item of selected) {
          if (item.section.state !== "AVAILABLE") {
            throw new ForbiddenException("Selected observation scope is not available to the requesting Doctor.");
          }
        }
        result.observations = selected;
      }
    }
    return result;
  }

  private available(section: { state: string; value?: unknown }, scope: string) {
    if (section.state !== "AVAILABLE") {
      throw new ForbiddenException("Selected scope " + scope + " is not available to the requesting Doctor.");
    }
    return section.value;
  }

  private async requireExplicitDestinationConsents(
    patientId: string,
    destinationProviderId: string,
    bindings: ScopeBinding[],
  ) {
    const now = new Date();
    const rows = await this.prisma.consent.findMany({
      where: {
        patientId,
        providerId: destinationProviderId,
        state: "GRANTED",
        purpose: "TREATMENT",
        scope: { in: bindings.map((item) => item.scope) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, scope: true, version: true },
      orderBy: { grantedAt: "desc" },
    });

    const consentIds: string[] = [];
    for (const binding of bindings) {
      const row = rows.find((item) => item.scope === binding.scope && item.version === binding.version);
      if (!row) {
        throw new ForbiddenException(
          "Explicit patient consent for destination Doctor and scope " + binding.scope + " is required.",
        );
      }
      consentIds.push(row.id);
    }
    return consentIds;
  }

  private async present(
    row: {
      id: string;
      patientId: string;
      referringProviderId: string;
      destinationProviderId: string;
      referralId: string;
      scopes: Prisma.JsonValue;
      consentIds: Prisma.JsonValue;
      expiresAt: Date;
      status: string;
      snapshotHash: string;
      snapshotAlgorithm: string;
      snapshotKeyId: string;
      snapshotWrappedKey: string;
      snapshotIv: string;
      snapshotCiphertext: string;
      responseAlgorithm: string | null;
      responseKeyId: string | null;
      responseWrappedKey: string | null;
      responseIv: string | null;
      responseCiphertext: string | null;
      respondedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    audience: Audience,
  ) {
    if (audience === "DESTINATION") {
      if (!(await this.shareActive(row.referralId, row.destinationProviderId))) {
        throw new ForbiddenException("Second-opinion clinical share is no longer active.");
      }
      if (!(await this.destinationConsentsStillActive(row))) {
        throw new ForbiddenException("Patient consent for this second-opinion package is no longer active.");
      }
    }
    const payload = await this.envelope.decryptRecord<{
      schemaVersion: number;
      question: string;
      capturedAt: string;
      scopes: string[];
      consentIds: string[];
      patient: { id: string; displayName: string };
      snapshot: unknown;
    }>(this.envelopeOf(
      row.snapshotAlgorithm,
      row.snapshotKeyId,
      row.snapshotWrappedKey,
      row.snapshotIv,
      row.snapshotCiphertext,
    ));
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    if (payloadHash !== row.snapshotHash) {
      throw new ConflictException("Second-opinion snapshot integrity validation failed.");
    }
    const response = row.responseCiphertext && row.responseAlgorithm && row.responseKeyId &&
      row.responseWrappedKey && row.responseIv
      ? await this.envelope.decryptRecord<{ response: string; respondedAt: string }>(
          this.envelopeOf(
            row.responseAlgorithm,
            row.responseKeyId,
            row.responseWrappedKey,
            row.responseIv,
            row.responseCiphertext,
          ),
        )
      : null;
    const [providers, referral] = await Promise.all([
      this.prisma.provider.findMany({
        where: { id: { in: [row.referringProviderId, row.destinationProviderId] } },
        select: { id: true, displayName: true },
      }),
      this.prisma.referral.findUnique({
        where: { id: row.referralId },
        select: { id: true, status: true, version: true },
      }),
    ]);
    const byId = new Map(providers.map((item) => [item.id, item.displayName]));
    return {
      id: row.id,
      patientId: row.patientId,
      referringProvider: {
        id: row.referringProviderId,
        displayName: byId.get(row.referringProviderId) ?? null,
      },
      destinationProvider: {
        id: row.destinationProviderId,
        displayName: byId.get(row.destinationProviderId) ?? null,
      },
      patient: payload.patient,
      referralId: row.referralId,
      referral: referral ? { id: referral.id, status: referral.status, version: referral.version } : null,
      scopes: payload.scopes,
      consentIds: audience === "REFERRING" ? payload.consentIds : undefined,
      expiresAt: row.expiresAt,
      status: row.status === "REQUESTED" && row.expiresAt.getTime() <= Date.now()
        ? "EXPIRED"
        : row.status,
      question: payload.question,
      capturedAt: payload.capturedAt,
      snapshotHash: row.snapshotHash,
      snapshot: payload.snapshot,
      response,
      respondedAt: row.respondedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      immutableSnapshot: true,
    };
  }


  private async destinationConsentsStillActive(row: {
    patientId: string;
    destinationProviderId: string;
    scopes: Prisma.JsonValue;
    consentIds: Prisma.JsonValue;
  }) {
    const consentIds = this.jsonStringArray(row.consentIds);
    const scopes = this.jsonStringArray(row.scopes);
    if (consentIds.length < 1 || consentIds.length !== scopes.length) return false;
    const now = new Date();
    const consents = await this.prisma.consent.findMany({
      where: {
        id: { in: consentIds },
        patientId: row.patientId,
        providerId: row.destinationProviderId,
        state: "GRANTED",
        purpose: "TREATMENT",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, scope: true, version: true },
    });
    if (consents.length !== consentIds.length) return false;
    const consentById = new Map(consents.map((item) => [item.id, item]));
    for (const id of consentIds) {
      const consent = consentById.get(id);
      if (!consent || !scopes.includes(consent.scope)) return false;
      const policy = resolveClinicalConsentPolicy(consent.scope);
      if (!policy || policy.version !== consent.version || policy.access !== "READ") return false;
    }
    return true;
  }

  private jsonStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  private async shareActive(referralId: string, destinationProviderId: string) {
    const grant = await this.prisma.clinicalShareGrant.findUnique({ where: { referralId } });
    return Boolean(
      grant &&
      grant.destinationProviderId === destinationProviderId &&
      !grant.revokedAt &&
      (!grant.expiresAt || grant.expiresAt.getTime() > Date.now()),
    );
  }

  private async requireDoctor(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Second-opinion workflow requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true, class: true },
    });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active Doctor provider profile is required.");
    }
    return provider;
  }

  private async requireTreatmentRelationship(providerId: string, patientId: string) {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 86400000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 86400000);
    const relation = await this.prisma.appointment.findFirst({
      where: {
        patientId,
        providerId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!relation) throw new ForbiddenException("A current treatment relationship is required.");
  }

  private expiry(raw: unknown) {
    if (typeof raw !== "string") throw new BadRequestException("expiresAt is required.");
    const value = new Date(raw);
    const now = Date.now();
    if (!Number.isFinite(value.getTime()) || value.getTime() <= now) {
      throw new BadRequestException("expiresAt must be a future ISO date-time.");
    }
    if (value.getTime() > now + MAX_EXPIRY_DAYS * 86400000) {
      throw new BadRequestException("Second-opinion expiry cannot exceed 30 days.");
    }
    return value;
  }

  private idempotency(raw: unknown) {
    if (typeof raw !== "string") throw new BadRequestException("idempotencyKey is required.");
    const value = raw.trim();
    if (value.length < 8 || value.length > 128 || /\p{Cc}/u.test(value)) {
      throw new BadRequestException("idempotencyKey is invalid.");
    }
    return value;
  }

  private id(raw: unknown, field: string) {
    if (typeof raw !== "string") throw new BadRequestException(field + " is required.");
    const value = raw.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(value)) throw new BadRequestException(field + " is invalid.");
    return value;
  }

  private text(raw: unknown, field: string, max: number) {
    if (typeof raw !== "string") throw new BadRequestException(field + " is required.");
    const value = raw.trim();
    if (!value || value.length > max || /\p{Cc}/u.test(value)) {
      throw new BadRequestException(field + " is invalid.");
    }
    return value;
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private envelopeOf(
    algorithm: string,
    keyId: string,
    wrappedKey: string,
    iv: string,
    ciphertext: string,
  ): EncryptedEnvelope {
    if (algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported second-opinion encryption.");
    return { version: 1, algorithm: "AES-256-GCM", keyId, wrappedKey, iv, ciphertext };
  }
}
