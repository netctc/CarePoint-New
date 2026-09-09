import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { NotificationsService } from "./notifications.service";

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 50;
const MAX_REMINDER_OFFSET_MINUTES = 30 * 24 * 60;
const REMINDER_TITLE_KEY = "notification.appointment.reminder.title";
const REMINDER_BODY_KEY = "notification.appointment.reminder.body";

export interface AppointmentNotificationConfiguration {
  enabled: boolean;
  pollMs: number;
  batchSize: number;
  reminderOffsetsMinutes: number[];
}

export interface AppointmentNotificationRunResult {
  lifecycleSignals: number;
  reminderSchedulesCreated: number;
  remindersProcessed: number;
}

type LifecycleTemplate = {
  titleKey: string;
  bodyKey: string;
};

type ReminderCandidate = {
  id: string;
  startsAt: Date;
  updatedAt: Date;
};

export function appointmentNotificationConfiguration(env: NodeJS.ProcessEnv = process.env): AppointmentNotificationConfiguration {
  const enabled = booleanEnv(env.APPOINTMENT_NOTIFICATION_WORKER_ENABLED, true, "APPOINTMENT_NOTIFICATION_WORKER_ENABLED");
  if (env.NODE_ENV === "production" && !enabled) {
    throw new Error("APPOINTMENT_NOTIFICATION_WORKER_ENABLED=false is forbidden in production for Release 1 booking/status notifications.");
  }
  const reminderOffsetsMinutes = reminderOffsets(env.APPOINTMENT_REMINDER_OFFSETS_MINUTES);
  if (env.NODE_ENV === "production" && reminderOffsetsMinutes.length === 0) {
    throw new Error("APPOINTMENT_REMINDER_OFFSETS_MINUTES must explicitly define the approved Release 1 reminder timing policy in production.");
  }
  return {
    enabled,
    pollMs: integerEnv(env.APPOINTMENT_NOTIFICATION_POLL_MS, DEFAULT_POLL_MS, 100, 60_000, "APPOINTMENT_NOTIFICATION_POLL_MS"),
    batchSize: integerEnv(env.APPOINTMENT_NOTIFICATION_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 200, "APPOINTMENT_NOTIFICATION_BATCH_SIZE"),
    reminderOffsetsMinutes,
  };
}

@Injectable()
export class AppointmentNotificationOrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly config = appointmentNotificationConfiguration();
  private timer?: ReturnType<typeof setInterval>;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.timer = setInterval(() => void this.runOnce(), this.config.pollMs);
    this.timer.unref?.();
    this.wake();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
  }

  wake(): void {
    if (!this.config.enabled || this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      void this.runOnce();
    }, 0);
    this.wakeTimer.unref?.();
  }

  async runOnce(now = new Date()): Promise<AppointmentNotificationRunResult> {
    const empty: AppointmentNotificationRunResult = { lifecycleSignals: 0, reminderSchedulesCreated: 0, remindersProcessed: 0 };
    if (!this.config.enabled || this.running) return empty;
    this.running = true;
    try {
      const lifecycleSignals = await this.processLifecycleSignals(this.config.batchSize, now);
      const reminderSchedulesCreated = await this.reconcileReminderSchedules(now, this.config.reminderOffsetsMinutes, this.config.batchSize);
      const remindersProcessed = await this.processDueReminders(now, this.config.batchSize);
      if (lifecycleSignals > 0 || remindersProcessed > 0) this.notifications.wakeOutbox();
      return { lifecycleSignals, reminderSchedulesCreated, remindersProcessed };
    } catch {
      // Lifecycle signals and reminder schedules are durable in PostgreSQL. A failed poll is retried.
      return empty;
    } finally {
      this.running = false;
    }
  }

  private async processLifecycleSignals(limit: number, now: Date): Promise<number> {
    const candidates = await this.prisma.appointmentLifecycleSignal.findMany({
      where: { processedAt: null },
      select: { id: true },
      orderBy: { id: "asc" },
      take: limit,
    });
    let processed = 0;
    for (const candidate of candidates) {
      const accepted = await this.prisma.$transaction(async (tx) => {
        const signal = await tx.appointmentLifecycleSignal.findUnique({ where: { id: candidate.id } });
        if (!signal || signal.processedAt) return false;
        const claimed = await tx.appointmentLifecycleSignal.updateMany({
          where: { id: signal.id, processedAt: null },
          data: { processedAt: now },
        });
        if (claimed.count !== 1) return false;

        const appointment = await tx.appointment.findUnique({
          where: { id: signal.appointmentId },
          select: {
            id: true,
            status: true,
            startsAt: true,
            updatedAt: true,
            patient: { select: { userId: true } },
            provider: { select: { userId: true } },
          },
        });
        if (!appointment) return true;

        if (signal.eventType === "RESCHEDULED") {
          if (signal.previousUpdatedAt) {
            await tx.appointmentReminderSchedule.updateMany({
              where: { appointmentId: appointment.id, appointmentUpdatedAt: signal.previousUpdatedAt, status: "ACTIVE" },
              data: { status: "CANCELLED", cancelledAt: now },
            });
            await this.skipPendingReminderDeliveries(tx, appointment.id, signal.previousUpdatedAt, now);
          }
        } else if (this.isTerminalStatus(signal.toStatus)) {
          await tx.appointmentReminderSchedule.updateMany({
            where: { appointmentId: appointment.id, status: "ACTIVE" },
            data: { status: "CANCELLED", cancelledAt: now },
          });
          await this.skipPendingReminderDeliveries(tx, appointment.id, null, now);
        }

        const template = this.lifecycleTemplate(signal.eventType, signal.toStatus);
        if (!template) return true;
        const recipients = this.recipients(appointment.patient.userId, appointment.provider.userId);
        for (const accountId of recipients) {
          await this.notifications.enqueueAccountInTransaction(tx, {
            accountId,
            dedupeKey: `appointment-event:${signal.id.toString()}`,
            type: "APPOINTMENT_UPDATE",
            entityType: "APPOINTMENT",
            entityId: appointment.id,
            safeTitleKey: template.titleKey,
            safeBodyKey: template.bodyKey,
          });
        }
        return true;
      });
      if (accepted) processed += 1;
    }
    return processed;
  }

  private async reconcileReminderSchedules(now: Date, offsets: number[], limit: number): Promise<number> {
    if (offsets.length === 0) return 0;
    const maxOffset = Math.max(...offsets);
    const horizon = new Date(now.getTime() + maxOffset * 60_000);
    const offsetList = Prisma.join(offsets);
    const candidates = await this.prisma.$queryRaw<ReminderCandidate[]>(Prisma.sql`
      SELECT a.id, a."startsAt", a."updatedAt"
      FROM "Appointment" a
      WHERE a.status = 'CONFIRMED'
        AND a."startsAt" > ${now}
        AND a."startsAt" <= ${horizon}
        AND (
          SELECT COUNT(*)::int
          FROM "AppointmentReminderSchedule" s
          WHERE s."appointmentId" = a.id
            AND s."appointmentUpdatedAt" = a."updatedAt"
            AND s."offsetMinutes" IN (${offsetList})
            AND s.status <> 'CANCELLED'
        ) < ${offsets.length}
      ORDER BY a."startsAt" ASC, a.id ASC
      LIMIT ${limit}
    `);
    let created = 0;
    for (const appointment of candidates) {
      const result = await this.prisma.appointmentReminderSchedule.createMany({
        data: offsets.map((offsetMinutes) => ({
          appointmentId: appointment.id,
          startsAt: appointment.startsAt,
          appointmentUpdatedAt: appointment.updatedAt,
          offsetMinutes,
          dueAt: new Date(appointment.startsAt.getTime() - offsetMinutes * 60_000),
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }
    return created;
  }

  private async processDueReminders(now: Date, limit: number): Promise<number> {
    const candidates = await this.prisma.appointmentReminderSchedule.findMany({
      where: { status: "ACTIVE", dueAt: { lte: now }, startsAt: { gt: now } },
      select: { id: true },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    let processed = 0;
    for (const candidate of candidates) {
      const accepted = await this.prisma.$transaction(async (tx) => {
        const schedule = await tx.appointmentReminderSchedule.findUnique({ where: { id: candidate.id } });
        if (!schedule || schedule.status !== "ACTIVE") return false;
        const appointment = await tx.appointment.findUnique({
          where: { id: schedule.appointmentId },
          select: {
            id: true,
            status: true,
            startsAt: true,
            updatedAt: true,
            patient: { select: { userId: true } },
            provider: { select: { userId: true } },
          },
        });
        const valid = appointment
          && appointment.status === "CONFIRMED"
          && appointment.startsAt.getTime() > now.getTime()
          && appointment.startsAt.getTime() === schedule.startsAt.getTime()
          && appointment.updatedAt.getTime() === schedule.appointmentUpdatedAt.getTime();
        if (!valid || !appointment) {
          await tx.appointmentReminderSchedule.updateMany({
            where: { id: schedule.id, status: "ACTIVE" },
            data: { status: "CANCELLED", cancelledAt: now },
          });
          return true;
        }

        const claimed = await tx.appointmentReminderSchedule.updateMany({
          where: { id: schedule.id, status: "ACTIVE" },
          data: { status: "PROCESSED", processedAt: now },
        });
        if (claimed.count !== 1) return false;
        for (const accountId of this.recipients(appointment.patient.userId, appointment.provider.userId)) {
          await this.notifications.enqueueAccountInTransaction(tx, {
            accountId,
            dedupeKey: `appointment-reminder:${appointment.id}:${schedule.offsetMinutes}:${schedule.appointmentUpdatedAt.getTime()}`,
            type: "APPOINTMENT_UPDATE",
            entityType: "APPOINTMENT",
            entityId: appointment.id,
            safeTitleKey: REMINDER_TITLE_KEY,
            safeBodyKey: REMINDER_BODY_KEY,
          });
        }
        return true;
      });
      if (accepted) processed += 1;
    }
    return processed;
  }

  private async skipPendingReminderDeliveries(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    generation: Date | null,
    now: Date,
  ): Promise<void> {
    await tx.notificationDelivery.updateMany({
      where: {
        status: "PENDING",
        notification: {
          entityType: "APPOINTMENT",
          entityId: appointmentId,
          safeBodyKey: REMINDER_BODY_KEY,
          ...(generation ? { dedupeKey: { endsWith: `:${generation.getTime()}` } } : {}),
        },
      },
      data: {
        status: "SKIPPED",
        attemptedAt: now,
        lastErrorCode: null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
  }

  private lifecycleTemplate(eventType: string, toStatus: string | null): LifecycleTemplate | null {
    if (eventType === "RESCHEDULED") {
      return { titleKey: "notification.appointment.rescheduled.title", bodyKey: "notification.appointment.rescheduled.body" };
    }
    const status = toStatus?.toUpperCase();
    if (status === "REQUESTED") return { titleKey: "notification.appointment.requested.title", bodyKey: "notification.appointment.requested.body" };
    if (status === "CONFIRMED") return { titleKey: "notification.appointment.confirmed.title", bodyKey: "notification.appointment.confirmed.body" };
    if (status === "CANCELLED") return { titleKey: "notification.appointment.cancelled.title", bodyKey: "notification.appointment.cancelled.body" };
    if (status === "COMPLETED") return { titleKey: "notification.appointment.completed.title", bodyKey: "notification.appointment.completed.body" };
    if (status === "NO_SHOW") return { titleKey: "notification.appointment.no-show.title", bodyKey: "notification.appointment.no-show.body" };
    return null;
  }

  private recipients(patientAccountId: string, providerAccountId: string | null): string[] {
    return [...new Set([patientAccountId, ...(providerAccountId ? [providerAccountId] : [])])];
  }

  private isTerminalStatus(status: string | null): boolean {
    return status === "CANCELLED" || status === "COMPLETED" || status === "NO_SHOW";
  }
}

function reminderOffsets(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    if (!/^\d+$/.test(item)) throw new Error("APPOINTMENT_REMINDER_OFFSETS_MINUTES must be a comma-separated list of integer minutes.");
    const value = Number(item);
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_REMINDER_OFFSET_MINUTES) {
      throw new Error(`APPOINTMENT_REMINDER_OFFSETS_MINUTES values must be between 1 and ${MAX_REMINDER_OFFSET_MINUTES}.`);
    }
    return value;
  });
  if (values.length === 0) throw new Error("APPOINTMENT_REMINDER_OFFSETS_MINUTES must contain at least one integer minute offset when set.");
  return [...new Set(values)].sort((a, b) => b - a);
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
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
