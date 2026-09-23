export type SummaryState = "READY" | "ACTION_REQUIRED" | "EMPTY";

export type SummaryObservation = {
  id: string;
  code: string;
  labels: unknown;
  category: string;
  value: number;
  unitCode: string;
  observedAt: Date;
  sourceType: string;
  sourceId: string | null;
  verificationStatus: string;
};

export type SummaryQuestionnaire = {
  questionnaireId: string;
  code: string;
  labels: unknown;
  questionnaireVersion: number;
  latestSequence: number;
  lastCompletedAt: Date | null;
  due: boolean;
  dueReason: string;
  dueAt?: Date;
};

export type SummaryCarePlan = {
  id: string;
  status: string;
  version: number;
  reviewAt: Date | null;
  effectiveUntil: Date | null;
  nextTask: null | {
    id: string;
    status: string;
    dueAt: Date | null;
  };
};

export type SummaryAlert = {
  id: string;
  carePlanId: string;
  metricCode: string;
  severity: string;
  status: string;
  patientActionKey: string;
  sourceObservationId: string;
  createdAt: Date;
  viewed: boolean;
};

export function latestObservationPerCode(items: SummaryObservation[], limit = 8): SummaryObservation[] {
  const sorted = [...items].sort((left, right) => {
    const time = right.observedAt.getTime() - left.observedAt.getTime();
    return time !== 0 ? time : left.code.localeCompare(right.code);
  });
  const selected = new Map<string, SummaryObservation>();
  for (const item of sorted) {
    if (!selected.has(item.code)) selected.set(item.code, item);
    if (selected.size >= limit) break;
  }
  return [...selected.values()];
}

export function observationSection(items: SummaryObservation[]) {
  return {
    state: items.length > 0 ? "READY" as const : "EMPTY" as const,
    detailTarget: "/patient/observations/history",
    items,
  };
}

export function glucoseSection(items: SummaryObservation[]) {
  const item = items.find((candidate) => candidate.code === "BLOOD_GLUCOSE") ?? null;
  return {
    state: item ? "READY" as const : "EMPTY" as const,
    detailTarget: "/patient/observations/history?code=BLOOD_GLUCOSE",
    item,
  };
}

export function questionnaireSection(item: SummaryQuestionnaire | null) {
  return {
    state: item?.due ? "ACTION_REQUIRED" as const : item ? "READY" as const : "EMPTY" as const,
    detailTarget: "/patient/questionnaires/due",
    item,
  };
}

export function carePlanSection(item: SummaryCarePlan | null) {
  return {
    state: item ? "READY" as const : "EMPTY" as const,
    detailTarget: item ? `/patient/care-plans/${item.id}` : "/patient/care-plans",
    item,
  };
}

export function alertSection(items: SummaryAlert[]) {
  const ordered = [...items].sort((left, right) => {
    const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
    const severity = (severityOrder[left.severity] ?? 99) - (severityOrder[right.severity] ?? 99);
    if (severity !== 0) return severity;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
  return {
    state: ordered.length > 0 ? "ACTION_REQUIRED" as const : "EMPTY" as const,
    detailTarget: "/patient/clinical-alerts",
    items: ordered,
  };
}

export function medicationSection<T>(items: T[], openRefillCount: number) {
  return {
    state: items.length > 0 || openRefillCount > 0 ? "READY" as const : "EMPTY" as const,
    detailTarget: "/patient/clinical-profile/entries?kind=MEDICATION",
    items,
    openRefillCount,
    refillDetailTarget: "/patient/refill-requests",
  };
}

export function deviceSection<T>(items: T[]) {
  return {
    state: items.length > 0 ? "READY" as const : "EMPTY" as const,
    detailTarget: "/patient/clinical-profile/entries?kind=IMPLANT_DEVICE",
    items,
  };
}
