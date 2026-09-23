import { createHash } from "node:crypto";

export interface AuditIntegrityPayload {
  id: string;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  purpose: string | null;
  result: string;
  metadata: unknown;
  occurredAt: Date | string;
}

export function auditPayloadHash(event: AuditIntegrityPayload): string {
  return sha256(stableJson({
    id: event.id,
    actorId: event.actorId,
    action: event.action,
    objectType: event.objectType,
    objectId: event.objectId,
    purpose: event.purpose,
    result: event.result,
    metadata: event.metadata ?? null,
    occurredAt: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : event.occurredAt,
  }));
}

export function auditChainHash(previousHash: string | null, payloadHash: string): string {
  return sha256(`${previousHash ?? "GENESIS"}:${payloadHash}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) result[key] = normalize(item);
    }
    return result;
  }
  return String(value);
}
