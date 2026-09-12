import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

export type SiemSecuritySeverity = "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SiemAuditEventInput {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  purpose: string | null;
  result: string;
  metadata: unknown;
  occurredAt: Date;
}

export interface SiemAuditEventPayload {
  schemaVersion: 1;
  source: "carepoint-api";
  eventRef: string;
  action: string;
  result: string;
  severity: SiemSecuritySeverity;
  actorRef: string | null;
  actorRole: string | null;
  objectType: string;
  targetRef: string | null;
  purpose: string | null;
  indicators: Record<string, boolean | string>;
  occurredAt: string;
}

const REPLAY_ACTIONS = new Set(["MFA_CHALLENGE_REPLAY_DENIED", "REFRESH_TOKEN_REPLAY_DENIED"]);
const ALLOWED_ROLES = new Set(["ADMIN", "SUPPORT", "PATIENT", "DOCTOR", "OTHER_PROVIDER"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class SiemEventPresenterService {
  present(event: SiemAuditEventInput): SiemAuditEventPayload {
    const actorRole = event.actorRole && ALLOWED_ROLES.has(event.actorRole) ? event.actorRole : null;
    return {
      schemaVersion: 1,
      source: "carepoint-api",
      eventRef: this.reference("EVT", event.id),
      action: this.safeToken(event.action, "UNKNOWN_ACTION"),
      result: this.safeResult(event.result),
      severity: this.eventSeverity(event.action, event.result, event.metadata),
      actorRef: event.actorId ? this.accountRef(event.actorId, actorRole ?? "UNKNOWN") : null,
      actorRole,
      objectType: this.safeToken(event.objectType, "UNKNOWN_OBJECT"),
      targetRef: this.objectRef(event.objectType, event.objectId, actorRole),
      purpose: event.purpose ? this.safeToken(event.purpose, "OTHER") : null,
      indicators: this.safeIndicators(event.metadata),
      occurredAt: event.occurredAt.toISOString(),
    };
  }

  reference(prefix: string, value: string): string {
    return `${prefix}-${this.digest(value).slice(0, 12).toUpperCase()}`;
  }

  private accountRef(accountId: string, role: string): string {
    return `${role}-${this.digest(accountId).slice(0, 12).toUpperCase()}`;
  }

  private objectRef(objectType: string, objectId: string | null, role: string | null): string | null {
    if (!objectId) return null;
    if (objectType === "ACCOUNT") return this.accountRef(objectId, role ?? "UNKNOWN");
    if (objectType === "SESSION") return this.reference("SES", objectId);
    if (objectType === "AUTH_CHALLENGE") return this.reference("MFA", objectId);
    if (objectType === "API_ROUTE") return this.reference("API", objectId);
    return null;
  }

  private safeIndicators(metadata: unknown): Record<string, boolean | string> {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
    const value = metadata as Record<string, unknown>;
    const method = typeof value.method === "string" ? value.method.toUpperCase() : null;
    const role = typeof value.role === "string" ? value.role : null;
    return {
      ...(typeof value.lockoutApplied === "boolean" ? { lockoutApplied: value.lockoutApplied } : {}),
      ...(typeof value.concurrentReplay === "boolean" ? { concurrentReplay: value.concurrentReplay } : {}),
      ...(typeof value.replaced === "boolean" ? { replaced: value.replaced } : {}),
      ...(typeof value.mfa === "boolean" ? { mfa: value.mfa } : {}),
      ...(role && ALLOWED_ROLES.has(role) ? { role } : {}),
      ...(method && ALLOWED_METHODS.has(method) ? { method } : {}),
    };
  }

  private eventSeverity(action: string, result: string, metadata: unknown): SiemSecuritySeverity {
    const indicators = this.safeIndicators(metadata);
    if (action === "ACCOUNT_SUSPENDED") return "CRITICAL";
    if (REPLAY_ACTIONS.has(action)) return indicators.concurrentReplay === true ? "CRITICAL" : "HIGH";
    if (action === "LOGIN_FAILED" && indicators.lockoutApplied === true) return "HIGH";
    if (result === "DENIED" || result === "FAILED") return "MEDIUM";
    return "INFO";
  }

  private safeResult(value: string): string {
    return ["SUCCESS", "DENIED", "FAILED"].includes(value) ? value : "FAILED";
  }

  private safeToken(value: string, fallback: string): string {
    const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_.:-]/g, "_").slice(0, 120);
    return normalized || fallback;
  }

  private digest(value: string): string {
    return createHash("sha256").update(`carepoint-admin-security:${value}`).digest("hex");
  }
}
