import { BadRequestException } from "@nestjs/common";

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AlertComparator = "LT" | "LTE" | "GT" | "GTE" | "BETWEEN" | "OUTSIDE";
export type AlertWorkflowAction = "ACKNOWLEDGE" | "ASSIGN" | "ESCALATE" | "RESOLVE" | "VIEWED";

export type AlertRuleConfig = {
  comparator: AlertComparator;
  thresholdValue: number;
  thresholdUpperValue?: number;
};

export type AlertPolicyConfig = {
  schemaVersion: 1;
  metricCodes: string[];
  severities: AlertSeverity[];
  patientActionKeys: string[];
  thresholdBounds: Array<{ metricCode: string; min: number; max: number }>;
};

const TOKEN = /^[A-Z][A-Z0-9_:-]{1,79}$/;
const REASON = /^[A-Z][A-Z0-9_:-]{1,63}$/;

export function normalizeAlertPolicyConfig(value: unknown): AlertPolicyConfig {
  const raw = object(value, "config");
  const metricCodes = tokenArray(raw.metricCodes, "metricCodes", 1, 100);
  const severities = enumArray(raw.severities, "severities", ["INFO", "WARNING", "CRITICAL"] as const);
  const patientActionKeys = tokenArray(raw.patientActionKeys, "patientActionKeys", 1, 100);
  if (!Array.isArray(raw.thresholdBounds)) throw new BadRequestException("thresholdBounds must be an array.");
  const thresholdBounds = raw.thresholdBounds.map((entry) => {
    const item = object(entry, "thresholdBounds[]");
    const metricCode = token(item.metricCode, "thresholdBounds.metricCode");
    const min = finite(item.min, "thresholdBounds.min");
    const max = finite(item.max, "thresholdBounds.max");
    if (max <= min) throw new BadRequestException("thresholdBounds.max must be greater than min.");
    if (!metricCodes.includes(metricCode)) throw new BadRequestException("threshold bound metric must be listed in metricCodes.");
    return { metricCode, min, max };
  });
  if (new Set(thresholdBounds.map((item) => item.metricCode)).size !== thresholdBounds.length) {
    throw new BadRequestException("thresholdBounds cannot contain duplicate metrics.");
  }
  return { schemaVersion: 1, metricCodes, severities, patientActionKeys, thresholdBounds };
}

export function normalizeAlertRuleConfig(value: unknown): AlertRuleConfig {
  const raw = object(value, "rule");
  const comparator = enumValue(raw.comparator, "comparator", ["LT", "LTE", "GT", "GTE", "BETWEEN", "OUTSIDE"] as const);
  const thresholdValue = finite(raw.thresholdValue, "thresholdValue");
  let thresholdUpperValue: number | undefined;
  if (comparator === "BETWEEN" || comparator === "OUTSIDE") {
    thresholdUpperValue = finite(raw.thresholdUpperValue, "thresholdUpperValue");
    if (thresholdUpperValue <= thresholdValue) throw new BadRequestException("thresholdUpperValue must be greater than thresholdValue.");
  }
  return { comparator, thresholdValue, ...(thresholdUpperValue === undefined ? {} : { thresholdUpperValue }) };
}

export function assertRuleAllowedByPolicy(
  policy: AlertPolicyConfig,
  input: { metricCode: string; severity: AlertSeverity; patientActionKey: string; config: AlertRuleConfig },
): void {
  if (!policy.metricCodes.includes(input.metricCode)) throw new BadRequestException("metricCode is not allowed by the active alert policy.");
  if (!policy.severities.includes(input.severity)) throw new BadRequestException("severity is not allowed by the active alert policy.");
  if (!policy.patientActionKeys.includes(input.patientActionKey)) throw new BadRequestException("patientActionKey is not allowed by the active alert policy.");
  const bound = policy.thresholdBounds.find((item) => item.metricCode === input.metricCode);
  if (!bound) throw new BadRequestException("Alert policy has no threshold bounds for metricCode.");
  for (const threshold of [input.config.thresholdValue, input.config.thresholdUpperValue]) {
    if (threshold !== undefined && (threshold < bound.min || threshold > bound.max)) {
      throw new BadRequestException("Alert threshold is outside the configured policy bounds.");
    }
  }
}

export function evaluateAlertRule(canonicalValue: number, config: AlertRuleConfig): boolean {
  if (!Number.isFinite(canonicalValue)) throw new BadRequestException("canonicalValue must be finite.");
  switch (config.comparator) {
    case "LT": return canonicalValue < config.thresholdValue;
    case "LTE": return canonicalValue <= config.thresholdValue;
    case "GT": return canonicalValue > config.thresholdValue;
    case "GTE": return canonicalValue >= config.thresholdValue;
    case "BETWEEN": return canonicalValue >= config.thresholdValue && canonicalValue <= config.thresholdUpperValue!;
    case "OUTSIDE": return canonicalValue < config.thresholdValue || canonicalValue > config.thresholdUpperValue!;
  }
}

export function normalizeAlertSeverity(value: unknown): AlertSeverity {
  return enumValue(value, "severity", ["INFO", "WARNING", "CRITICAL"] as const);
}

export function normalizePatientActionKey(value: unknown): string {
  return token(value, "patientActionKey");
}

export function normalizeAlertRuleStatus(value: unknown): "ACTIVE" | "PAUSED" | "RETIRED" {
  return enumValue(value, "status", ["ACTIVE", "PAUSED", "RETIRED"] as const);
}

export function normalizeAlertWorkflowAction(value: unknown): AlertWorkflowAction {
  return enumValue(value, "action", ["ACKNOWLEDGE", "ASSIGN", "ESCALATE", "RESOLVE", "VIEWED"] as const);
}

export function normalizeReasonCode(value: unknown, required = false): string | null {
  if ((value == null || value === "") && !required) return null;
  if (typeof value !== "string") throw new BadRequestException("reasonCode is required.");
  const normalized = value.trim().toUpperCase();
  if (!REASON.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
  return normalized;
}

export function nextAlertStatus(current: string, action: AlertWorkflowAction): string {
  if (action === "VIEWED") return current;
  if (current === "RESOLVED") throw new BadRequestException("Resolved alerts are immutable.");
  if (action === "ACKNOWLEDGE" || action === "ASSIGN") return "ACKNOWLEDGED";
  if (action === "ESCALATE") return "ESCALATED";
  if (action === "RESOLVE") return "RESOLVED";
  return current;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${field} must be an object.`);
  return value as Record<string, unknown>;
}
function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequestException(`${field} must be a finite number.`);
  return value;
}
function token(value: unknown, field: string): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
  const normalized = value.trim().toUpperCase();
  if (!TOKEN.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized;
}
function tokenArray(value: unknown, field: string, min: number, max: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new BadRequestException(`${field} must contain between ${min} and ${max} values.`);
  const output = [...new Set(value.map((item) => token(item, field)))];
  if (output.length !== value.length) throw new BadRequestException(`${field} cannot contain duplicates.`);
  return output;
}
function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const normalized = token(value, field);
  if (!(allowed as readonly string[]).includes(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized as T;
}
function enumArray<T extends string>(value: unknown, field: string, allowed: readonly T[]): T[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > allowed.length) throw new BadRequestException(`${field} is invalid.`);
  const output = [...new Set(value.map((item) => enumValue(item, field, allowed)))];
  if (output.length !== value.length) throw new BadRequestException(`${field} cannot contain duplicates.`);
  return output;
}
