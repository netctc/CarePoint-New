import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { PatientContextService } from "../dependents/dependents.service";
import { evaluateQuestionnaireActivation, normalizeActivationRules } from "../questionnaire/questionnaire.engine";
import {
  alertSection,
  carePlanSection,
  glucoseSection,
  latestObservationPerCode,
  medicationSection,
  observationSection,
  questionnaireSection,
  type SummaryAlert,
  type SummaryCarePlan,
  type SummaryObservation,
  type SummaryQuestionnaire,
} from "./patient-health-summary.engine";

type EnvelopeRow = {
  algorithm: string;
  keyId: string;
  wrappedKey: string;
  iv: string;
  ciphertext: string;
};

type StoredObservation = {
  schemaVersion: 1;
  metricCode: string;
  metricVersion: number;
  originalValue: number;
  originalUnitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  verificationStatus: string;
};

type StoredClinicalProfileEntry = {
  schemaVersion: 1;
  payload: Record<string, unknown>;
};

type StoredCarePlan = {
  schemaVersion: 1;
  title: string;
  summary?: string;
  problemRef?: string;
};

type StoredCareTask = {
  schemaVersion: 1;
  kind: string;
  label: string;
  instructions?: string;
};

@Injectable()
export class PatientHealthSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly contexts: PatientContextService,
  ) {}

  async get(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") {
      throw new ForbiddenException("Patient health summary requires PATIENT role.");
    }
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: context.patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");

    const now = new Date();
    const [observationRows, medicationRows, openRefillCount, questionnaireVersions, questionnaireResponses, planRows, alertRows] = await Promise.all([
      this.prisma.observation.findMany({
        where: { patientId: patient.id },
        include: { observationType: { select: { code: true, labels: true, category: true } } },
        orderBy: { observedAt: "desc" },
        take: 64,
      }),
      this.prisma.clinicalProfileEntry.findMany({
        where: { patientId: patient.id, kind: "MEDICATION", status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      this.prisma.refillRequest.count({ where: { patientId: patient.id, status: "REQUESTED" } }),
      this.prisma.questionnaireVersion.findMany({
        where: { status: "ACTIVE", questionnaire: { active: true } },
        include: { questionnaire: { select: { id: true, code: true, labels: true } } },
        orderBy: [{ questionnaire: { code: "asc" } }, { version: "desc" }],
        take: 100,
      }),
      this.prisma.questionnaireResponse.findMany({
        where: { patientId: patient.id },
        orderBy: { completedAt: "desc" },
        select: { questionnaireId: true, sequence: true, completedAt: true },
        take: 500,
      }),
      this.prisma.carePlan.findMany({
        where: {
          patientId: patient.id,
          status: { in: ["ACTIVE", "PAUSED"] },
          effectiveFrom: { lte: now },
          AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] }],
        },
        include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        orderBy: [{ reviewAt: "asc" }, { createdAt: "desc" }],
        take: 20,
      }),
      this.prisma.clinicalAlert.findMany({
        where: { patientId: patient.id, status: { not: "RESOLVED" } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    const observations: SummaryObservation[] = [];
    for (const row of observationRows) {
      const payload = await this.decrypt<StoredObservation>(row);
      observations.push({
        id: row.id,
        code: payload.metricCode,
        labels: row.observationType.labels,
        category: row.observationType.category,
        value: payload.originalValue,
        unitCode: payload.originalUnitCode,
        observedAt: row.observedAt,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        verificationStatus: payload.verificationStatus,
      });
    }
    const latestObservations = latestObservationPerCode(observations, 8);

    const medications = [];
    for (const row of medicationRows) {
      const stored = await this.decrypt<StoredClinicalProfileEntry>(row);
      const payload = stored.payload ?? {};
      medications.push({
        id: row.id,
        name: typeof payload.name === "string" ? payload.name : null,
        dose: typeof payload.dose === "string" ? payload.dose : null,
        frequency: typeof payload.frequency === "string" ? payload.frequency : null,
        medicationStatus: typeof payload.medicationStatus === "string" ? payload.medicationStatus : null,
        status: row.status,
        sourceType: row.sourceType,
        verificationStatus: row.verificationStatus,
        recordedAt: row.updatedAt,
      });
    }

    const questionnaire = this.selectQuestionnaire(questionnaireVersions, questionnaireResponses, now);
    const carePlan = await this.selectCarePlan(planRows);
    const alerts = await this.presentAlerts(principal, alertRows);

    const sections = {
      observations: observationSection(latestObservations),
      glucose: glucoseSection(latestObservations),
      medications: medicationSection(medications, openRefillCount),
      questionnaire: questionnaireSection(questionnaire),
      carePlan: carePlanSection(carePlan),
      alerts: alertSection(alerts),
    };

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_HEALTH_SUMMARY_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "PATIENT_HEALTH_SUMMARY",
        patientId: patient.id,
        contextMode: context.mode,
        observationCount: latestObservations.length,
        medicationCount: medications.length,
        questionnairePresent: Boolean(questionnaire),
        carePlanPresent: Boolean(carePlan),
        alertCount: alerts.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId: patient.id,
      contextMode: context.mode,
      generatedAt: now,
      automatedDiagnosis: false,
      sections,
    };
  }

  private selectQuestionnaire(versions: any[], responses: Array<{ questionnaireId: string; sequence: number; completedAt: Date }>, now: Date): SummaryQuestionnaire | null {
    if (versions.length === 0) return null;
    const latest = new Map<string, { sequence: number; completedAt: Date }>();
    for (const response of responses) {
      if (!latest.has(response.questionnaireId)) latest.set(response.questionnaireId, response);
    }
    const projected: SummaryQuestionnaire[] = versions.map((version) => {
      const previous = latest.get(version.questionnaireId) ?? null;
      const activation = evaluateQuestionnaireActivation(
        normalizeActivationRules(version.activationRules),
        previous?.completedAt ?? null,
        now,
      );
      return {
        questionnaireId: version.questionnaireId,
        code: version.questionnaire.code,
        labels: version.questionnaire.labels,
        questionnaireVersion: version.version,
        latestSequence: previous?.sequence ?? 0,
        lastCompletedAt: previous?.completedAt ?? null,
        due: activation.due,
        dueReason: activation.reason,
        ...(activation.dueAt ? { dueAt: activation.dueAt } : {}),
      };
    });
    return projected.find((item) => item.due) ?? projected[0] ?? null;
  }

  private async selectCarePlan(rows: any[]): Promise<(SummaryCarePlan & { title: string | null; nextTask: (SummaryCarePlan["nextTask"] & { kind?: string; label?: string }) | null }) | null> {
    const plan = rows[0];
    if (!plan) return null;
    const revision = plan.revisions?.[0] ?? null;
    const payload = revision ? await this.decrypt<StoredCarePlan>(revision) : null;
    const task = await this.prisma.careTask.findFirst({
      where: {
        carePlanId: plan.id,
        assigneeType: "PATIENT",
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    });
    let nextTask: any = null;
    if (task) {
      const taskPayload = await this.decrypt<StoredCareTask>(task);
      nextTask = {
        id: task.id,
        status: task.status,
        dueAt: task.dueAt,
        kind: taskPayload.kind,
        label: taskPayload.label,
      };
    }
    return {
      id: plan.id,
      status: plan.status,
      version: plan.version,
      reviewAt: plan.reviewAt,
      effectiveUntil: plan.effectiveUntil,
      title: payload?.title ?? null,
      nextTask,
    };
  }

  private async presentAlerts(principal: AuthPrincipal, rows: any[]): Promise<SummaryAlert[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const viewedRows = await this.prisma.clinicalAlertAction.findMany({
      where: { alertId: { in: ids }, actorId: principal.accountId, action: "VIEWED" },
      select: { alertId: true },
    });
    const viewed = new Set(viewedRows.map((row) => row.alertId));
    return rows.map((row) => ({
      id: row.id,
      carePlanId: row.carePlanId,
      metricCode: row.metricCode,
      severity: row.severity,
      status: row.status,
      patientActionKey: row.patientActionKey,
      sourceObservationId: row.sourceObservationId,
      createdAt: row.createdAt,
      viewed: viewed.has(row.id),
    }));
  }

  private decrypt<T>(row: EnvelopeRow): Promise<T> {
    return this.envelope.decryptRecord<T>(this.asEnvelope(row));
  }

  private asEnvelope(row: EnvelopeRow): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") {
      throw new ConflictException("Unsupported encrypted clinical payload algorithm.");
    }
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    };
  }
}
