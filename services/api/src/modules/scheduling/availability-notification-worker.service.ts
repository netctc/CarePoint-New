import { HttpException, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { NotificationsService } from "../communications/notifications.service";
import { AVAILABILITY_CONSENT_VERSION } from "./availability-requests.policy";
import { AvailabilityRequestsService } from "./availability-requests.service";

const TITLE_KEY = "notification.availability.available.title";
const BODY_KEY = "notification.availability.available.body";
const DEFAULT_SCAN_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 50;
const WORKER_SESSION_ID = "F4_AVAILABILITY_WORKER";

type Candidate = { id: string; accountId: string };
export interface AvailabilityNotificationConfiguration {
  enabled: boolean;
  scanIntervalMs: number;
  batchSize: number;
}
export interface AvailabilityNotificationRunResult {
  scanned: number;
  alerted: number;
  failed: number;
}
export interface AvailabilityNotificationProcessResult {
  processed: boolean;
  alerted: boolean;
}

export function availabilityNotificationConfiguration(env: NodeJS.ProcessEnv = process.env): AvailabilityNotificationConfiguration {
  const enabled = booleanEnv(env.AVAILABILITY_NOTIFICATION_WORKER_ENABLED, false, "AVAILABILITY_NOTIFICATION_WORKER_ENABLED");
  if (env.NODE_ENV === "production" && enabled) {
    if (!env.AVAILABILITY_NOTIFICATION_SCAN_INTERVAL_MS?.trim()) throw new Error("AVAILABILITY_NOTIFICATION_SCAN_INTERVAL_MS must be explicitly approved when enabling F4 in production.");
    if (!env.AVAILABILITY_NOTIFICATION_BATCH_SIZE?.trim()) throw new Error("AVAILABILITY_NOTIFICATION_BATCH_SIZE must be explicitly approved when enabling F4 in production.");
  }
  return {
    enabled,
    scanIntervalMs: integerEnv(env.AVAILABILITY_NOTIFICATION_SCAN_INTERVAL_MS, DEFAULT_SCAN_INTERVAL_MS, 1_000, 24 * 60 * 60 * 1_000, "AVAILABILITY_NOTIFICATION_SCAN_INTERVAL_MS"),
    batchSize: integerEnv(env.AVAILABILITY_NOTIFICATION_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 200, "AVAILABILITY_NOTIFICATION_BATCH_SIZE"),
  };
}

@Injectable()
export class AvailabilityNotificationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly config = availabilityNotificationConfiguration();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: AvailabilityRequestsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.timer = setInterval(() => void this.runOnce(), this.config.scanIntervalMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<AvailabilityNotificationRunResult> {
    const empty = { scanned: 0, alerted: 0, failed: 0 };
    if (!this.config.enabled || this.running) return empty;
    this.running = true;
    try {
      const cutoff = new Date(now.getTime() - this.config.scanIntervalMs);
      const candidates = await this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
        SELECT r.id, p."userId" AS "accountId"
        FROM "PatientAvailabilityRequest" r
        JOIN "PatientProfile" p ON p.id = r."patientId"
        LEFT JOIN "PatientAvailabilityNotice" n ON n."requestId" = r.id
        WHERE r.status = 'WAITING'
          AND r."toAt" > ${now}
          AND r."noticeConsentVersion" = ${AVAILABILITY_CONSENT_VERSION}
          AND (
            n.id IS NULL
            OR n."checkedAt" <= ${cutoff}
            OR (n.active AND n."lastNotifiedVersion" < n.version)
          )
        ORDER BY COALESCE(n."checkedAt", r."createdAt") ASC, r.id ASC
        LIMIT ${this.config.batchSize}
      `);
      let alerted = 0, failed = 0;
      for (const candidate of candidates) {
        try {
          const result = await this.processRequest(candidate.id, candidate.accountId, now);
          if (result.alerted) alerted += 1;
        } catch {
          // Request/notice/event state is durable. A later bounded scan retries the candidate.
          failed += 1;
        }
      }
      return { scanned: candidates.length, alerted, failed };
    } finally {
      this.running = false;
    }
  }

  async processRequest(requestId: string, accountId?: string, now = new Date()): Promise<AvailabilityNotificationProcessResult> {
    const scope = await this.prisma.patientAvailabilityRequest.findUnique({
      where: { id: requestId },
      select: { id: true, patientId: true, status: true, toAt: true, noticeConsentVersion: true },
    });
    if (!scope || scope.status !== "WAITING" || scope.toAt <= now || scope.noticeConsentVersion !== AVAILABILITY_CONSENT_VERSION) return { processed: false, alerted: false };
    const owner = accountId ? { userId: accountId } : await this.prisma.patientProfile.findUnique({ where: { id: scope.patientId }, select: { userId: true } });
    if (!owner?.userId) return { processed: false, alerted: false };

    const principal: AuthPrincipal = { accountId: owner.userId, role: "PATIENT", sessionId: WORKER_SESSION_ID };
    try {
      // Reuse the exact F3 matching/observation implementation. A manual refresh
      // and an automatic scan therefore cannot drift in eligibility semantics.
      await this.requests.refresh(principal, scope.id);
    } catch (error) {
      if (error instanceof HttpException && (error.getStatus() === 404 || error.getStatus() === 409)) return { processed: false, alerted: false };
      throw error;
    }

    const alerted = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientAvailabilityRequest" WHERE id = ${scope.id} FOR UPDATE`);
      const current = await tx.patientAvailabilityRequest.findUnique({ where: { id: scope.id }, select: { status: true, toAt: true, noticeConsentVersion: true, patientId: true } });
      if (!current || current.status !== "WAITING" || current.toAt <= now || current.noticeConsentVersion !== AVAILABILITY_CONSENT_VERSION) return false;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientAvailabilityNotice" WHERE "requestId" = ${scope.id} FOR UPDATE`);
      const notice = await tx.patientAvailabilityNotice.findUnique({ where: { requestId: scope.id } });
      if (!notice || !notice.active || notice.matchCount < 1 || notice.lastNotifiedVersion >= notice.version) return false;
      const patient = await tx.patientProfile.findUnique({ where: { id: current.patientId }, select: { userId: true } });
      if (!patient) return false;

      const notification = await this.notifications.enqueueAccountInTransaction(tx, {
        accountId: patient.userId,
        dedupeKey: `availability-request:${scope.id}:v${notice.version}`,
        type: "CARE_COORDINATION",
        entityType: "AVAILABILITY_REQUEST",
        entityId: scope.id,
        safeTitleKey: TITLE_KEY,
        safeBodyKey: BODY_KEY,
      });
      // F3 consent is explicitly IN_APP only. The shared enqueue method creates
      // the normal channel set, so remove external rows inside the same uncommitted
      // transaction: no external delivery can ever become visible to the outbox.
      await tx.notificationDelivery.deleteMany({ where: { notificationId: notification.id, channel: { not: "IN_APP" } } });
      const marked = await tx.patientAvailabilityNotice.updateMany({
        where: { id: notice.id, version: notice.version, lastNotifiedVersion: { lt: notice.version } },
        data: { lastNotifiedVersion: notice.version },
      });
      return marked.count === 1;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (alerted) this.notifications.wakeOutbox();
    return { processed: true, alerted };
  }
}

function integerEnv(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}
function booleanEnv(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (!raw?.trim()) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
