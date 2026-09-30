export type ChangeDomain =
  | "HEALTH_PROFILE"
  | "CLINICAL_PROFILE"
  | "QUESTIONNAIRE"
  | "OBSERVATION"
  | "LAB_RESULT"
  | "CLINICAL_ALERT";

export type SourceLinkedChange = {
  domain: ChangeDomain;
  resourceType: string;
  resourceId: string;
  resourceVersion: number | null;
  occurredAt: Date;
  changeType: string;
  sourceType: string | null;
  sourceActorId: string | null;
  sourceId: string | null;
  changedFields: string[];
  detailTarget: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type ChangesProjectionInput = {
  patientId: string;
  since: Date | null;
  healthProfile: Array<{
    id: string;
    profileId: string;
    version: number;
    sourceType: string;
    sourceActorId: string | null;
    changedFields: unknown;
    createdAt: Date;
  }>;
  clinicalProfile: Array<{
    id: string;
    entryId: string;
    version: number;
    changedFields: unknown;
    verificationStatus: string;
    sourceType: string;
    sourceActorId: string | null;
    createdAt: Date;
    entry: { kind: string; status: string };
  }>;
  questionnaires: Array<{
    id: string;
    sequence: number;
    healthChanged: boolean | null;
    changedQuestionIds: unknown;
    sourceType: string;
    sourceActorId: string | null;
    completedAt: Date;
    questionnaire: { code: string };
    questionnaireVersion: { version: number };
  }>;
  observations: Array<{
    id: string;
    observedAt: Date;
    sourceType: string;
    sourceId: string | null;
    createdByActorId: string | null;
    observationType: { code: string };
  }>;
  labResults?: Array<{
    orderId: string;
    laboratoryResultId: string;
    status: "VALIDATED" | "RELEASED";
    occurredAt: Date;
    orderingProviderId: string | null;
  }>;
  alerts?: Array<{
    id: string;
    status: string;
    severity: string;
    metricCode: string;
    carePlanId: string;
    sourceObservationId: string;
    occurredAt: Date;
  }>;
  restrictedSections: string[];
};

export function buildChangesSinceLastVisit(input: ChangesProjectionInput) {
  if (!input.since) {
    return {
      available: false,
      reason: "NO_PREVIOUS_COMPLETED_CONSULT" as const,
      patientId: input.patientId,
      since: null,
      changes: [] as SourceLinkedChange[],
      restrictedSections: [...new Set(input.restrictedSections)].sort(),
      summary: emptySummary(),
      automatedClinicalInference: false,
    };
  }

  const changes: SourceLinkedChange[] = [];

  for (const row of input.healthProfile) {
    changes.push({
      domain: "HEALTH_PROFILE",
      resourceType: "PATIENT_HEALTH_PROFILE_REVISION",
      resourceId: row.id,
      resourceVersion: row.version,
      occurredAt: row.createdAt,
      changeType: "UPDATED",
      sourceType: row.sourceType,
      sourceActorId: row.sourceActorId,
      sourceId: row.profileId,
      changedFields: stringArray(row.changedFields),
      detailTarget: `/provider/patients/${input.patientId}/health-profile`,
      metadata: { profileId: row.profileId },
    });
  }

  for (const row of input.clinicalProfile) {
    changes.push({
      domain: "CLINICAL_PROFILE",
      resourceType: "CLINICAL_PROFILE_ENTRY_REVISION",
      resourceId: row.id,
      resourceVersion: row.version,
      occurredAt: row.createdAt,
      changeType: "UPDATED",
      sourceType: row.sourceType,
      sourceActorId: row.sourceActorId,
      sourceId: row.entryId,
      changedFields: stringArray(row.changedFields),
      detailTarget: `/doctor/patients/${input.patientId}/clinical-profile/entries?entryId=${encodeURIComponent(row.entryId)}`,
      metadata: {
        entryId: row.entryId,
        kind: row.entry.kind,
        status: row.entry.status,
        verificationStatus: row.verificationStatus,
      },
    });
  }

  for (const row of input.questionnaires) {
    changes.push({
      domain: "QUESTIONNAIRE",
      resourceType: "QUESTIONNAIRE_RESPONSE",
      resourceId: row.id,
      resourceVersion: row.sequence,
      occurredAt: row.completedAt,
      changeType: "SUBMITTED",
      sourceType: row.sourceType,
      sourceActorId: row.sourceActorId,
      sourceId: row.id,
      changedFields: stringArray(row.changedQuestionIds),
      detailTarget: `/doctor/patients/${input.patientId}/questionnaires/${encodeURIComponent(row.questionnaire.code)}?responseId=${encodeURIComponent(row.id)}`,
      metadata: {
        code: row.questionnaire.code,
        questionnaireVersion: row.questionnaireVersion.version,
        healthChanged: row.healthChanged,
      },
    });
  }

  for (const row of input.observations) {
    changes.push({
      domain: "OBSERVATION",
      resourceType: "OBSERVATION",
      resourceId: row.id,
      resourceVersion: null,
      occurredAt: row.observedAt,
      changeType: "RECORDED",
      sourceType: row.sourceType,
      sourceActorId: row.createdByActorId,
      sourceId: row.sourceId ?? row.id,
      changedFields: [],
      detailTarget: `/doctor/patients/${input.patientId}/observations?code=${encodeURIComponent(row.observationType.code)}&observationId=${encodeURIComponent(row.id)}`,
      metadata: { metricCode: row.observationType.code },
    });
  }

  for (const row of input.labResults ?? []) {
    changes.push({
      domain: "LAB_RESULT",
      resourceType: "LABORATORY_RESULT",
      resourceId: row.laboratoryResultId,
      resourceVersion: null,
      occurredAt: row.occurredAt,
      changeType: row.status,
      sourceType: "CLINICAL_ORDER",
      sourceActorId: row.orderingProviderId,
      sourceId: row.orderId,
      changedFields: [],
      detailTarget: `/clinical-orders/${encodeURIComponent(row.orderId)}`,
      metadata: {
        orderId: row.orderId,
        status: row.status,
      },
    });
  }

  for (const row of input.alerts ?? []) {
    changes.push({
      domain: "CLINICAL_ALERT",
      resourceType: "CLINICAL_ALERT",
      resourceId: row.id,
      resourceVersion: null,
      occurredAt: row.occurredAt,
      changeType: row.status,
      sourceType: "RPM_RULE",
      sourceActorId: null,
      sourceId: row.sourceObservationId,
      changedFields: [],
      detailTarget: `/provider/monitoring-queue?alertId=${encodeURIComponent(row.id)}`,
      metadata: {
        carePlanId: row.carePlanId,
        metricCode: row.metricCode,
        severity: row.severity,
        status: row.status,
      },
    });
  }

  changes.sort((left, right) => {
    const time = right.occurredAt.getTime() - left.occurredAt.getTime();
    if (time !== 0) return time;
    return `${left.domain}:${left.resourceId}`.localeCompare(`${right.domain}:${right.resourceId}`);
  });

  const summary = emptySummary();
  for (const change of changes) summary[change.domain] += 1;

  return {
    available: true,
    reason: null,
    patientId: input.patientId,
    since: input.since,
    changes,
    restrictedSections: [...new Set(input.restrictedSections)].sort(),
    summary,
    automatedClinicalInference: false,
  };
}

function emptySummary(): Record<ChangeDomain, number> {
  return {
    HEALTH_PROFILE: 0,
    CLINICAL_PROFILE: 0,
    QUESTIONNAIRE: 0,
    OBSERVATION: 0,
    LAB_RESULT: 0,
    CLINICAL_ALERT: 0,
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").sort();
}
