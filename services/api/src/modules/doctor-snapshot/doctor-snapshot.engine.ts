export type SnapshotSection<T> =
  | { state: "AVAILABLE"; value: T }
  | { state: "RESTRICTED" };

type ClinicalProfileItem = {
  id?: string;
  kind?: string;
  status?: string;
  data?: Record<string, unknown>;
  verificationStatus?: string;
  provenance?: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function items(value: unknown): ClinicalProfileItem[] {
  const root = object(value);
  return Array.isArray(root.items)
    ? root.items.filter((item): item is ClinicalProfileItem => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function active(item: ClinicalProfileItem): boolean {
  if (item.status !== "ACTIVE") return false;
  const data = object(item.data);
  const clinicalStatus = typeof data.clinicalStatus === "string" ? data.clinicalStatus : null;
  const medicationStatus = typeof data.medicationStatus === "string" ? data.medicationStatus : null;
  if (clinicalStatus && ["RESOLVED", "INACTIVE"].includes(clinicalStatus)) return false;
  if (medicationStatus && ["STOPPED", "COMPLETED"].includes(medicationStatus)) return false;
  return true;
}

export function summarizeClinicalProfile(value: unknown) {
  const all = items(value);
  const allergies = all.filter((item) => item.kind === "ALLERGY" && active(item));
  const conditions = all.filter((item) => item.kind === "CONDITION" && active(item));
  const medications = all.filter((item) => item.kind === "MEDICATION" && active(item));
  const procedures = all.filter((item) => item.kind === "PROCEDURE");

  const criticalAllergies = allergies.filter((item) => {
    const severity = object(item.data).severity;
    return severity === "SEVERE";
  });

  return {
    allergies,
    criticalAllergies,
    activeConditions: conditions,
    activeMedications: medications,
    procedures,
    verification: {
      providerVerified: all.filter((item) => item.verificationStatus === "PROVIDER_VERIFIED").length,
      patientDeclared: all.filter((item) => item.verificationStatus === "PATIENT_DECLARED").length,
      providerRejected: all.filter((item) => item.verificationStatus === "PROVIDER_REJECTED").length,
    },
  };
}

export function sinceLastConsultSummary(input: {
  previousConsultAt: Date | null;
  healthProfile?: SnapshotSection<unknown>;
  clinicalProfile?: SnapshotSection<unknown>;
  questionnaires?: SnapshotSection<unknown>;
  observations?: Array<{ code: string; section: SnapshotSection<unknown> }>;
}) {
  if (!input.previousConsultAt) {
    return {
      available: false,
      reason: "NO_PREVIOUS_COMPLETED_CONSULT" as const,
      since: null,
      accessibleChanges: null,
    };
  }
  const since = input.previousConsultAt.getTime();
  let healthProfileChanged = false;
  let clinicalProfileChanged = 0;
  let questionnaireChanged = 0;
  let observationCount = 0;
  const restrictedSections: string[] = [];

  if (input.healthProfile?.state === "AVAILABLE") {
    const updatedAt = object(input.healthProfile.value).updatedAt;
    healthProfileChanged = timestampAfter(updatedAt, since);
  } else if (input.healthProfile) {
    restrictedSections.push("HEALTH_PROFILE");
  }

  if (input.clinicalProfile?.state === "AVAILABLE") {
    for (const item of items(input.clinicalProfile.value)) {
      const provenance = object(item.provenance);
      if (timestampAfter(provenance.updatedAt, since) || timestampAfter(provenance.recordedAt, since)) {
        clinicalProfileChanged += 1;
      }
    }
  } else if (input.clinicalProfile) {
    restrictedSections.push("CLINICAL_PROFILE");
  }

  if (input.questionnaires?.state === "AVAILABLE") {
    const root = object(input.questionnaires.value);
    const rows = Array.isArray(root.items) ? root.items : [];
    for (const raw of rows) {
      const row = object(raw);
      const latest = object(row.latest);
      if (timestampAfter(latest.completedAt, since)) questionnaireChanged += 1;
    }
  } else if (input.questionnaires) {
    restrictedSections.push("QUESTIONNAIRES");
  }

  for (const metric of input.observations ?? []) {
    if (metric.section.state !== "AVAILABLE") {
      restrictedSections.push(`OBSERVATION:${metric.code}`);
      continue;
    }
    const root = object(metric.section.value);
    const rows = Array.isArray(root.items) ? root.items : [];
    for (const raw of rows) {
      if (timestampAfter(object(raw).observedAt, since)) observationCount += 1;
    }
  }

  return {
    available: true,
    since: input.previousConsultAt.toISOString(),
    accessibleChanges: {
      healthProfileChanged,
      clinicalProfileChanged,
      questionnaireChanged,
      observationCount,
    },
    restrictedSections: [...new Set(restrictedSections)].sort(),
  };
}

function timestampAfter(value: unknown, since: number): boolean {
  if (value instanceof Date) return value.getTime() > since;
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > since;
}
