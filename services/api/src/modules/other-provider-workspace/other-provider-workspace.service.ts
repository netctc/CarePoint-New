import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { decideClinicalResourceAccess, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { buildObservationTrend, type TrendObservation } from "../observation/observation-trend.engine";
import {
  ProviderCategoryCapabilityService,
  type OtherProviderCapabilityContext,
} from "../providers/provider-category-capability.service";
import type { ClinicalSummarySection } from "../providers/provider-category-capabilities";

const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const MAX_OBSERVATIONS_PER_METRIC = 30;

type PatientContextType =
  | "PATIENT"
  | "APPOINTMENT"
  | "MEDICAL_TRANSPORT"
  | "EMERGENCY_AMBULANCE";

type Section =
  | { state: "AVAILABLE"; items: unknown[]; accessBasis: string }
  | { state: "RESTRICTED"; reason: "CAPABILITY_NOT_GRANTED" | "CONSENT_REQUIRED" };

@Injectable()
export class OtherProviderWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async workspace(
    principal: AuthPrincipal,
    patientId: string,
    rawContextType?: string,
    contextId?: string,
  ) {
    const context = await this.capabilities.workspaceContext(principal);
    const contextType = this.contextType(rawContextType);
    const patientContext = await this.requirePatientContext(
      context,
      patientId,
      contextType,
      contextId,
    );

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");

    const sectionNames: ClinicalSummarySection[] = [
      "HEALTH_PROFILE",
      "ALLERGIES",
      "CONDITIONS",
      "MEDICATIONS",
    ];
    const sections: Record<string, Section> = {};
    for (const section of sectionNames) {
      sections[section] = await this.clinicalSection(
        principal,
        context,
        patientId,
        section,
      );
    }

    const observations = [];
    for (const code of [...context.observationCodes].sort()) {
      observations.push({
        code,
        section: await this.observationSection(
          principal,
          context,
          patientId,
          code,
        ),
      });
    }

    const restrictedCount = [
      ...Object.values(sections),
      ...observations.map((item) => item.section),
    ].filter((item) => item.state === "RESTRICTED").length;

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OTHER_PROVIDER_CAPABILITY_WORKSPACE_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_WORKSPACE",
        patientId: patient.id,
        providerId: context.providerId,
        itemCount: observations.length,
        decision: "ALLOW",
      },
    });

    return {
      patient,
      viewer: {
        providerId: context.providerId,
        categoryId: context.categoryId,
        categorySlug: context.categorySlug,
        family: context.family,
      },
      context: patientContext,
      capabilityMatrix: {
        clinicalSummarySections: [...context.clinicalSummarySections].sort(),
        observationCodes: [...context.observationCodes].sort(),
        questionnaireCodes: [...context.questionnaireCodes].sort(),
        workflowCapabilities: [...context.workflowCapabilities].sort(),
      },
      sections,
      observations,
      security: {
        providerCategoryCapabilityEnforced: true,
        patientContextVerified: true,
        granularConsentEnforced: true,
        restrictedSectionCount: restrictedCount,
        automatedClinicalInference: false,
      },
    };
  }

  async observationTrends(
    principal: AuthPrincipal,
    patientId: string,
    rawContextType?: string,
    contextId?: string,
  ) {
    const workspace = await this.workspace(principal, patientId, rawContextType, contextId);
    const trends = workspace.observations.flatMap((entry) => {
      if (entry.section.state !== "AVAILABLE") return [];
      const points: TrendObservation[] = entry.section.items.flatMap((raw) => {
        const item = this.object(raw);
        const value = this.finiteNumber(item.value);
        const canonicalValue = this.finiteNumber(item.canonicalValue);
        const unitCode = this.stringValue(item.unitCode);
        const canonicalUnitCode = this.stringValue(item.canonicalUnitCode);
        const id = this.stringValue(item.id);
        const observedAt = this.stringValue(item.observedAt) || (item.observedAt instanceof Date ? item.observedAt.toISOString() : "");
        const sourceType = this.stringValue(item.sourceType);
        if (value === null || canonicalValue === null || !unitCode || !canonicalUnitCode || !id || !observedAt || !sourceType) {
          return [];
        }
        return [{
          id,
          observedAt,
          value,
          unitCode,
          canonicalValue,
          canonicalUnitCode,
          sourceType,
          sourceId: this.stringValue(item.sourceId) || null,
          verificationStatus: this.stringValue(item.verificationStatus) || "UNVERIFIED",
        }];
      });
      const first = entry.section.items.length > 0 ? this.object(entry.section.items[0]) : {};
      return [{
        code: entry.code,
        labels: first.labels ?? { en: entry.code },
        accessBasis: entry.section.accessBasis,
        trend: buildObservationTrend(points),
      }];
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OTHER_PROVIDER_OBSERVATION_TRENDS_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_WORKSPACE",
        patientId,
        providerId: workspace.viewer.providerId,
        itemCount: trends.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      context: workspace.context,
      items: trends,
      security: {
        providerCategoryCapabilityEnforced: true,
        patientContextVerified: true,
        observationConsentEnforced: true,
        automatedClinicalInference: false,
      },
    };
  }

  async questionnaireSummary(
    principal: AuthPrincipal,
    patientId: string,
    rawContextType?: string,
    contextId?: string,
  ) {
    const workspace = await this.workspace(principal, patientId, rawContextType, contextId);
    const context = await this.capabilities.workspaceContext(principal);
    const codes = [...context.questionnaireCodes].sort();
    if (codes.length === 0) {
      return {
        patientId,
        context: workspace.context,
        state: "AVAILABLE" as const,
        items: [],
        security: {
          providerCategoryCapabilityEnforced: true,
          patientContextVerified: true,
          questionnaireConsentEnforced: true,
          rawAnswersIncluded: false,
        },
      };
    }

    const consent = await this.currentConsent(
      patientId,
      context.providerId,
      "QUESTIONNAIRE_READ",
      "questionnaire-read-v1",
    );
    const decision = decideClinicalResourceAccess({
      principal,
      action: "READ",
      providerActive: true,
      capabilityAllowed: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: true,
      sensitivityAllowed: true,
      hasPatientConsent: Boolean(consent),
    });
    if (!consent || !decision.allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "OTHER_PROVIDER_QUESTIONNAIRE_SUMMARY_READ_DENIED",
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "OTHER_PROVIDER_WORKSPACE",
          patientId,
          providerId: context.providerId,
          decision: "DENY",
        },
      });
      return {
        patientId,
        context: workspace.context,
        state: "RESTRICTED" as const,
        reason: "CONSENT_REQUIRED" as const,
        items: [],
        security: {
          providerCategoryCapabilityEnforced: true,
          patientContextVerified: true,
          questionnaireConsentEnforced: true,
          rawAnswersIncluded: false,
        },
      };
    }

    const definitions = await this.prisma.questionnaireDefinition.findMany({
      where: { code: { in: codes }, active: true },
      select: { id: true, code: true, labels: true },
      orderBy: { code: "asc" },
    });
    const definitionIds = definitions.map((item) => item.id);
    const responses = definitionIds.length === 0
      ? []
      : await this.prisma.questionnaireResponse.findMany({
          where: { patientId, questionnaireId: { in: definitionIds } },
          include: { questionnaireVersion: { select: { version: true } } },
          orderBy: { completedAt: "desc" },
        });
    const latestByQuestionnaire = new Map<string, (typeof responses)[number]>();
    for (const response of responses) {
      if (!latestByQuestionnaire.has(response.questionnaireId)) {
        latestByQuestionnaire.set(response.questionnaireId, response);
      }
    }
    const items = definitions.map((definition) => {
      const latest = latestByQuestionnaire.get(definition.id);
      return {
        questionnaireId: definition.id,
        code: definition.code,
        labels: definition.labels,
        status: latest ? "COMPLETED" as const : "NOT_COMPLETED" as const,
        latestSequence: latest?.sequence ?? 0,
        questionnaireVersion: latest?.questionnaireVersion.version ?? null,
        completedAt: latest?.completedAt ?? null,
        healthChanged: latest?.healthChanged ?? null,
        changedQuestionCount: latest ? this.jsonArrayCount(latest.changedQuestionIds) : 0,
      };
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OTHER_PROVIDER_QUESTIONNAIRE_SUMMARY_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_WORKSPACE",
        patientId,
        providerId: context.providerId,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      context: workspace.context,
      state: "AVAILABLE" as const,
      accessBasis: decision.basis,
      items,
      security: {
        providerCategoryCapabilityEnforced: true,
        patientContextVerified: true,
        questionnaireConsentEnforced: true,
        rawAnswersIncluded: false,
      },
    };
  }

  private async clinicalSection(
    principal: AuthPrincipal,
    context: OtherProviderCapabilityContext,
    patientId: string,
    section: ClinicalSummarySection,
  ): Promise<Section> {
    if (!context.clinicalSummarySections.has(section)) {
      return { state: "RESTRICTED", reason: "CAPABILITY_NOT_GRANTED" };
    }

    const consent = section === "HEALTH_PROFILE"
      ? await this.currentConsent(patientId, context.providerId, "HEALTH_PROFILE_READ", "health-profile-v1")
      : await this.currentConsent(patientId, context.providerId, "CLINICAL_PROFILE_READ", "clinical-profile-v1");

    const decision = decideClinicalResourceAccess({
      principal,
      action: "READ",
      providerActive: true,
      capabilityAllowed: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: true,
      sensitivityAllowed: true,
      hasPatientConsent: Boolean(consent),
    });
    if (!consent || !decision.allowed) {
      return { state: "RESTRICTED", reason: "CONSENT_REQUIRED" };
    }

    if (section === "HEALTH_PROFILE") {
      const profile = await this.prisma.patientHealthProfile.findUnique({ where: { patientId } });
      if (!profile) return { state: "AVAILABLE", items: [], accessBasis: decision.basis };
      const payload = await this.decrypt(profile);
      return {
        state: "AVAILABLE",
        accessBasis: decision.basis,
        items: [{ version: profile.version, basics: this.object(payload).basics ?? {}, provenance: { updatedAt: profile.updatedAt } }],
      };
    }

    const kind = section === "ALLERGIES" ? "ALLERGY" : section === "CONDITIONS" ? "CONDITION" : "MEDICATION";
    const rows = await this.prisma.clinicalProfileEntry.findMany({
      where: { patientId, kind, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) {
      const stored = this.object(await this.decrypt(row));
      items.push({
        id: row.id,
        kind: row.kind,
        status: row.status,
        version: row.version,
        verificationStatus: row.verificationStatus,
        data: stored.payload ?? {},
        provenance: { sourceType: row.sourceType, verifiedAt: row.verifiedAt, updatedAt: row.updatedAt },
      });
    }
    return { state: "AVAILABLE", items, accessBasis: decision.basis };
  }

  private async observationSection(
    principal: AuthPrincipal,
    context: OtherProviderCapabilityContext,
    patientId: string,
    code: string,
  ): Promise<Section> {
    if (!context.observationCodes.has(code)) {
      return { state: "RESTRICTED", reason: "CAPABILITY_NOT_GRANTED" };
    }
    const consent = await this.currentObservationConsent(patientId, context.providerId, code);
    const decision = decideClinicalResourceAccess({
      principal,
      action: "READ",
      providerActive: true,
      capabilityAllowed: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: true,
      sensitivityAllowed: true,
      hasPatientConsent: Boolean(consent),
    });
    if (!consent || !decision.allowed) {
      return { state: "RESTRICTED", reason: "CONSENT_REQUIRED" };
    }

    const type = await this.prisma.observationType.findUnique({
      where: { code },
      select: { id: true, code: true, labels: true },
    });
    if (!type) return { state: "AVAILABLE", items: [], accessBasis: decision.basis };

    const rows = await this.prisma.observation.findMany({
      where: { patientId, observationTypeId: type.id },
      orderBy: { observedAt: "desc" },
      take: MAX_OBSERVATIONS_PER_METRIC,
    });
    const items = [];
    for (const row of rows) {
      const payload = this.object(await this.decrypt(row));
      items.push({
        id: row.id,
        code: type.code,
        labels: type.labels,
        metricVersion: payload.metricVersion ?? null,
        value: payload.originalValue ?? null,
        unitCode: payload.originalUnitCode ?? null,
        canonicalValue: payload.canonicalValue ?? null,
        canonicalUnitCode: payload.canonicalUnitCode ?? null,
        verificationStatus: payload.verificationStatus ?? null,
        observedAt: row.observedAt,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
      });
    }
    return { state: "AVAILABLE", accessBasis: decision.basis, items: items.reverse() };
  }

  private async currentConsent(patientId: string, providerId: string, scope: string, version: string) {
    const now = new Date();
    return this.prisma.consent.findFirst({
      where: {
        patientId,
        scope,
        version,
        purpose: "TREATMENT",
        state: "GRANTED",
        AND: [
          { OR: [{ providerId }, { providerId: null }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { id: true },
      orderBy: { grantedAt: "desc" },
    });
  }

  private async currentObservationConsent(patientId: string, providerId: string, code: string) {
    const now = new Date();
    return this.prisma.consent.findFirst({
      where: {
        patientId,
        scope: { in: [`OBSERVATION_READ:${code}`, "OBSERVATION_READ"] },
        version: "observation-read-v1",
        purpose: "TREATMENT",
        state: "GRANTED",
        AND: [
          { OR: [{ providerId }, { providerId: null }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { id: true },
      orderBy: { grantedAt: "desc" },
    });
  }

  private async requirePatientContext(
    provider: OtherProviderCapabilityContext,
    patientId: string,
    contextType: PatientContextType,
    contextId?: string,
  ) {
    const now = new Date();
    if (contextType === "APPOINTMENT") {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          id: this.requiredContextId(contextId),
          providerId: provider.providerId,
          patientId,
          status: { in: ["CONFIRMED", "COMPLETED"] },
        },
        select: { id: true, startsAt: true, status: true },
      });
      if (!appointment) throw new ForbiddenException("Authorized appointment context is required.");
      return { type: contextType, id: appointment.id, status: appointment.status };
    }

    if (contextType === "MEDICAL_TRANSPORT") {
      const request = await this.prisma.medicalTransportRequest.findFirst({
        where: {
          id: this.requiredContextId(contextId),
          assignedProviderId: provider.providerId,
          patientId,
          status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING", "COMPLETED"] },
        },
        select: { id: true, status: true },
      });
      if (!request) throw new ForbiddenException("Authorized medical transport context is required.");
      return { type: contextType, id: request.id, status: request.status };
    }

    if (contextType === "EMERGENCY_AMBULANCE") {
      const request = await this.prisma.emergencyAmbulanceRequest.findFirst({
        where: {
          id: this.requiredContextId(contextId),
          assignedProviderId: provider.providerId,
          patientId,
          status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING", "COMPLETED"] },
        },
        select: { id: true, status: true },
      });
      if (!request) throw new ForbiddenException("Authorized emergency ambulance context is required.");
      return { type: contextType, id: request.id, status: request.status };
    }

    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        providerId: provider.providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true, status: true },
      orderBy: { startsAt: "desc" },
    });
    if (!appointment) throw new ForbiddenException("A current patient treatment context is required.");
    return { type: "PATIENT" as const, id: appointment.id, status: appointment.status };
  }

  private contextType(value?: string): PatientContextType {
    if (!value?.trim()) return "PATIENT";
    const normalized = value.trim().toUpperCase();
    if (!["PATIENT", "APPOINTMENT", "MEDICAL_TRANSPORT", "EMERGENCY_AMBULANCE"].includes(normalized)) {
      throw new ForbiddenException("Unsupported patient context.");
    }
    return normalized as PatientContextType;
  }

  private requiredContextId(value?: string): string {
    const normalized = value?.trim();
    if (!normalized || !/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) {
      throw new ForbiddenException("A valid contextId is required.");
    }
    return normalized;
  }

  private decrypt(row: { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string }) {
    return this.envelope.decryptRecord<unknown>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private jsonArrayCount(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
  }

  private finiteNumber(value: unknown): number | null {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? number : null;
  }

  private stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
