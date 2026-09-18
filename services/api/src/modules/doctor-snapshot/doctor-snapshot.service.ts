import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { HealthProfileService } from "../health-profile/health-profile.service";
import { ClinicalProfileService } from "../clinical-profile/clinical-profile.service";
import { QuestionnaireService } from "../questionnaire/questionnaire.service";
import { ObservationService } from "../observation/observation.service";
import {
  sinceLastConsultSummary,
  summarizeClinicalProfile,
  type SnapshotSection,
} from "./doctor-snapshot.engine";

const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const SNAPSHOT_OBSERVATION_LIMIT = 30;

@Injectable()
export class DoctorSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly healthProfile: HealthProfileService,
    private readonly clinicalProfile: ClinicalProfileService,
    private readonly questionnaires: QuestionnaireService,
    private readonly observations: ObservationService,
  ) {}

  async patientSnapshot(principal: AuthPrincipal, patientId: string) {
    const provider = await this.requireDoctorTreatmentRelationship(principal, patientId);
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");

    const [activeQuestionnaires, activeMetrics, previousConsult] = await Promise.all([
      this.prisma.questionnaireDefinition.findMany({
        where: { active: true, versions: { some: { status: "ACTIVE" } } },
        select: { code: true, labels: true },
        orderBy: { code: "asc" },
      }),
      this.prisma.observationType.findMany({
        where: { active: true, versions: { some: { status: "ACTIVE" } } },
        select: { code: true, labels: true, category: true },
        orderBy: { code: "asc" },
      }),
      this.prisma.appointment.findFirst({
        where: {
          providerId: provider.id,
          patientId,
          status: "COMPLETED",
          startsAt: { lt: new Date() },
        },
        select: { id: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: "desc" },
      }),
    ]);

    const [healthProfile, clinicalProfile, questionnaireSection] = await Promise.all([
      this.section(() => this.healthProfile.providerView(principal, patientId)),
      this.section(() => this.clinicalProfile.listForDoctor(principal, patientId)),
      this.questionnaireSection(principal, patientId, activeQuestionnaires),
    ]);

    const observationSections = await Promise.all(activeMetrics.map(async (metric) => ({
      code: metric.code,
      labels: metric.labels,
      category: metric.category,
      section: await this.section(() =>
        this.observations.historyForDoctor(
          principal,
          patientId,
          metric.code,
          undefined,
          undefined,
          SNAPSHOT_OBSERVATION_LIMIT,
        ),
      ),
    })));

    const clinicalSummary = clinicalProfile.state === "AVAILABLE"
      ? { state: "AVAILABLE" as const, value: summarizeClinicalProfile(clinicalProfile.value) }
      : { state: "RESTRICTED" as const };

    const sinceLastConsult = sinceLastConsultSummary({
      previousConsultAt: previousConsult?.startsAt ?? null,
      healthProfile,
      clinicalProfile,
      questionnaires: questionnaireSection,
      observations: observationSections.map((item) => ({ code: item.code, section: item.section })),
    });

    const restrictedCount = [
      healthProfile.state,
      clinicalProfile.state,
      questionnaireSection.state,
      ...observationSections.map((item) => item.section.state),
    ].filter((state) => state === "RESTRICTED").length;

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "DOCTOR_PATIENT_SNAPSHOT_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "PATIENT_SNAPSHOT",
        patientId: patient.id,
        providerId: provider.id,
        itemCount: observationSections.length,
        decision: "ALLOW",
      },
    });

    return {
      patient,
      viewer: { providerId: provider.id, role: "DOCTOR" as const },
      previousConsult: previousConsult
        ? {
            appointmentId: previousConsult.id,
            startsAt: previousConsult.startsAt,
            endsAt: previousConsult.endsAt,
          }
        : null,
      healthProfile,
      clinicalProfile,
      clinicalSummary,
      questionnaires: questionnaireSection,
      observations: observationSections,
      sinceLastConsult,
      security: {
        treatmentRelationshipVerified: true,
        granularConsentPreserved: true,
        restrictedSectionCount: restrictedCount,
        automatedClinicalInference: false,
      },
    };
  }

  private async questionnaireSection(
    principal: AuthPrincipal,
    patientId: string,
    active: Array<{ code: string; labels: unknown }>,
  ): Promise<SnapshotSection<unknown>> {
    if (active.length === 0) return { state: "AVAILABLE", value: { items: [] } };
    try {
      const items = [];
      for (const questionnaire of active) {
        const [latest, diff] = await Promise.all([
          this.questionnaires.latestForDoctor(principal, patientId, questionnaire.code),
          this.questionnaires.diffForDoctor(principal, patientId, questionnaire.code),
        ]);
        items.push({
          code: questionnaire.code,
          labels: questionnaire.labels,
          latest: this.object(latest).latest ?? null,
          diff,
        });
      }
      return { state: "AVAILABLE", value: { items } };
    } catch (error) {
      if (error instanceof ForbiddenException) return { state: "RESTRICTED" };
      throw error;
    }
  }

  private async section<T>(loader: () => Promise<T>): Promise<SnapshotSection<T>> {
    try {
      return { state: "AVAILABLE", value: await loader() };
    } catch (error) {
      if (error instanceof ForbiddenException) return { state: "RESTRICTED" };
      throw error;
    }
  }

  private async requireDoctorTreatmentRelationship(principal: AuthPrincipal, patientId: string) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Doctor patient snapshot requires DOCTOR role.");
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
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        providerId: provider.id,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!relationship) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "DOCTOR_PATIENT_SNAPSHOT_READ_DENIED",
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "PATIENT_SNAPSHOT",
          patientId,
          providerId: provider.id,
          decision: "DENY",
        },
      });
      throw new ForbiddenException("A current treatment relationship is required.");
    }
    return provider;
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
