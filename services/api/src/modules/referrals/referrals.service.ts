import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type ClinicalShareGrant, type Referral } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import type { AuthPrincipal } from "@carepoint/identity";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { resolveClinicalConsentPolicy } from "../clinical-governance/clinical-consent-policy";
import { NotificationsService } from "../communications/notifications.service";
import { PatientContextService } from "../dependents/dependents.service";
import { OrdersEnvelopeService } from "../orders/orders-envelope.service";
import {
  normalizeReferralAction,
  normalizeReferralInput,
  referralTargetStatus,
  type ReferralActionInput,
  type ReferralInput,
  type ReferralStatus,
} from "./referral.engine";

const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const DEFAULT_SHARE_DAYS = 30;
const MAX_ITEMS = 250;

type DoctorContext = { id: string; accountId: string };
type GrantState = "ACTIVE" | "REVOKED" | "EXPIRED";
type ReferralAudience = "REFERRING_PROVIDER" | "DESTINATION_PROVIDER" | "PATIENT";

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: OrdersEnvelopeService,
    private readonly contexts: PatientContextService,
    private readonly notifications: NotificationsService,
  ) {}

  async destinationCatalog(principal: AuthPrincipal, specialtyCodeRaw?: string) {
    const referring = await this.requireActiveDoctor(principal);
    const specialtyCode = specialtyCodeRaw?.trim()
      ? specialtyCodeRaw.trim().toUpperCase()
      : null;
    if (specialtyCode && !/^[A-Z][A-Z0-9_:-]{1,63}$/.test(specialtyCode)) {
      throw new BadRequestException("specialtyCode is invalid.");
    }
    const rows = await this.prisma.provider.findMany({
      where: {
        id: { not: referring.id },
        status: "ACTIVE",
        class: "DOCTOR",
        ...(specialtyCode ? {
          doctorProfile: {
            is: {
              specialties: {
                some: {
                  specialty: { code: specialtyCode, active: true },
                },
              },
            },
          },
        } : {}),
      },
      select: {
        id: true,
        displayName: true,
        doctorProfile: {
          select: {
            specialties: {
              select: {
                primary: true,
                specialty: {
                  select: { code: true, labels: true, active: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: 200,
    });
    const items = rows.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      specialties: (provider.doctorProfile?.specialties ?? [])
        .filter((item) => item.specialty.active)
        .map((item) => ({
          code: item.specialty.code,
          labels: item.specialty.labels,
          primary: item.primary,
        })),
    }));
    await this.audit.write({
      actorId: principal.accountId,
      action: "REFERRAL_DESTINATIONS_READ",
      objectType: "PROVIDER_DIRECTORY",
      objectId: referring.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        providerId: referring.id,
        specialtyCode,
        itemCount: items.length,
        clinicalPayloadIncluded: false,
      },
    });
    return { items, clinicalPayloadIncluded: false };
  }

  async create(principal: AuthPrincipal, patientId: string, raw: Record<string, unknown>) {
    const referring = await this.requireActiveDoctor(principal);
    const patient = await this.requirePatient(patientId);
    const input = this.normalizedInput(raw);
    if (input.destinationProviderId === referring.id) {
      throw new BadRequestException("Referral destination must be a different provider.");
    }
    this.assertSharePolicies(input.scopes);
    await this.assertTreatmentRelationship(referring.id, patient.id);
    const destination = await this.requireDestinationDoctor(input.destinationProviderId, input.specialtyCode);
    await this.assertDocuments(patient.id, input.documentIds);

    const existing = await this.prisma.referral.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patient.id || existing.referringProviderId !== referring.id) {
        throw new ConflictException("idempotencyKey is already in use for another referral.");
      }
      const grant = await this.requireGrant(existing.id);
      return this.present(existing, grant, "REFERRING_PROVIDER");
    }

    const encrypted = await this.envelope.encrypt({ schemaVersion: 1, reason: input.reason });
    const referralId = randomUUID();
    const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_SHARE_DAYS * 24 * 60 * 60 * 1000);
    const created = await this.prisma.$transaction(async (tx) => {
      const referral = await tx.referral.create({
        data: {
          id: referralId,
          idempotencyKey: input.idempotencyKey,
          patientId: patient.id,
          referringProviderId: referring.id,
          destinationProviderId: destination.id,
          specialtyCode: input.specialtyCode,
          priority: input.priority,
          status: "REQUESTED",
          version: 1,
          algorithm: encrypted.algorithm,
          keyId: encrypted.keyId,
          wrappedKey: encrypted.wrappedKey,
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
        },
      });
      const grant = await tx.clinicalShareGrant.create({
        data: {
          referralId: referral.id,
          patientId: patient.id,
          destinationProviderId: destination.id,
          scopes: input.scopes as unknown as Prisma.InputJsonValue,
          documentIds: input.documentIds as unknown as Prisma.InputJsonValue,
          purpose: "TREATMENT",
          expiresAt,
          createdByProviderId: referring.id,
        },
      });
      await tx.referralStatusEvent.create({
        data: {
          referralId: referral.id,
          fromStatus: null,
          toStatus: "REQUESTED",
          actorAccountId: principal.accountId,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "REFERRAL_CREATED",
        objectType: "REFERRAL",
        objectId: referral.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          patientId: patient.id,
          providerId: referring.id,
          destinationProviderId: destination.id,
          status: "REQUESTED",
          itemCount: input.documentIds.length,
          scopeCount: input.scopes.length,
        },
      });
      await this.notifications.enqueueAccountInTransaction(tx, {
        accountId: patient.userId,
        dedupeKey: `referral:${referral.id}:requested`,
        type: "CARE_COORDINATION",
        entityType: "REFERRAL",
        entityId: referral.id,
        safeTitleKey: "referral.created.title",
        safeBodyKey: "referral.created.body",
      });
      if (destination.accountId) {
        await this.notifications.enqueueAccountInTransaction(tx, {
          accountId: destination.accountId,
          dedupeKey: `referral:${referral.id}:destination-requested`,
          type: "CARE_COORDINATION",
          entityType: "REFERRAL",
          entityId: referral.id,
          safeTitleKey: "referral.incoming.title",
          safeBodyKey: "referral.incoming.body",
        });
      }
      return { referral, grant };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.notifications.wakeOutbox();
    return this.present(created.referral, created.grant, "REFERRING_PROVIDER");
  }

  async providerPatientReferrals(principal: AuthPrincipal, patientId: string) {
    const provider = await this.requireActiveDoctor(principal);
    await this.requirePatient(patientId);
    await this.assertTreatmentRelationship(provider.id, patientId);
    const rows = await this.prisma.referral.findMany({
      where: {
        patientId,
        OR: [{ referringProviderId: provider.id }, { destinationProviderId: provider.id }],
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS,
    });
    const grants = await this.grantsFor(rows.map((row) => row.id));
    const items = [];
    for (const row of rows) {
      const grant = grants.get(row.id);
      if (!grant) continue;
      const audience: ReferralAudience = row.referringProviderId === provider.id ? "REFERRING_PROVIDER" : "DESTINATION_PROVIDER";
      if (audience === "DESTINATION_PROVIDER" && this.grantState(grant) !== "ACTIVE") continue;
      items.push(await this.present(row, grant, audience));
    }
    await this.audit.write({
      actorId: principal.accountId,
      action: "REFERRALS_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { patientId, providerId: provider.id, itemCount: items.length },
    });
    return { patientId, items };
  }

  async inbox(principal: AuthPrincipal) {
    const provider = await this.requireActiveDoctor(principal);
    const rows = await this.prisma.referral.findMany({
      where: {
        destinationProviderId: provider.id,
        status: { in: ["REQUESTED", "ACCEPTED", "IN_PROGRESS"] },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: MAX_ITEMS,
    });
    const grants = await this.grantsFor(rows.map((row) => row.id));
    const items = [];
    for (const row of rows) {
      const grant = grants.get(row.id);
      if (!grant || this.grantState(grant) !== "ACTIVE") continue;
      items.push(await this.present(row, grant, "DESTINATION_PROVIDER"));
    }
    return { items };
  }

  async act(principal: AuthPrincipal, referralId: string, raw: Record<string, unknown>) {
    const provider = await this.requireActiveDoctor(principal);
    const action = this.normalizedAction(raw);
    const referral = await this.requireReferral(referralId);
    const grant = await this.requireGrant(referral.id);
    this.assertActionActor(provider.id, referral, action);
    if (action.action !== "CANCEL" && this.grantState(grant) !== "ACTIVE") {
      throw new ForbiddenException("Referral clinical share is no longer active.");
    }
    const target = this.targetStatus(referral.status, action.action);
    const now = new Date();
    const patient = await this.requirePatient(referral.patientId);
    const timestampData = this.transitionTimestamp(target, now);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.referral.updateMany({
        where: { id: referral.id, status: referral.status, version: action.expectedVersion },
        data: { status: target, version: { increment: 1 }, ...timestampData },
      });
      if (changed.count !== 1) {
        throw new ConflictException("Referral changed concurrently. Refresh and retry.");
      }
      await tx.referralStatusEvent.create({
        data: {
          referralId: referral.id,
          fromStatus: referral.status,
          toStatus: target,
          actorAccountId: principal.accountId,
          reasonCode: action.reasonCode,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: `REFERRAL_${target}`,
        objectType: "REFERRAL",
        objectId: referral.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          patientId: referral.patientId,
          providerId: provider.id,
          destinationProviderId: referral.destinationProviderId,
          status: target,
          reasonCode: action.reasonCode,
        },
      });
      await this.notifications.enqueueAccountInTransaction(tx, {
        accountId: patient.userId,
        dedupeKey: `referral:${referral.id}:${target.toLowerCase()}:v${action.expectedVersion + 1}`,
        type: "CARE_COORDINATION",
        entityType: "REFERRAL",
        entityId: referral.id,
        safeTitleKey: "referral.status.title",
        safeBodyKey: "referral.status.body",
      });
      const current = await tx.referral.findUnique({ where: { id: referral.id } });
      if (!current) throw new NotFoundException("Referral not found after transition.");
      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.notifications.wakeOutbox();
    const audience: ReferralAudience = updated.referringProviderId === provider.id ? "REFERRING_PROVIDER" : "DESTINATION_PROVIDER";
    return this.present(updated, grant, audience);
  }

  async patientReferrals(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient referral access requires PATIENT role.");
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const rows = await this.prisma.referral.findMany({
      where: { patientId: context.patientId },
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS,
    });
    const grants = await this.grantsFor(rows.map((row) => row.id));
    const items = [];
    for (const row of rows) {
      const grant = grants.get(row.id);
      if (grant) items.push(await this.present(row, grant, "PATIENT"));
    }
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_REFERRALS_READ",
      objectType: "PATIENT",
      objectId: context.patientId,
      purpose: context.mode === "SELF" ? "PATIENT_ACCESS" : "PROXY_PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { patientId: context.patientId, itemCount: items.length },
    });
    return { patientId: context.patientId, contextMode: context.mode, items };
  }

  async revokePatientShare(principal: AuthPrincipal, referralId: string) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient referral access requires PATIENT role.");
    const context = await this.contexts.resolveEffectivePatient(principal, "CONSENT_MANAGE");
    const referral = await this.requireReferral(referralId);
    if (referral.patientId !== context.patientId) throw new NotFoundException("Referral not found.");
    const grant = await this.requireGrant(referral.id);
    if (grant.revokedAt) return this.present(referral, grant, "PATIENT");
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.clinicalShareGrant.update({
        where: { referralId: referral.id },
        data: { revokedAt: now },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "REFERRAL_SHARE_REVOKED",
        objectType: "CLINICAL_SHARE_GRANT",
        objectId: revoked.id,
        purpose: context.mode === "SELF" ? "PATIENT_ACCESS" : "PROXY_PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          patientId: context.patientId,
          destinationProviderId: referral.destinationProviderId,
          referralId: referral.id,
        },
      });
      const destination = await tx.provider.findUnique({
        where: { id: referral.destinationProviderId },
        select: { userId: true },
      });
      if (destination?.userId) {
        await this.notifications.enqueueAccountInTransaction(tx, {
          accountId: destination.userId,
          dedupeKey: `referral:${referral.id}:share-revoked`,
          type: "CARE_COORDINATION",
          entityType: "REFERRAL",
          entityId: referral.id,
          safeTitleKey: "referral.share-revoked.title",
          safeBodyKey: "referral.share-revoked.body",
        });
      }
      return revoked;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.notifications.wakeOutbox();
    return this.present(referral, updated, "PATIENT");
  }

  private async present(referral: Referral, grant: ClinicalShareGrant, audience: ReferralAudience) {
    const grantState = this.grantState(grant);
    if (audience === "DESTINATION_PROVIDER" && grantState !== "ACTIVE") {
      throw new ForbiddenException("Referral clinical share is no longer active.");
    }
    const payload = await this.envelope.decrypt<{ schemaVersion: number; reason: string }>(this.referralEnvelope(referral));
    const [referring, destination, events] = await Promise.all([
      this.prisma.provider.findUnique({ where: { id: referral.referringProviderId }, select: { displayName: true } }),
      this.prisma.provider.findUnique({ where: { id: referral.destinationProviderId }, select: { displayName: true } }),
      this.prisma.referralStatusEvent.findMany({
        where: { referralId: referral.id },
        select: { fromStatus: true, toStatus: true, reasonCode: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
    ]);
    return {
      id: referral.id,
      patientId: referral.patientId,
      referringProvider: { id: referral.referringProviderId, displayName: referring?.displayName ?? null },
      destinationProvider: { id: referral.destinationProviderId, displayName: destination?.displayName ?? null },
      specialtyCode: referral.specialtyCode,
      priority: referral.priority,
      status: referral.status,
      version: referral.version,
      reason: payload.reason,
      share: {
        id: grant.id,
        state: grantState,
        scopes: this.jsonStringArray(grant.scopes),
        documentIds: this.jsonStringArray(grant.documentIds),
        purpose: grant.purpose,
        expiresAt: grant.expiresAt,
        revokedAt: grant.revokedAt,
      },
      statusHistory: events,
      createdAt: referral.createdAt,
      updatedAt: referral.updatedAt,
      acceptedAt: referral.acceptedAt,
      startedAt: referral.startedAt,
      completedAt: referral.completedAt,
      declinedAt: referral.declinedAt,
      cancelledAt: referral.cancelledAt,
    };
  }

  private async requireActiveDoctor(principal: AuthPrincipal): Promise<DoctorContext> {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Referral workflow requires a DOCTOR account.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true, class: true },
    });
    if (!provider || provider.status !== "ACTIVE" || provider.class !== "DOCTOR") {
      throw new ForbiddenException("An active doctor profile is required.");
    }
    return { id: provider.id, accountId: principal.accountId };
  }

  private async requireDestinationDoctor(providerId: string, specialtyCode: string | null) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        userId: true,
        status: true,
        class: true,
        doctorProfile: {
          select: {
            specialties: {
              select: { specialty: { select: { code: true, active: true } } },
            },
          },
        },
      },
    });
    if (!provider || provider.status !== "ACTIVE" || provider.class !== "DOCTOR") {
      throw new BadRequestException("Referral destination must be an active doctor.");
    }
    if (specialtyCode) {
      const matches = provider.doctorProfile?.specialties.some((item) => item.specialty.active && item.specialty.code.toUpperCase() === specialtyCode) ?? false;
      if (!matches) throw new BadRequestException("Destination doctor does not have the requested active specialty.");
    }
    return { id: provider.id, accountId: provider.userId };
  }

  private async requirePatient(patientId: string) {
    if (!patientId?.trim()) throw new BadRequestException("patientId is required.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId.trim() },
      select: { id: true, userId: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");
    return patient;
  }

  private async assertTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!appointment) throw new ForbiddenException("A current treatment relationship is required for referral access.");
  }

  private async assertDocuments(patientId: string, documentIds: string[]) {
    if (documentIds.length === 0) return;
    const documents = await this.prisma.clinicalDocument.findMany({
      where: { id: { in: documentIds }, patientId, status: "AVAILABLE" },
      select: { id: true },
    });
    if (documents.length !== documentIds.length) {
      throw new BadRequestException("Every shared document must be an available document belonging to the referred patient.");
    }
  }

  private assertSharePolicies(scopes: string[]) {
    for (const scope of scopes) {
      const policy = resolveClinicalConsentPolicy(scope);
      if (!policy || !policy.temporaryShareable || policy.access !== "READ" || !policy.eligibleRoles.includes("DOCTOR")) {
        throw new BadRequestException(`Scope '${scope}' is not eligible for doctor referral sharing.`);
      }
    }
  }

  private assertActionActor(providerId: string, referral: Referral, input: ReferralActionInput) {
    if (input.action === "CANCEL") {
      if (referral.referringProviderId !== providerId) throw new ForbiddenException("Only the referring doctor can cancel this referral.");
      return;
    }
    if (referral.destinationProviderId !== providerId) {
      throw new ForbiddenException("Only the destination doctor can perform this referral action.");
    }
  }

  private transitionTimestamp(target: ReferralStatus, at: Date) {
    if (target === "ACCEPTED") return { acceptedAt: at };
    if (target === "IN_PROGRESS") return { startedAt: at };
    if (target === "COMPLETED") return { completedAt: at };
    if (target === "DECLINED") return { declinedAt: at };
    if (target === "CANCELLED") return { cancelledAt: at };
    return {};
  }

  private async requireReferral(referralId: string) {
    if (!referralId?.trim()) throw new BadRequestException("referralId is required.");
    const referral = await this.prisma.referral.findUnique({ where: { id: referralId.trim() } });
    if (!referral) throw new NotFoundException("Referral not found.");
    return referral;
  }

  private async requireGrant(referralId: string) {
    const grant = await this.prisma.clinicalShareGrant.findUnique({ where: { referralId } });
    if (!grant) throw new ConflictException("Referral share grant is missing.");
    return grant;
  }

  private async grantsFor(referralIds: string[]) {
    if (referralIds.length === 0) return new Map<string, ClinicalShareGrant>();
    const rows = await this.prisma.clinicalShareGrant.findMany({ where: { referralId: { in: referralIds } } });
    return new Map(rows.map((row) => [row.referralId, row]));
  }

  private grantState(grant: ClinicalShareGrant): GrantState {
    if (grant.revokedAt) return "REVOKED";
    if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) return "EXPIRED";
    return "ACTIVE";
  }

  private referralEnvelope(referral: Referral): EncryptedEnvelope {
    if (referral.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported referral encryption algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: referral.keyId,
      wrappedKey: referral.wrappedKey,
      iv: referral.iv,
      ciphertext: referral.ciphertext,
    };
  }

  private jsonStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  private normalizedInput(raw: Record<string, unknown>): ReferralInput {
    try { return normalizeReferralInput(raw); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid referral input."); }
  }

  private normalizedAction(raw: Record<string, unknown>): ReferralActionInput {
    try { return normalizeReferralAction(raw); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid referral action."); }
  }

  private targetStatus(status: string, action: ReferralActionInput["action"]): ReferralStatus {
    if (!["REQUESTED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "DECLINED", "CANCELLED"].includes(status)) {
      throw new ConflictException("Referral status is invalid.");
    }
    try { return referralTargetStatus(status as ReferralStatus, action); }
    catch (error) { throw new ConflictException(error instanceof Error ? error.message : "Invalid referral transition."); }
  }
}
