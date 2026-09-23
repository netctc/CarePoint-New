import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { decideClinicalResourceAccess, type AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import {
  assertCanonicalRange,
  convertMeasurement,
  normalizeMetricCode,
  normalizeObservedAt,
  normalizeUnitCode,
  type ConversionRule,
} from "./observation.engine";
import {
  assertProviderEncounterBinding,
  normalizeProviderObservationInput,
  providerObservationProvenance,
  type ProviderObservationInput,
} from "./provider-observation.engine";

const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

type StoredProviderObservation = {
  schemaVersion: 1;
  metricCode: string;
  metricVersion: number;
  originalValue: number;
  originalUnitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  verificationStatus: "PROVIDER_VERIFIED";
  providerId: string;
  encounterId: string | null;
  automatedDiagnosis: false;
};

@Injectable()
export class ProviderObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async catalog(principal: AuthPrincipal) {
    const scope = await this.providerObservationScope(principal);
    if (scope !== null && scope.size === 0) return { items: [], capabilityEnforced: true };
    const versions = await this.prisma.observationTypeVersion.findMany({
      where: {
        status: "ACTIVE",
        observationType: {
          active: true,
          ...(scope === null ? {} : { code: { in: [...scope] } }),
        },
      },
      include: { observationType: true },
      orderBy: { observationType: { code: "asc" } },
    });
    return {
      items: versions.map((item) => ({
        id: item.observationType.id,
        code: item.observationType.code,
        labels: item.observationType.labels,
        category: item.observationType.category,
        version: item.version,
        canonicalUnitCode: item.canonicalUnitCode,
        allowedUnitCodes: this.jsonStringArray(item.allowedUnitCodes),
        precision: item.precision,
      })),
      capabilityEnforced: principal.role === "OTHER_PROVIDER",
    };
  }

  async record(principal: AuthPrincipal, patientId: string, raw: Record<string, unknown>) {
    const input = this.input(raw);
    const code = normalizeMetricCode(input.code);
    const provider = await this.requireProvider(principal, code);
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: this.id(patientId, "patientId") },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");
    const observedAt = normalizeObservedAt(input.observedAt);

    let encounter: { id: string; patientId: string; providerId: string; status: string } | null = null;
    if (input.encounterId) {
      const row = await this.prisma.appointment.findUnique({
        where: { id: input.encounterId },
        select: { id: true, patientId: true, providerId: true, status: true },
      });
      try {
        encounter = assertProviderEncounterBinding(row, patient.id, provider.id);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Invalid encounter binding.");
      }
    }

    const relationship = encounter ?? await this.currentTreatmentRelationship(provider.id, patient.id);
    const decision = decideClinicalResourceAccess({
      principal,
      action: "WRITE",
      providerActive: true,
      capabilityAllowed: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: Boolean(relationship),
      sensitivityAllowed: true,
      isAssignedProvider: Boolean(relationship),
    });
    if (!relationship || !decision.allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "PROVIDER_OBSERVATION_WRITE_DENIED",
        objectType: "PATIENT",
        objectId: patient.id,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "OBSERVATION",
          patientId: patient.id,
          providerId: provider.id,
          decision: "DENY",
        },
      });
      throw new ForbiddenException("Provider observation write requires a current treatment assignment.");
    }

    const version = await this.prisma.observationTypeVersion.findFirst({
      where: { status: "ACTIVE", observationType: { code, active: true } },
      include: { observationType: true },
      orderBy: { version: "desc" },
    });
    if (!version) throw new NotFoundException("Active observation type not found.");

    const originalUnitCode = normalizeUnitCode(input.unitCode);
    const allowed = this.jsonStringArray(version.allowedUnitCodes);
    if (!allowed.includes(originalUnitCode)) {
      throw new BadRequestException("unitCode is not allowed for this observation type.");
    }
    const conversions = await this.conversions(originalUnitCode, version.canonicalUnitCode);
    const normalized = convertMeasurement(
      input.value,
      originalUnitCode,
      version.canonicalUnitCode,
      version.precision,
      conversions,
    );
    assertCanonicalRange(normalized.canonicalValue, version.minCanonical, version.maxCanonical);

    const provenance = providerObservationProvenance(provider.id, encounter?.id ?? null);
    const payload: StoredProviderObservation = {
      schemaVersion: 1,
      metricCode: version.observationType.code,
      metricVersion: version.version,
      originalValue: normalized.originalValue,
      originalUnitCode: normalized.originalUnitCode,
      canonicalValue: normalized.canonicalValue,
      canonicalUnitCode: normalized.canonicalUnitCode,
      verificationStatus: provenance.verificationStatus,
      providerId: provider.id,
      encounterId: provenance.encounterId,
      automatedDiagnosis: false,
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    const row = await this.prisma.observation.create({
      data: {
        patientId: patient.id,
        observationTypeId: version.observationTypeId,
        observationTypeVersionId: version.id,
        observedAt,
        sourceType: provenance.sourceType,
        sourceId: provenance.sourceId,
        createdByActorId: principal.accountId,
        ...this.envelopeData(encrypted),
      },
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROVIDER_OBSERVATION_RECORDED",
      objectType: "OBSERVATION",
      objectId: row.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OBSERVATION",
        accessBasis: decision.basis,
        patientId: patient.id,
        providerId: provider.id,
        resourceId: row.id,
        resourceVersion: version.version,
        sourceType: "PROVIDER",
        encounterBound: Boolean(encounter),
        decision: "ALLOW",
      },
    });

    return {
      id: row.id,
      patientId: patient.id,
      code: payload.metricCode,
      labels: version.observationType.labels,
      metricVersion: payload.metricVersion,
      value: payload.originalValue,
      unitCode: payload.originalUnitCode,
      canonicalValue: payload.canonicalValue,
      canonicalUnitCode: payload.canonicalUnitCode,
      verificationStatus: payload.verificationStatus,
      observedAt: row.observedAt,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      providerId: payload.providerId,
      encounterId: payload.encounterId,
      recordedAt: row.createdAt,
      accessBasis: decision.basis,
      automatedDiagnosis: false,
    };
  }

  private async requireProvider(principal: AuthPrincipal, code: string) {
    if (principal.role === "DOCTOR") {
      const provider = await this.prisma.provider.findUnique({
        where: { userId: principal.accountId },
        select: { id: true, class: true, status: true },
      });
      if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") {
        throw new ForbiddenException("An active doctor provider profile is required.");
      }
      return provider;
    }
    if (principal.role === "OTHER_PROVIDER") {
      const context = await this.capabilities.workspaceContext(principal);
      if (!context.observationCodes.has(code)) {
        throw new ForbiddenException(`Other Provider category is not authorized for observation ${code}.`);
      }
      return { id: context.providerId, class: "OTHER_PROVIDER", status: "ACTIVE" };
    }
    throw new ForbiddenException("Provider observation entry requires an active healthcare provider role.");
  }

  private async providerObservationScope(principal: AuthPrincipal): Promise<Set<string> | null> {
    if (principal.role === "DOCTOR") return null;
    if (principal.role === "OTHER_PROVIDER") {
      const context = await this.capabilities.workspaceContext(principal);
      return context.observationCodes;
    }
    throw new ForbiddenException("Provider observation catalog requires an active healthcare provider role.");
  }

  private async currentTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true, patientId: true, providerId: true, status: true },
      orderBy: { startsAt: "desc" },
    });
  }

  private async conversions(fromUnitCode: string, toUnitCode: string): Promise<ConversionRule[]> {
    if (fromUnitCode === toUnitCode) return [];
    const rows = await this.prisma.unitConversion.findMany({
      where: {
        active: true,
        OR: [
          { fromUnitCode, toUnitCode },
          { fromUnitCode: toUnitCode, toUnitCode: fromUnitCode },
        ],
      },
      orderBy: { version: "desc" },
    });
    const latest = new Map<string, ConversionRule>();
    for (const row of rows) {
      const key = `${row.fromUnitCode}->${row.toUnitCode}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return [...latest.values()];
  }

  private input(raw: Record<string, unknown>): ProviderObservationInput {
    try {
      return normalizeProviderObservationInput(raw);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid provider observation input.");
    }
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private jsonStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
