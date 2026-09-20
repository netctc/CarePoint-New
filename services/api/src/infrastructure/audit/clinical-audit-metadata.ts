const SAFE_CLINICAL_AUDIT_KEYS = new Set([
  "domain",
  "accessBasis",
  "consentVersion",
  "decision",
  "denyReason",
  "scope",
  "appointmentId",
  "patientId",
  "providerId",
  "resourceId",
  "resourceVersion",
  "revision",
  "itemCount",
  "schemaVersion",
  "sourceType",
  "sourceId",
  "verificationStatus",
  "changedFields",
  "ruleVersion",
  "eventVersion",
  "jobId",
  "exportId",
  "shareId",
  "deviceId",
  "mergeId",
  "equipmentCount",
  "reasonCode",
  "workflowEventType",
  "formResponseId",
  "contextId",
  "contextType",
  "formPurpose",
  "formCode",
]);

const SAFE_TOKEN = /^[A-Za-z0-9_.:@/-]{1,160}$/;
const SAFE_ENUM = /^[A-Z][A-Z0-9_:-]{0,79}$/;

function safeString(key: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (key === "domain" || key === "accessBasis" || key === "decision" || key === "denyReason" ||
      key === "sourceType" || key === "verificationStatus" || key === "scope" || key === "formPurpose" || key === "contextType" || key === "workflowEventType" || key === "reasonCode") {
    return SAFE_ENUM.test(trimmed) ? trimmed : undefined;
  }
  return SAFE_TOKEN.test(trimmed) ? trimmed : undefined;
}

function safeArray(key: string, value: unknown[]): string[] | undefined {
  if (key !== "changedFields" || value.length > 32) return undefined;
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    const candidate = item.trim();
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(candidate)) return undefined;
    output.push(candidate);
  }
  return output;
}

/**
 * Fail-closed audit metadata projection for clinical/V2 events.
 *
 * The immutable audit row may carry identifiers and structural decision
 * evidence, but never arbitrary request bodies, notes, contact data or other
 * free-text PHI.
 */
export function sanitizeClinicalAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_CLINICAL_AUDIT_KEYS.has(key)) continue;
    if (typeof value === "boolean") {
      safe[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const candidate = safeString(key, value);
      if (candidate !== undefined) safe[key] = candidate;
      continue;
    }
    if (Array.isArray(value)) {
      const candidate = safeArray(key, value);
      if (candidate !== undefined) safe[key] = candidate;
    }
  }
  return safe;
}
