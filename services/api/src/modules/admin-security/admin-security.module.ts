import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PersistentAuthService } from "../../security/persistent-auth.service";

const PRIVILEGED_ROLES = ["ADMIN", "DOCTOR", "OTHER_PROVIDER"] as const;
const SECURITY_ACTIONS = [
  "LOGIN_FAILED",
  "LOGIN_SUCCEEDED",
  "MFA_CHALLENGE_ISSUED",
  "MFA_CHALLENGE_VERIFIED",
  "MFA_CHALLENGE_REPLAY_DENIED",
  "MFA_ENROLLMENT_STARTED",
  "MFA_ENABLED",
  "REFRESH_TOKEN_REPLAY_DENIED",
  "SESSION_ROTATED",
  "SESSION_REVOKED",
  "ALL_SESSIONS_REVOKED",
  "ACCOUNT_SUSPENDED",
  "AUTHORIZATION_DENIED",
] as const;
const REPLAY_ACTIONS = ["MFA_CHALLENGE_REPLAY_DENIED", "REFRESH_TOKEN_REPLAY_DENIED"] as const;
const SECURITY_ACTION_TYPES = ["REVOKE_SESSION", "REVOKE_ACCOUNT_SESSIONS"] as const;
const MAX_SESSIONS = 500;
const MAX_EVENTS = 300;

type SecurityAction = (typeof SECURITY_ACTION_TYPES)[number];
type SecurityActionBody = { action?: string; sessionId?: string };
type SecuritySeverity = "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";

@Injectable()
class AdminSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: PersistentAuthService,
  ) {}

  async workspace(principal: AuthPrincipal) {
    this.requireAdmin(principal);
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      activeAccounts,
      privilegedAccounts,
      lockedAccounts,
      sessions,
      events,
      deniedEvents24h,
      replayEvents24h,
      recentDeniedRows,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: "ACTIVE" } }),
      this.prisma.user.findMany({
        where: { status: "ACTIVE", role: { in: [...PRIVILEGED_ROLES] } },
        select: { id: true, role: true, mfaEnrollment: { select: { enabledAt: true } } },
      }),
      this.prisma.user.findMany({
        where: { lockedUntil: { gt: now } },
        orderBy: [{ lockedUntil: "desc" }, { id: "asc" }],
        take: 100,
        select: { id: true, role: true, status: true, lockedUntil: true, failedLoginCount: true },
      }),
      this.prisma.authSession.findMany({
        where: { revokedAt: null, refreshExpiresAt: { gt: now } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: MAX_SESSIONS,
        select: {
          id: true,
          expiresAt: true,
          refreshExpiresAt: true,
          revokedAt: true,
          userAgent: true,
          ipAddress: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              role: true,
              status: true,
              lockedUntil: true,
              mfaEnrollment: { select: { enabledAt: true } },
            },
          },
        },
      }),
      this.prisma.auditEvent.findMany({
        where: { action: { in: [...SECURITY_ACTIONS] }, occurredAt: { gte: weekAgo } },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: MAX_EVENTS,
        select: { id: true, actorId: true, action: true, objectType: true, objectId: true, result: true, metadata: true, occurredAt: true },
      }),
      this.prisma.auditEvent.count({
        where: { action: { in: [...SECURITY_ACTIONS] }, result: "DENIED", occurredAt: { gte: dayAgo } },
      }),
      this.prisma.auditEvent.count({
        where: { action: { in: [...REPLAY_ACTIONS] }, occurredAt: { gte: dayAgo } },
      }),
      this.prisma.auditEvent.findMany({
        where: { action: { in: [...SECURITY_ACTIONS] }, result: "DENIED", occurredAt: { gte: dayAgo } },
        orderBy: { occurredAt: "desc" },
        take: 2000,
        select: { actorId: true, action: true },
      }),
    ]);

    const deniedByActor = new Map<string, number>();
    const replayActors = new Set<string>();
    for (const event of recentDeniedRows) {
      if (!event.actorId) continue;
      deniedByActor.set(event.actorId, (deniedByActor.get(event.actorId) ?? 0) + 1);
      if ((REPLAY_ACTIONS as readonly string[]).includes(event.action)) replayActors.add(event.actorId);
    }

    const identityIds = new Set<string>();
    for (const event of events) {
      if (event.actorId) identityIds.add(event.actorId);
      if (event.objectType === "ACCOUNT" && event.objectId) identityIds.add(event.objectId);
    }
    const eventUsers = await this.prisma.user.findMany({
      where: { id: { in: [...identityIds] } },
      select: { id: true, role: true },
    });
    const roleByAccount = new Map(eventUsers.map((user) => [user.id, user.role]));

    const sessionRows = sessions.map((session) => {
      const deniedCount = deniedByActor.get(session.user.id) ?? 0;
      const flags: string[] = [];
      if (session.user.status !== "ACTIVE") flags.push("ACCOUNT_NOT_ACTIVE");
      if (session.user.lockedUntil && session.user.lockedUntil > now) flags.push("ACCOUNT_LOCKED");
      if ((PRIVILEGED_ROLES as readonly string[]).includes(session.user.role) && !session.user.mfaEnrollment?.enabledAt) flags.push("MFA_NOT_ENABLED");
      if (replayActors.has(session.user.id)) flags.push("TOKEN_REPLAY_SIGNAL");
      else if (deniedCount >= 3) flags.push("RECENT_DENIED_EVENTS");
      return {
        sessionId: session.id,
        accountRef: this.accountRef(session.user.id, session.user.role),
        role: session.user.role,
        accountStatus: session.user.status,
        current: session.id === principal.sessionId,
        active: session.revokedAt === null && session.refreshExpiresAt > now,
        mfaEnabled: Boolean(session.user.mfaEnrollment?.enabledAt),
        accessExpiresAt: session.expiresAt.toISOString(),
        refreshExpiresAt: session.refreshExpiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        maskedIp: this.maskIp(session.ipAddress),
        client: this.clientSummary(session.userAgent),
        deniedEvents24h: deniedCount,
        risk: this.sessionRisk(flags),
        riskFlags: flags,
      };
    });

    const privilegedMfaEnabled = privilegedAccounts.filter((account) => account.mfaEnrollment?.enabledAt).length;
    const privilegedMfaCoveragePercent = privilegedAccounts.length
      ? Math.round((privilegedMfaEnabled / privilegedAccounts.length) * 100)
      : 100;

    return {
      generatedAt: now.toISOString(),
      privacy: {
        phiNeutral: true,
        accountIdentityPseudonymized: true,
        rawIpExcluded: true,
        rawUserAgentExcluded: true,
        tokenMaterialExcluded: true,
        auditMetadataWhitelisted: true,
      },
      summary: {
        activeAccounts,
        privilegedAccounts: privilegedAccounts.length,
        privilegedMfaCoveragePercent,
        openSessions: sessions.length,
        lockedAccounts: lockedAccounts.length,
        deniedEvents24h,
        replayEvents24h,
        elevatedRiskSessions: sessionRows.filter((session) => session.risk === "HIGH" || session.risk === "CRITICAL").length,
      },
      queues: {
        sessions: sessionRows.sort((left, right) => this.riskRank(right.risk) - this.riskRank(left.risk) || right.createdAt.localeCompare(left.createdAt)),
        lockedAccounts: lockedAccounts.map((account) => ({
          accountRef: this.accountRef(account.id, account.role),
          role: account.role,
          status: account.status,
          lockedUntil: account.lockedUntil?.toISOString() ?? null,
          failedLoginCount: account.failedLoginCount,
          deniedEvents24h: deniedByActor.get(account.id) ?? 0,
        })),
        securityEvents: events.map((event) => ({
          eventRef: this.reference("EVT", event.id),
          action: event.action,
          result: event.result,
          severity: this.eventSeverity(event.action, event.result, event.metadata),
          actorRef: event.actorId ? this.accountRef(event.actorId, roleByAccount.get(event.actorId) ?? "UNKNOWN") : null,
          actorRole: event.actorId ? roleByAccount.get(event.actorId) ?? null : null,
          objectType: event.objectType,
          targetRef: this.objectRef(event.objectType, event.objectId, roleByAccount),
          indicators: this.safeIndicators(event.metadata),
          occurredAt: event.occurredAt.toISOString(),
        })),
      },
    };
  }

  async act(principal: AuthPrincipal, body: SecurityActionBody) {
    this.requireAdmin(principal);
    const action = this.action(body.action);
    const sessionId = this.identifier(body.sessionId, "sessionId");
    const target = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        refreshExpiresAt: true,
        user: { select: { role: true, status: true } },
      },
    });
    if (!target) throw new NotFoundException("Security session target was not found.");

    if (action === "REVOKE_SESSION") {
      if (target.id === principal.sessionId) throw new BadRequestException("The current Admin Web session must be ended through logout, not remote revocation.");
      await this.auth.revokeSession(principal, target.id);
      return {
        action,
        sessionId: target.id,
        accountRef: this.accountRef(target.userId, target.user.role),
        role: target.user.role,
        alreadyRevoked: Boolean(target.revokedAt),
        revoked: true,
      };
    }

    if (target.userId === principal.accountId) throw new BadRequestException("The current Admin account cannot revoke all of its sessions from the Security Operations workspace.");
    const activeSessions = await this.prisma.authSession.count({
      where: { userId: target.userId, revokedAt: null, refreshExpiresAt: { gt: new Date() } },
    });
    await this.auth.revokeAll(principal, target.userId);
    return {
      action,
      accountRef: this.accountRef(target.userId, target.user.role),
      role: target.user.role,
      revokedSessions: activeSessions,
      revoked: true,
    };
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Admin Security Operations requires the ADMIN role.");
  }

  private action(value: string | undefined): SecurityAction {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || !(SECURITY_ACTION_TYPES as readonly string[]).includes(normalized)) throw new BadRequestException("Unsupported security action.");
    return normalized as SecurityAction;
  }

  private identifier(value: string | undefined, label: string): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > 160) throw new BadRequestException(`${label} is required.`);
    return normalized;
  }

  private accountRef(accountId: string, role: string): string {
    return `${role}-${this.digest(accountId).slice(0, 12).toUpperCase()}`;
  }

  private reference(prefix: string, value: string): string {
    return `${prefix}-${this.digest(value).slice(0, 12).toUpperCase()}`;
  }

  private objectRef(objectType: string, objectId: string | null, roles: Map<string, string>): string | null {
    if (!objectId) return null;
    if (objectType === "ACCOUNT") return this.accountRef(objectId, roles.get(objectId) ?? "UNKNOWN");
    if (objectType === "SESSION") return this.reference("SES", objectId);
    if (objectType === "AUTH_CHALLENGE") return this.reference("MFA", objectId);
    return null;
  }

  private safeIndicators(metadata: unknown) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
    const value = metadata as Record<string, unknown>;
    return {
      ...(typeof value.lockoutApplied === "boolean" ? { lockoutApplied: value.lockoutApplied } : {}),
      ...(typeof value.concurrentReplay === "boolean" ? { concurrentReplay: value.concurrentReplay } : {}),
      ...(typeof value.replaced === "boolean" ? { replaced: value.replaced } : {}),
      ...(typeof value.mfa === "boolean" ? { mfa: value.mfa } : {}),
      ...(typeof value.role === "string" && ["ADMIN", "SUPPORT", "PATIENT", "DOCTOR", "OTHER_PROVIDER"].includes(value.role) ? { role: value.role } : {}),
      ...(typeof value.method === "string" && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(value.method.toUpperCase()) ? { method: value.method.toUpperCase() } : {}),
    };
  }

  private eventSeverity(action: string, result: string, metadata: unknown): SecuritySeverity {
    const indicators = this.safeIndicators(metadata);
    if (action === "ACCOUNT_SUSPENDED") return "CRITICAL";
    if ((REPLAY_ACTIONS as readonly string[]).includes(action)) return indicators.concurrentReplay ? "CRITICAL" : "HIGH";
    if (action === "LOGIN_FAILED" && indicators.lockoutApplied) return "HIGH";
    if (result === "DENIED") return "MEDIUM";
    return "INFO";
  }

  private sessionRisk(flags: string[]): SecuritySeverity {
    if (flags.includes("ACCOUNT_NOT_ACTIVE") || flags.includes("TOKEN_REPLAY_SIGNAL")) return "CRITICAL";
    if (flags.includes("ACCOUNT_LOCKED") || flags.includes("MFA_NOT_ENABLED")) return "HIGH";
    if (flags.includes("RECENT_DENIED_EVENTS")) return "MEDIUM";
    return "INFO";
  }

  private riskRank(value: SecuritySeverity): number {
    return value === "CRITICAL" ? 4 : value === "HIGH" ? 3 : value === "MEDIUM" ? 2 : 1;
  }

  private maskIp(raw: string | null): string | null {
    if (!raw) return null;
    const candidate = raw.split(",", 1)[0]?.trim() ?? "";
    const value = candidate.startsWith("::ffff:") ? candidate.slice(7) : candidate;
    const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.x`;
    if (/^[0-9a-f:]+$/i.test(value) && value.includes(":")) {
      const parts = value.split(":").filter(Boolean).slice(0, 4);
      return parts.length ? `${parts.join(":")}::/64` : "ipv6-masked";
    }
    return "masked";
  }

  private clientSummary(raw: string | null) {
    const value = raw ?? "";
    const browser = /Edg\//i.test(value) ? "Edge" : /Firefox\//i.test(value) ? "Firefox" : /Chrome\//i.test(value) ? "Chrome" : /Safari\//i.test(value) ? "Safari" : "Other";
    const platform = /Android/i.test(value) ? "Android" : /iPhone|iPad|iOS/i.test(value) ? "iOS" : /Windows/i.test(value) ? "Windows" : /Macintosh|Mac OS X/i.test(value) ? "macOS" : /Linux/i.test(value) ? "Linux" : "Other";
    const deviceClass = /Mobile|Android|iPhone|iPad/i.test(value) ? "MOBILE" : "DESKTOP";
    return { browser, platform, deviceClass };
  }

  private digest(value: string): string {
    return createHash("sha256").update(`carepoint-admin-security:${value}`).digest("hex");
  }
}

@Controller("admin/security")
class AdminSecurityController {
  constructor(private readonly security: AdminSecurityService) {}

  @RequirePermissions("IAM_READ_AUDIT")
  @Get("workspace")
  workspace(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.security.workspace(principal);
  }

  @RequirePermissions("IAM_MANAGE_ACCOUNTS")
  @Post("actions")
  act(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: SecurityActionBody) {
    return this.security.act(principal, body);
  }
}

@Module({ controllers: [AdminSecurityController], providers: [AdminSecurityService] })
export class AdminSecurityModule {}
