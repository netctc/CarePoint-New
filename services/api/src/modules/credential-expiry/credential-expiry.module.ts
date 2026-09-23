import { BadRequestException, Body, Controller, Get, Header, Injectable, Module, Post, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";
import { credentialIsCurrent, jsonStringArray } from "../../security/provider-credential-validity";

const POLICY_CODE = "GLOBAL";
const DAY_MS = 86_400_000;
const SWEEP_MS = 6 * 60 * 60 * 1000;
const DEFAULT_WINDOWS = [90, 30, 7];

type State = "CURRENT" | "EXPIRING" | "EXPIRED" | "MISSING";
type UpdatePolicyBody = { notificationsEnabled?: boolean; warningDays?: number[] };

@Injectable()
class CredentialExpiryService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep("credential-expiry-scheduler"), SWEEP_MS);
    this.timer.unref?.();
    void this.sweep("credential-expiry-scheduler");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async snapshot(principal: AuthPrincipal) {
    const policy = await this.policy();
    const items = await this.items(policy.warningDays);
    const summary = Object.fromEntries(["CURRENT","EXPIRING","EXPIRED","MISSING"].map(state => [
      state, items.filter(item => item.state === state).length,
    ]));
    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_CREDENTIAL_EXPIRY_SNAPSHOT_READ",
      objectType: "CREDENTIAL_EXPIRY_POLICY",
      objectId: policy.id,
      purpose: "PROVIDER_GOVERNANCE",
      result: "SUCCESS",
      metadata: { summary, requiredCredentialRows: items.length, operationalAccessBlockedOnExpiry: true },
    });
    return {
      generatedAt: new Date().toISOString(),
      policy,
      summary,
      items,
      invariants: {
        operationalAccessBlockedOnExpiry: true,
        runtimeEnforcementConfigurable: false,
        credentialNumbersExposed: false,
        credentialIssuersExposed: false,
      },
    };
  }

  async updatePolicy(principal: AuthPrincipal, body: UpdatePolicyBody) {
    const warningDays = body.warningDays === undefined ? undefined : this.windows(body.warningDays);
    if (body.notificationsEnabled !== undefined && typeof body.notificationsEnabled !== "boolean") {
      throw new BadRequestException("notificationsEnabled must be boolean.");
    }
    const updated = await this.prisma.credentialExpiryPolicy.update({
      where: { code: POLICY_CODE },
      data: {
        ...(warningDays ? { warningDays: warningDays as unknown as Prisma.InputJsonValue } : {}),
        ...(body.notificationsEnabled !== undefined ? { notificationsEnabled: body.notificationsEnabled } : {}),
        updatedByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_CREDENTIAL_EXPIRY_POLICY_UPDATED",
      objectType: "CREDENTIAL_EXPIRY_POLICY",
      objectId: updated.id,
      purpose: "PROVIDER_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        warningDays: this.readWindows(updated.warningDays),
        notificationsEnabled: updated.notificationsEnabled,
        operationalAccessBlockedOnExpiry: true,
      },
    });
    return this.presentPolicy(updated);
  }

  runNow(principal: AuthPrincipal) { return this.sweep(principal.accountId, true); }

  private async sweep(actorId: string, manual = false) {
    if (this.running) return { status: "BUSY", candidates: 0, created: 0 };
    this.running = true;
    try {
      const policy = await this.policy();
      if (!policy.notificationsEnabled) return { status: "DISABLED", candidates: 0, created: 0 };
      const candidates = (await this.items(policy.warningDays)).filter(item => item.state === "EXPIRING" || item.state === "EXPIRED");
      let created = 0;
      for (const item of candidates) {
        if (!item.accountId || !item.credentialId) continue;
        const bucket = item.state === "EXPIRED" ? "expired" : String(this.bucket(item.daysRemaining, policy.warningDays));
        const suffix = ["credential-expiry", item.providerId, item.credentialId, item.validUntil ?? "none", bucket].join(":");
        const dedupeKey = item.accountId + ":" + suffix;
        const existing = await this.prisma.notificationEvent.findUnique({ where: { dedupeKey }, select: { id: true } });
        await this.notifications.notifyAccount({
          accountId: item.accountId,
          dedupeKey: suffix,
          type: "CARE_COORDINATION",
          entityType: "PROVIDER_CREDENTIAL",
          entityId: item.credentialId,
          safeTitleKey: item.state === "EXPIRED" ? "provider.credential.expired.title" : "provider.credential.expiring.title",
          safeBodyKey: item.state === "EXPIRED" ? "provider.credential.expired.body" : "provider.credential.expiring.body",
        });
        if (!existing) created += 1;
      }
      await this.audit.write({
        actorId,
        action: manual ? "PROVIDER_CREDENTIAL_REMINDER_SWEEP_RUN" : "PROVIDER_CREDENTIAL_REMINDER_SWEEP",
        objectType: "CREDENTIAL_EXPIRY_POLICY",
        objectId: policy.id,
        purpose: "PROVIDER_GOVERNANCE",
        result: "SUCCESS",
        metadata: { candidateCount: candidates.length, createdCount: created, warningDays: policy.warningDays },
      }).catch(() => undefined);
      return { status: "COMPLETED", candidates: candidates.length, created };
    } finally { this.running = false; }
  }

  private async items(warningDays: number[]) {
    const now = new Date();
    const maxWarning = Math.max(...warningDays);
    const providers = await this.prisma.provider.findMany({
      where: { status: "ACTIVE", class: { in: ["DOCTOR","OTHER_PROVIDER"] }, userId: { not: null } },
      select: {
        id: true, userId: true, class: true, displayName: true,
        credentials: { where: { status: "VERIFIED" }, select: { id:true,type:true,status:true,validFrom:true,validUntil:true,createdAt:true } },
        otherProviderProfile: { select: { category: { select: { active:true, requiredCredentialTypes:true } } } },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
    const out: Array<Record<string, unknown>> = [];
    for (const provider of providers) {
      if (!provider.userId) continue;
      const required = provider.class === "DOCTOR"
        ? ["medical-license"]
        : provider.otherProviderProfile?.category?.active
          ? jsonStringArray(provider.otherProviderProfile.category.requiredCredentialTypes)
          : [];
      for (const type of required) {
        const matching = provider.credentials.filter(c => c.type.trim().toLowerCase() === type);
        const current = matching.filter(c => credentialIsCurrent(c, now)).sort((a,b) => (b.validUntil?.getTime() ?? Number.MAX_SAFE_INTEGER) - (a.validUntil?.getTime() ?? Number.MAX_SAFE_INTEGER))[0];
        if (current) {
          const days = current.validUntil ? Math.max(0, Math.ceil((current.validUntil.getTime() - now.getTime()) / DAY_MS)) : null;
          const state: State = days !== null && days <= maxWarning ? "EXPIRING" : "CURRENT";
          out.push(this.row(provider, type, current.id, current.validUntil, days, state));
          continue;
        }
        const expired = matching.filter(c => c.validUntil && c.validUntil.getTime() <= now.getTime()).sort((a,b) => b.validUntil!.getTime() - a.validUntil!.getTime())[0];
        if (expired) {
          out.push(this.row(provider, type, expired.id, expired.validUntil, Math.floor((expired.validUntil!.getTime() - now.getTime()) / DAY_MS), "EXPIRED"));
        } else {
          out.push({
            providerId: provider.id, providerDisplayName: provider.displayName, providerClass: provider.class,
            accountId: provider.userId, credentialType: type, credentialId: null, state: "MISSING",
            validUntil: null, daysRemaining: null, operationallyBlocked: true,
          });
        }
      }
    }
    return out;
  }

  private row(provider: {id:string;displayName:string;class:string;userId:string|null}, type:string, credentialId:string, validUntil:Date|null, days:number|null, state:State) {
    return {
      providerId: provider.id, providerDisplayName: provider.displayName, providerClass: provider.class,
      accountId: provider.userId, credentialType: type, credentialId, state,
      validUntil: validUntil?.toISOString() ?? null, daysRemaining: days,
      operationallyBlocked: state === "EXPIRED" || state === "MISSING",
    };
  }

  private bucket(days: unknown, windows: number[]) {
    const value = typeof days === "number" ? days : Math.max(...windows);
    return [...windows].sort((a,b) => a-b).find(window => value <= window) ?? Math.max(...windows);
  }

  private async policy() {
    const row = await this.prisma.credentialExpiryPolicy.findUnique({ where: { code: POLICY_CODE } })
      ?? await this.prisma.credentialExpiryPolicy.create({
        data: { code: POLICY_CODE, notificationsEnabled: true, warningDays: DEFAULT_WINDOWS as unknown as Prisma.InputJsonValue },
      });
    return this.presentPolicy(row);
  }

  private presentPolicy(row: {id:string;code:string;notificationsEnabled:boolean;warningDays:Prisma.JsonValue;updatedAt:Date}) {
    return {
      id: row.id, code: row.code, notificationsEnabled: row.notificationsEnabled,
      warningDays: this.readWindows(row.warningDays), updatedAt: row.updatedAt,
      operationalAccessBlockedOnExpiry: true, runtimeEnforcementConfigurable: false,
    };
  }

  private windows(raw: unknown): number[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5) throw new BadRequestException("warningDays must contain 1-5 values.");
    const values = raw.map(value => {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 365) throw new BadRequestException("warningDays values must be integers from 1 to 365.");
      return Number(value);
    });
    if (new Set(values).size !== values.length) throw new BadRequestException("warningDays must not contain duplicates.");
    return values.sort((a,b) => b-a);
  }
  private readWindows(raw: Prisma.JsonValue) { try { return this.windows(raw); } catch { return [...DEFAULT_WINDOWS]; } }
}

@Controller("admin/governance/credential-expirations")
@RequirePermissions("PROVIDER_REVIEW")
class CredentialExpiryController {
  constructor(private readonly expiry: CredentialExpiryService) {}
  @Get() @Header("Cache-Control","no-store")
  snapshot(@CurrentPrincipal() principal: AuthPrincipal) { return this.expiry.snapshot(principal); }
  @Post("policy") @Header("Cache-Control","no-store")
  policy(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: UpdatePolicyBody) { return this.expiry.updatePolicy(principal, body ?? {}); }
  @Post("run-reminders") @Header("Cache-Control","no-store")
  run(@CurrentPrincipal() principal: AuthPrincipal) { return this.expiry.runNow(principal); }
}

@Module({ imports:[CommunicationsModule], controllers:[CredentialExpiryController], providers:[CredentialExpiryService] })
export class CredentialExpiryModule {}
