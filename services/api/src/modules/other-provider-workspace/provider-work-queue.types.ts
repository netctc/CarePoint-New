export type ProviderWorkItemKind = "HOME_VISIT" | "MEDICAL_TRANSPORT";

export type ProviderWorkQueueCriterionKey =
  | "SCHEDULE_TIME"
  | "DISTANCE_ETA"
  | "OPERATIONAL_URGENCY"
  | "SLA"
  | "CAPABILITY_FIT";

export interface ProviderWorkQueueCriterion {
  key: ProviderWorkQueueCriterionKey;
  contribution: number;
  maximum: number;
  source: string;
  value: string | number | boolean | null;
  explanationKey: string;
}

export interface ProviderWorkItem {
  id: string;
  jobId: string;
  kind: ProviderWorkItemKind;
  status: string;
  patientId: string;
  patientDisplayName: string;
  scheduledAt: string;
  etaMinutes: number | null;
  priority: {
    score: number;
    rank: number;
    version: "operational-v1";
    criteria: ProviderWorkQueueCriterion[];
  };
  navigation: {
    workspace: "HOME_VISIT" | "TRANSPORT";
    contextId: string;
  };
  autonomousClinicalDecision: false;
}
