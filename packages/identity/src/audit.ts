import { randomId } from "./crypto.js";
import type { AuditEntry, AuditResult } from "./types.js";

export class AuditTrail {
  private readonly entries: AuditEntry[] = [];
  append(actorId: string | null, action: string, objectType: string, objectId: string | null, result: AuditResult, metadata: Record<string, unknown> = {}): void {
    this.entries.push({ id: randomId("audit"), actorId, action, objectType, objectId, result, metadata, occurredAt: new Date().toISOString() });
  }
  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-Math.max(1, Math.min(limit, 500))).reverse().map((entry) => structuredClone(entry));
  }
}
