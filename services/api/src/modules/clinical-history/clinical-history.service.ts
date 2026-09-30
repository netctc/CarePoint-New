import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decideClinicalResourceAccess, type AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";

const PROFILE_READ_SCOPE = "CLINICAL_PROFILE_READ";
const PROFILE_WRITE_SCOPE = "CLINICAL_PROFILE_WRITE";
const PROFILE_CONSENT_VERSION = "clinical-profile-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

export interface ClinicalSourceInput {
  kind?: "PATIENT_REPORTED" | "PROVIDER_RECORDED" | "IMPORTED" | string;
  system?: string;
  externalId?: string;
  documentId?: string;
}

export interface CreateHospitalizationInput {
  idempotencyKey: string;
  admittedOn: string;
  dischargedOn?: string | null;
  facility?: string;
  reason?: string;
  status?: string;
  source?: ClinicalSourceInput;
}

export interface UpdateHospitalizationInput extends Omit<CreateHospitalizationInput, "idempotencyKey"> {
  expectedVersion: number;
}

export interface CreateImmunizationInput {
  idempotencyKey: string;
  occurredOn: string;
  vaccineCodeSystem?: string;
  vaccineCode?: string;
  vaccineDisplay?: string;
  doseNumber?: string;
  lotNumber?: string;
  manufacturer?: string;
  route?: string;
  site?: string;
  status?: string;
  source?: ClinicalSourceInput;
}

export interface UpdateImmunizationInput extends Omit<CreateImmunizationInput, "idempotencyKey"> {
  expectedVersion: number;
}

type ClinicalSource = {
  kind: "PATIENT_REPORTED" | "PROVIDER_RECORDED" | "IMPORTED";
  system?: string | undefined;
  externalId?: string | undefined;
  documentId?: string | undefined;
};

type HospitalizationPayload = {
  schemaVersion: 1;
  admittedOn: string;
  dischargedOn?: string | undefined;
  facility?: string | undefined;
  reason?: string | undefined;
  source: ClinicalSource;
};

type ImmunizationPayload = {
  schemaVersion: 1;
  occurredOn: string;
  vaccineCodeSystem?: string | undefined;
  vaccineCode?: string | undefined;
  vaccineDisplay?: string | undefined;
  doseNumber?: string | undefined;
  lotNumber?: string | undefined;
  manufacturer?: string | undefined;
  route?: string | undefined;
  site?: string | undefined;
  source: ClinicalSource;
};

@Injectable()
export class ClinicalHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async listHospitalizationsMine(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    return this.listHospitalizations(patient.id, "PATIENT_SELF", principal.accountId);
  }

  async createHospitalizationMine(principal: AuthPrincipal, input: CreateHospitalizationInput) {
    const patient = await this.requirePatient(principal);
    return this.createHospitalization(principal, patient.id, input, "PATIENT_SELF", "PATIENT_REPORTED");
  }

  async updateHospitalizationMine(principal: AuthPrincipal, id: string, input: UpdateHospitalizationInput) {
    const patient = await this.requirePatient(principal);
    return this.updateHospitalization(principal, patient.id, id, input, "PATIENT_SELF", "PATIENT_REPORTED");
  }

  async listHospitalizationsForDoctor(principal: AuthPrincipal, patientId: string) {
    const access = await this.requireDoctorAccess(principal, patientId, "READ");
    return this.listHospitalizations(patientId, access.basis, principal.accountId);
  }

  async createHospitalizationForDoctor(principal: AuthPrincipal, patientId: string, input: CreateHospitalizationInput) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    return this.createHospitalization(principal, patientId, input, access.basis, "PROVIDER_RECORDED");
  }

  async updateHospitalizationForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    id: string,
    input: UpdateHospitalizationInput,
  ) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    return this.updateHospitalization(principal, patientId, id, input, access.basis, "PROVIDER_RECORDED");
  }

  async listImmunizationsMine(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    return this.listImmunizations(patient.id, "PATIENT_SELF", principal.accountId);
  }

  async createImmunizationMine(principal: AuthPrincipal, input: CreateImmunizationInput) {
    const patient = await this.requirePatient(principal);
    return this.createImmunization(principal, patient.id, input, "PATIENT_SELF", "PATIENT_REPORTED");
  }

  async updateImmunizationMine(principal: AuthPrincipal, id: string, input: UpdateImmunizationInput) {
    const patient = await this.requirePatient(principal);
    return this.updateImmunization(principal, patient.id, id, input, "PATIENT_SELF", "PATIENT_REPORTED");
  }

  async listImmunizationsForDoctor(principal: AuthPrincipal, patientId: string) {
    const access = await this.requireDoctorAccess(principal, patientId, "READ");
    return this.listImmunizations(patientId, access.basis, principal.accountId);
  }

  async createImmunizationForDoctor(principal: AuthPrincipal, patientId: string, input: CreateImmunizationInput) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    return this.createImmunization(principal, patientId, input, access.basis, "PROVIDER_RECORDED");
  }

  async updateImmunizationForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    id: string,
    input: UpdateImmunizationInput,
  ) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    return this.updateImmunization(principal, patientId, id, input, access.basis, "PROVIDER_RECORDED");
  }

  private async listHospitalizations(patientId: string, accessBasis: string, actorId: string) {
    const rows = await this.prisma.hospitalization.findMany({
      where: { patientId },
      orderBy: [{ admittedOn: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    const items = [];
    for (const row of rows) {
      items.push(this.presentHospitalization(row, await this.decrypt<HospitalizationPayload>(row), accessBasis));
    }
    await this.audit.writeClinical({
      actorId,
      action: "HOSPITALIZATION_LIST_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
      result: "SUCCESS",
      metadata: { domain: "HOSPITALIZATION", patientId, accessBasis, itemCount: items.length, decision: "ALLOW" },
    });
    return { patientId, accessBasis, items };
  }

  private async createHospitalization(
    principal: AuthPrincipal,
    patientId: string,
    input: CreateHospitalizationInput,
    accessBasis: string,
    defaultSource: ClinicalSource["kind"],
  ) {
    const idempotencyKey = this.identifier(input?.idempotencyKey, "idempotencyKey");
    const payload = this.hospitalizationPayload(input, defaultSource, principal.role === "DOCTOR");
    const status = this.hospitalizationStatus(input?.status, payload.dischargedOn);
    const logicalKey = this.digest([patientId, payload.admittedOn, payload.facility ?? "", payload.source.externalId ?? ""]);
    const requestDigest = this.digest([patientId, status, JSON.stringify(payload)]);
    const existing = await this.prisma.hospitalization.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patientId || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey has already been used for a different hospitalization request.");
      }
      return this.presentHospitalization(existing, await this.decrypt<HospitalizationPayload>(existing), accessBasis);
    }
    const encrypted = await this.envelope.encryptRecord(payload);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.hospitalization.create({
          data: {
            patientId,
            version: 1,
            status,
            admittedOn: this.dateValue(payload.admittedOn),
            dischargedOn: payload.dischargedOn ? this.dateValue(payload.dischargedOn) : null,
            logicalKey,
            idempotencyKey,
            requestDigest,
            sourceType: payload.source.kind,
            sourceActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await tx.hospitalizationRevision.create({
          data: {
            hospitalizationId: created.id,
            version: 1,
            status,
            sourceType: payload.source.kind,
            sourceActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "HOSPITALIZATION_CREATED",
          objectType: "HOSPITALIZATION",
          objectId: created.id,
          purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
          result: "SUCCESS",
          metadata: {
            domain: "HOSPITALIZATION",
            patientId,
            resourceId: created.id,
            resourceVersion: 1,
            sourceType: payload.source.kind,
            status,
            accessBasis,
            decision: "ALLOW",
          },
        });
        return created;
      });
      return this.presentHospitalization(row, payload, accessBasis);
    } catch (error) {
      this.rethrowDuplicate(error, "An equivalent hospitalization already exists for this patient and source.");
      throw error;
    }
  }

  private async updateHospitalization(
    principal: AuthPrincipal,
    patientId: string,
    id: string,
    input: UpdateHospitalizationInput,
    accessBasis: string,
    defaultSource: ClinicalSource["kind"],
  ) {
    const expectedVersion = this.nonNegativeInteger(input?.expectedVersion, "expectedVersion");
    const observed = await this.prisma.hospitalization.findUnique({ where: { id } });
    if (!observed || observed.patientId !== patientId) throw new NotFoundException("Hospitalization not found.");
    if (observed.version !== expectedVersion) {
      throw new ConflictException({ message: "Hospitalization version conflict.", currentVersion: observed.version });
    }
    const previous = await this.decrypt<HospitalizationPayload>(observed);
    const payload = this.hospitalizationPayload(input, defaultSource, principal.role === "DOCTOR", previous);
    const status = this.hospitalizationStatus(input?.status ?? observed.status, payload.dischargedOn);
    const logicalKey = this.digest([patientId, payload.admittedOn, payload.facility ?? "", payload.source.externalId ?? ""]);
    const encrypted = await this.envelope.encryptRecord(payload);
    const nextVersion = expectedVersion + 1;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Hospitalization" WHERE id = ${id} FOR UPDATE`);
        const current = await tx.hospitalization.findUnique({ where: { id } });
        if (!current || current.patientId !== patientId) throw new NotFoundException("Hospitalization not found.");
        if (current.version !== expectedVersion) {
          throw new ConflictException({ message: "Hospitalization version conflict.", currentVersion: current.version });
        }
        const updated = await tx.hospitalization.update({
          where: { id },
          data: {
            version: nextVersion,
            status,
            admittedOn: this.dateValue(payload.admittedOn),
            dischargedOn: payload.dischargedOn ? this.dateValue(payload.dischargedOn) : null,
            logicalKey,
            sourceType: payload.source.kind,
            sourceActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await tx.hospitalizationRevision.create({
          data: {
            hospitalizationId: id,
            version: nextVersion,
            status,
            sourceType: payload.source.kind,
            sourceActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "HOSPITALIZATION_UPDATED",
          objectType: "HOSPITALIZATION",
          objectId: id,
          purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
          result: "SUCCESS",
          metadata: {
            domain: "HOSPITALIZATION",
            patientId,
            resourceId: id,
            resourceVersion: nextVersion,
            sourceType: payload.source.kind,
            status,
            accessBasis,
            decision: "ALLOW",
          },
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.presentHospitalization(row, payload, accessBasis);
    } catch (error) {
      this.rethrowDuplicate(error, "An equivalent hospitalization already exists for this patient and source.");
      throw error;
    }
  }

  private async listImmunizations(patientId: string, accessBasis: string, actorId: string) {
    const rows = await this.prisma.immunization.findMany({
      where: { patientId },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    const items = [];
    for (const row of rows) {
      items.push(this.presentImmunization(row, await this.decrypt<ImmunizationPayload>(row), accessBasis));
    }
    await this.audit.writeClinical({
      actorId,
      action: "IMMUNIZATION_LIST_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
      result: "SUCCESS",
      metadata: { domain: "IMMUNIZATION", patientId, accessBasis, itemCount: items.length, decision: "ALLOW" },
    });
    return { patientId, accessBasis, items };
  }

  private async createImmunization(
    principal: AuthPrincipal,
    patientId: string,
    input: CreateImmunizationInput,
    accessBasis: string,
    defaultSource: ClinicalSource["kind"],
  ) {
    const idempotencyKey = this.identifier(input?.idempotencyKey, "idempotencyKey");
    const payload = this.immunizationPayload(input, defaultSource, principal.role === "DOCTOR");
    const status = this.immunizationStatus(input?.status);
    const logicalKey = this.immunizationLogicalKey(patientId, payload);
    const requestDigest = this.digest([patientId, status, JSON.stringify(payload)]);
    const existing = await this.prisma.immunization.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patientId || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey has already been used for a different immunization request.");
      }
      return this.presentImmunization(existing, await this.decrypt<ImmunizationPayload>(existing), accessBasis);
    }
    const encrypted = await this.envelope.encryptRecord(payload);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.immunization.create({
          data: {
            patientId,
            version: 1,
            status,
            occurredOn: this.dateValue(payload.occurredOn),
            logicalKey,
            idempotencyKey,
            requestDigest,
            sourceType: payload.source.kind,
            sourceActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await tx.immunizationRevision.create({
          data: {
            immunizationId: created.id,
            version: 1,
            status,
            sourceType: payload.source.kind,
            sourceActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "IMMUNIZATION_CREATED",
          objectType: "IMMUNIZATION",
          objectId: created.id,
          purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
          result: "SUCCESS",
          metadata: {
            domain: "IMMUNIZATION",
            patientId,
            resourceId: created.id,
            resourceVersion: 1,
            sourceType: payload.source.kind,
            status,
            accessBasis,
            decision: "ALLOW",
          },
        });
        return created;
      });
      return this.presentImmunization(row, payload, accessBasis);
    } catch (error) {
      this.rethrowDuplicate(error, "An exact immunization duplicate already exists for this patient.");
      throw error;
    }
  }

  private async updateImmunization(
    principal: AuthPrincipal,
    patientId: string,
    id: string,
    input: UpdateImmunizationInput,
    accessBasis: string,
    defaultSource: ClinicalSource["kind"],
  ) {
    const expectedVersion = this.nonNegativeInteger(input?.expectedVersion, "expectedVersion");
    const observed = await this.prisma.immunization.findUnique({ where: { id } });
    if (!observed || observed.patientId !== patientId) throw new NotFoundException("Immunization not found.");
    if (observed.version !== expectedVersion) {
      throw new ConflictException({ message: "Immunization version conflict.", currentVersion: observed.version });
    }
    const previous = await this.decrypt<ImmunizationPayload>(observed);
    const payload = this.immunizationPayload(input, defaultSource, principal.role === "DOCTOR", previous);
    const status = this.immunizationStatus(input?.status ?? observed.status);
    const logicalKey = this.immunizationLogicalKey(patientId, payload);
    const encrypted = await this.envelope.encryptRecord(payload);
    const nextVersion = expectedVersion + 1;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Immunization" WHERE id = ${id} FOR UPDATE`);
        const current = await tx.immunization.findUnique({ where: { id } });
        if (!current || current.patientId !== patientId) throw new NotFoundException("Immunization not found.");
        if (current.version !== expectedVersion) {
          throw new ConflictException({ message: "Immunization version conflict.", currentVersion: current.version });
        }
        const updated = await tx.immunization.update({
          where: { id },
          data: {
            version: nextVersion,
            status,
            occurredOn: this.dateValue(payload.occurredOn),
            logicalKey,
            sourceType: payload.source.kind,
            sourceActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await tx.immunizationRevision.create({
          data: {
            immunizationId: id,
            version: nextVersion,
            status,
            sourceType: payload.source.kind,
            sourceActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "IMMUNIZATION_UPDATED",
          objectType: "IMMUNIZATION",
          objectId: id,
          purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
          result: "SUCCESS",
          metadata: {
            domain: "IMMUNIZATION",
            patientId,
            resourceId: id,
            resourceVersion: nextVersion,
            sourceType: payload.source.kind,
            status,
            accessBasis,
            decision: "ALLOW",
          },
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.presentImmunization(row, payload, accessBasis);
    } catch (error) {
      this.rethrowDuplicate(error, "An exact immunization duplicate already exists for this patient.");
      throw error;
    }
  }

  private hospitalizationPayload(
    input: Partial<CreateHospitalizationInput>,
    defaultSource: ClinicalSource["kind"],
    providerMayImport: boolean,
    previous?: HospitalizationPayload,
  ): HospitalizationPayload {
    const admittedOn = this.date(input.admittedOn ?? previous?.admittedOn, "admittedOn");
    const dischargedOn = this.optionalDate(
      input.dischargedOn === undefined ? previous?.dischargedOn : input.dischargedOn,
      "dischargedOn",
    );
    if (dischargedOn && dischargedOn < admittedOn) {
      throw new BadRequestException("dischargedOn cannot precede admittedOn.");
    }
    return this.compact({
      schemaVersion: 1 as const,
      admittedOn,
      dischargedOn,
      facility: this.optionalText(input.facility === undefined ? previous?.facility : input.facility, "facility", 300),
      reason: this.optionalText(input.reason === undefined ? previous?.reason : input.reason, "reason", 1000),
      source: this.source(input.source, previous?.source, defaultSource, providerMayImport),
    });
  }

  private immunizationPayload(
    input: Partial<CreateImmunizationInput>,
    defaultSource: ClinicalSource["kind"],
    providerMayImport: boolean,
    previous?: ImmunizationPayload,
  ): ImmunizationPayload {
    const vaccineCode = this.optionalText(
      input.vaccineCode === undefined ? previous?.vaccineCode : input.vaccineCode,
      "vaccineCode",
      120,
    );
    const vaccineDisplay = this.optionalText(
      input.vaccineDisplay === undefined ? previous?.vaccineDisplay : input.vaccineDisplay,
      "vaccineDisplay",
      300,
    );
    if (!vaccineCode && !vaccineDisplay) {
      throw new BadRequestException("vaccineCode or vaccineDisplay is required.");
    }
    return this.compact({
      schemaVersion: 1 as const,
      occurredOn: this.date(input.occurredOn ?? previous?.occurredOn, "occurredOn"),
      vaccineCodeSystem: this.optionalText(
        input.vaccineCodeSystem === undefined ? previous?.vaccineCodeSystem : input.vaccineCodeSystem,
        "vaccineCodeSystem",
        240,
      ),
      vaccineCode,
      vaccineDisplay,
      doseNumber: this.optionalText(input.doseNumber === undefined ? previous?.doseNumber : input.doseNumber, "doseNumber", 60),
      lotNumber: this.optionalText(input.lotNumber === undefined ? previous?.lotNumber : input.lotNumber, "lotNumber", 120),
      manufacturer: this.optionalText(input.manufacturer === undefined ? previous?.manufacturer : input.manufacturer, "manufacturer", 240),
      route: this.optionalText(input.route === undefined ? previous?.route : input.route, "route", 120),
      site: this.optionalText(input.site === undefined ? previous?.site : input.site, "site", 120),
      source: this.source(input.source, previous?.source, defaultSource, providerMayImport),
    });
  }

  private source(
    input: ClinicalSourceInput | undefined,
    previous: ClinicalSource | undefined,
    defaultKind: ClinicalSource["kind"],
    providerMayImport: boolean,
  ): ClinicalSource {
    const requested = input?.kind?.trim().toUpperCase();
    const kind = requested
      ? requested === "IMPORTED" && providerMayImport
        ? "IMPORTED"
        : requested === "PROVIDER_RECORDED" && providerMayImport
          ? "PROVIDER_RECORDED"
          : requested === "PATIENT_REPORTED" && defaultKind === "PATIENT_REPORTED"
            ? "PATIENT_REPORTED"
            : (() => { throw new BadRequestException("source.kind is not allowed for this actor."); })()
      : previous?.kind ?? defaultKind;
    return this.compact({
      kind,
      system: this.optionalText(input?.system === undefined ? previous?.system : input.system, "source.system", 240),
      externalId: this.optionalText(
        input?.externalId === undefined ? previous?.externalId : input.externalId,
        "source.externalId",
        240,
      ),
      documentId: this.optionalText(
        input?.documentId === undefined ? previous?.documentId : input.documentId,
        "source.documentId",
        240,
      ),
    });
  }

  private hospitalizationStatus(value: unknown, dischargedOn?: string) {
    if (value === undefined || value === null || value === "") return dischargedOn ? "COMPLETED" : "ACTIVE";
    return this.enumValue(value, ["ACTIVE", "COMPLETED", "ENTERED_IN_ERROR"] as const, "status");
  }

  private immunizationStatus(value: unknown) {
    if (value === undefined || value === null || value === "") return "COMPLETED";
    return this.enumValue(value, ["COMPLETED", "ENTERED_IN_ERROR"] as const, "status");
  }

  private immunizationLogicalKey(patientId: string, payload: ImmunizationPayload) {
    return this.digest([
      patientId,
      (payload.vaccineCodeSystem ?? "").toLowerCase(),
      (payload.vaccineCode ?? payload.vaccineDisplay ?? "").toLowerCase(),
      payload.occurredOn,
      (payload.doseNumber ?? "").toLowerCase(),
      (payload.lotNumber ?? "").toLowerCase(),
    ]);
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string, action: "READ" | "WRITE") {
    if (principal.role !== "DOCTOR") {
      throw new ForbiddenException("Clinical history provider access requires DOCTOR role.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active doctor provider profile is required.");
    }
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 86400000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 86400000);
    const scope = action === "READ" ? PROFILE_READ_SCOPE : PROFILE_WRITE_SCOPE;
    const [relationship, consent] = await Promise.all([
      this.prisma.appointment.findFirst({
        where: {
          providerId: provider.id,
          patientId,
          status: { in: ["CONFIRMED", "COMPLETED"] },
          startsAt: { gte: from, lte: to },
        },
        select: { id: true },
      }),
      this.prisma.consent.findFirst({
        where: {
          patientId,
          scope,
          version: PROFILE_CONSENT_VERSION,
          purpose: "TREATMENT",
          state: "GRANTED",
          AND: [
            { OR: [{ providerId: provider.id }, { providerId: null }] },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
        },
        select: { id: true },
        orderBy: { grantedAt: "desc" },
      }),
    ]);
    const decision = decideClinicalResourceAccess({
      principal,
      action,
      providerActive: true,
      capabilityAllowed: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: Boolean(relationship),
      sensitivityAllowed: true,
      isAssignedProvider: action === "WRITE" && Boolean(relationship),
      hasTreatmentRelationship: false,
      hasPatientConsent: action === "READ" ? Boolean(consent) : false,
    });
    if (!relationship || !consent || !decision.allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: `CLINICAL_HISTORY_${action}_DENIED`,
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "CLINICAL_HISTORY",
          patientId,
          providerId: provider.id,
          consentVersion: PROFILE_CONSENT_VERSION,
          decision: "DENY",
        },
      });
      throw new ForbiddenException("Clinical history access denied.");
    }
    return {
      basis: action === "WRITE" ? "TREATMENT_RELATIONSHIP" : decision.basis,
      providerId: provider.id,
    };
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") {
      throw new ForbiddenException("Patient clinical history access requires PATIENT role.");
    }
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private presentHospitalization(row: any, payload: HospitalizationPayload, accessBasis: string) {
    return {
      id: row.id,
      patientId: row.patientId,
      version: row.version,
      status: row.status,
      admittedOn: payload.admittedOn,
      dischargedOn: payload.dischargedOn ?? null,
      facility: payload.facility ?? null,
      reason: payload.reason ?? null,
      source: payload.source,
      sourceType: row.sourceType,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessBasis,
    };
  }

  private presentImmunization(row: any, payload: ImmunizationPayload, accessBasis: string) {
    return {
      id: row.id,
      patientId: row.patientId,
      version: row.version,
      status: row.status,
      occurredOn: payload.occurredOn,
      vaccineCodeSystem: payload.vaccineCodeSystem ?? null,
      vaccineCode: payload.vaccineCode ?? null,
      vaccineDisplay: payload.vaccineDisplay ?? null,
      doseNumber: payload.doseNumber ?? null,
      lotNumber: payload.lotNumber ?? null,
      manufacturer: payload.manufacturer ?? null,
      route: payload.route ?? null,
      site: payload.site ?? null,
      source: payload.source,
      sourceType: row.sourceType,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessBasis,
    };
  }

  private decrypt<T>(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    return this.envelope.decryptRecord<T>({
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

  private date(value: unknown, field: string) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field} must use YYYY-MM-DD.`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value;
  }

  private optionalDate(value: unknown, field: string) {
    if (value === undefined || value === null || value === "") return undefined;
    return this.date(value, field);
  }

  private dateValue(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private optionalText(value: unknown, field: string, max: number): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new BadRequestException(`${field} is invalid.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== "string") throw new BadRequestException(`${field} is invalid.`);
    const normalized = value.trim().toUpperCase() as T;
    if (!allowed.includes(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{8,180}$/.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private nonNegativeInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new BadRequestException(`${field} must be a positive integer.`);
    }
    return Number(value);
  }

  private digest(parts: string[]) {
    return createHash("sha256").update(parts.join("\u001f")).digest("hex");
  }

  private compact<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
  }

  private rethrowDuplicate(error: unknown, message: string): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictException(message);
    }
  }
}
