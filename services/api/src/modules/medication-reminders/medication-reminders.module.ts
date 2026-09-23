import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";
import { DependentsModule } from "../dependents/dependents.module";
import { PatientContextService } from "../dependents/dependents.service";

const SWEEP_MS = 60_000;
const SOURCE_KINDS = new Set(["CLINICAL_PROFILE_ENTRY", "PRESCRIPTION_ORDER"]);
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const FIXED_ZONE_RE = /^UTC([+-])(\d{2}):(\d{2})$/;

type SourceKind = "CLINICAL_PROFILE_ENTRY" | "PRESCRIPTION_ORDER";
type ReminderInput = {
  sourceKind?: string;
  sourceId?: string;
  localTimes?: unknown;
  timeZone?: unknown;
};
type ReminderUpdate = {
  enabled?: unknown;
  localTimes?: unknown;
  timeZone?: unknown;
};

@Injectable()
class MedicationReminderService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly contexts: PatientContextService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async list(principal: AuthPrincipal) {
    this.patientRole(principal);
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const rows = await this.prisma.medicationReminder.findMany({
      where: { accountId: principal.accountId, patientId: context.patientId },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "MEDICATION_REMINDER_LIST_READ",
      objectType: "PATIENT",
      objectId: context.patientId,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { patientId: context.patientId, reminderCount: rows.length, clinicalContentIncluded: false },
    });
    return {
      patientId: context.patientId,
      mode: context.mode,
      items: rows.map((row) => this.present(row)),
      sourceOfTruth: "CLINICAL_PROFILE_OR_PRESCRIPTION",
      prescriptionMutationAllowed: false,
    };
  }

  async create(principal: AuthPrincipal, input: ReminderInput) {
    this.patientRole(principal);
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_WRITE");
    const sourceKind = this.sourceKind(input?.sourceKind);
    const sourceId = this.id(input?.sourceId, "sourceId");
    const localTimes = this.times(input?.localTimes);
    const timeZone = this.timeZone(input?.timeZone);
    await this.assertActiveSource(context.patientId, sourceKind, sourceId);

    const existing = await this.prisma.medicationReminder.findUnique({
      where: {
        accountId_patientId_sourceKind_sourceId: {
          accountId: principal.accountId,
          patientId: context.patientId,
          sourceKind,
          sourceId,
        },
      },
    });
    if (existing) throw new ConflictException("A reminder already exists for this medication source.");

    const row = await this.prisma.medicationReminder.create({
      data: {
        patientId: context.patientId,
        accountId: principal.accountId,
        sourceKind,
        sourceId,
        enabled: true,
        localTimes: localTimes as unknown as Prisma.InputJsonValue,
        timeZone,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "MEDICATION_REMINDER_CREATED",
      objectType: "MEDICATION_REMINDER",
      objectId: row.id,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        patientId: context.patientId,
        resourceId: row.id,
        sourceKind,
        sourceId,
        scheduleCount: localTimes.length,
        timeZone,
        prescriptionMutationAllowed: false,
      },
    });
    return this.present(row);
  }

  async update(principal: AuthPrincipal, reminderIdRaw: string, input: ReminderUpdate) {
    this.patientRole(principal);
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_WRITE");
    const reminderId = this.id(reminderIdRaw, "reminderId");
    const current = await this.prisma.medicationReminder.findUnique({ where: { id: reminderId } });
    if (!current || current.accountId !== principal.accountId || current.patientId !== context.patientId) {
      throw new NotFoundException("Medication reminder not found.");
    }

    const data: Prisma.MedicationReminderUpdateInput = {};
    if (input?.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new BadRequestException("enabled must be boolean.");
      if (input.enabled) {
        await this.assertActiveSource(
          current.patientId,
          current.sourceKind as SourceKind,
          current.sourceId,
        );
      }
      data.enabled = input.enabled;
    }
    if (input?.localTimes !== undefined) {
      data.localTimes = this.times(input.localTimes) as unknown as Prisma.InputJsonValue;
    }
    if (input?.timeZone !== undefined) data.timeZone = this.timeZone(input.timeZone);
    if (Object.keys(data).length === 0) throw new BadRequestException("No reminder changes were supplied.");

    const updated = await this.prisma.medicationReminder.update({ where: { id: current.id }, data });
    await this.audit.write({
      actorId: principal.accountId,
      action: "MEDICATION_REMINDER_UPDATED",
      objectType: "MEDICATION_REMINDER",
      objectId: updated.id,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        patientId: context.patientId,
        resourceId: updated.id,
        sourceKind: updated.sourceKind,
        sourceId: updated.sourceId,
        enabled: updated.enabled,
        scheduleCount: this.readTimes(updated.localTimes).length,
        timeZone: updated.timeZone,
        prescriptionMutationAllowed: false,
      },
    });
    return this.present(updated);
  }

  async sweep() {
    if (this.running) return { status: "BUSY", evaluated: 0, emitted: 0, disabled: 0 };
    this.running = true;
    try {
      const now = new Date();
      const rows = await this.prisma.medicationReminder.findMany({
        where: { enabled: true },
        orderBy: { updatedAt: "asc" },
        take: 1000,
      });
      let emitted = 0;
      let disabled = 0;
      for (const row of rows) {
        const active = await this.sourceIsActive(
          row.patientId,
          row.sourceKind as SourceKind,
          row.sourceId,
        );
        if (!active) {
          const changed = await this.prisma.medicationReminder.updateMany({
            where: { id: row.id, enabled: true },
            data: { enabled: false },
          });
          if (changed.count === 1) {
            disabled += 1;
            await this.audit.write({
              actorId: "medication-reminder-scheduler",
              action: "MEDICATION_REMINDER_AUTO_DISABLED",
              objectType: "MEDICATION_REMINDER",
              objectId: row.id,
              purpose: "SYSTEM_ACCESS",
              result: "SUCCESS",
              metadata: {
                patientId: row.patientId,
                resourceId: row.id,
                sourceKind: row.sourceKind,
                sourceId: row.sourceId,
                reason: "SOURCE_NOT_ACTIVE",
              },
            }).catch(() => undefined);
          }
          continue;
        }

        const slot = this.localSlot(now, row.timeZone);
        if (!this.readTimes(row.localTimes).includes(slot.time)) continue;
        await this.notifications.notifyAccount({
          accountId: row.accountId,
          dedupeKey: `medication-reminder:${row.id}:${slot.date}:${slot.time}`,
          type: "CARE_COORDINATION",
          entityType: "MEDICATION_REMINDER",
          entityId: row.id,
          safeTitleKey: "notification.medication_reminder.title",
          safeBodyKey: "notification.medication_reminder.body",
        });
        emitted += 1;
      }
      return { status: "COMPLETED", evaluated: rows.length, emitted, disabled };
    } finally {
      this.running = false;
    }
  }

  private async assertActiveSource(patientId: string, sourceKind: SourceKind, sourceId: string) {
    if (!(await this.sourceIsActive(patientId, sourceKind, sourceId))) {
      throw new ConflictException("Medication reminder source is not active.");
    }
  }

  private async sourceIsActive(patientId: string, sourceKind: SourceKind, sourceId: string) {
    if (sourceKind === "CLINICAL_PROFILE_ENTRY") {
      const row = await this.prisma.clinicalProfileEntry.findUnique({
        where: { id: sourceId },
        select: { patientId: true, kind: true, status: true },
      });
      return row?.patientId === patientId && row.kind === "MEDICATION" && row.status === "ACTIVE";
    }
    const row = await this.prisma.clinicalOrder.findUnique({
      where: { id: sourceId },
      select: { patientId: true, type: true, status: true },
    });
    return row?.patientId === patientId && row.type === "PRESCRIPTION" && row.status === "SIGNED";
  }

  private patientRole(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient account is required.");
  }

  private sourceKind(value: unknown): SourceKind {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!SOURCE_KINDS.has(normalized)) throw new BadRequestException("sourceKind is invalid.");
    return normalized as SourceKind;
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private times(value: unknown) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
      throw new BadRequestException("localTimes must contain between 1 and 12 HH:mm values.");
    }
    const values = value.map((item, index) => {
      if (typeof item !== "string" || !TIME_RE.test(item.trim())) {
        throw new BadRequestException(`localTimes[${index}] must use HH:mm.`);
      }
      return item.trim();
    });
    const unique = [...new Set(values)].sort();
    if (unique.length !== values.length) throw new BadRequestException("localTimes must not contain duplicates.");
    return unique;
  }

  private readTimes(value: Prisma.JsonValue) {
    try { return this.times(value); } catch { return []; }
  }

  private timeZone(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("timeZone is required.");
    const zone = value.trim();
    if (zone.length < 1 || zone.length > 64 || /\p{Cc}/u.test(zone)) {
      throw new BadRequestException("timeZone is invalid.");
    }
    const fixed = FIXED_ZONE_RE.exec(zone);
    if (fixed) {
      const hours = Number(fixed[2]);
      const minutes = Number(fixed[3]);
      if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
        throw new BadRequestException("timeZone fixed offset is invalid.");
      }
      return zone;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
      return zone;
    } catch {
      throw new BadRequestException("timeZone must be an IANA zone or UTC±HH:MM.");
    }
  }

  private localSlot(now: Date, zone: string) {
    const fixed = FIXED_ZONE_RE.exec(zone);
    if (fixed) {
      const sign = fixed[1] === "+" ? 1 : -1;
      const offset = sign * (Number(fixed[2]) * 60 + Number(fixed[3])) * 60_000;
      const shifted = new Date(now.getTime() + offset);
      const iso = shifted.toISOString();
      return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
    }
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(now)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
    };
  }

  private present(row: {
    id: string;
    patientId: string;
    accountId: string;
    sourceKind: string;
    sourceId: string;
    enabled: boolean;
    localTimes: Prisma.JsonValue;
    timeZone: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      patientId: row.patientId,
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      enabled: row.enabled,
      localTimes: this.readTimes(row.localTimes),
      timeZone: row.timeZone,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      patientManaged: true,
      prescriptionMutationAllowed: false,
    };
  }
}

@Controller("patient/medication-reminders")
class PatientMedicationReminderController {
  constructor(private readonly reminders: MedicationReminderService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.reminders.list(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: ReminderInput) {
    return this.reminders.create(principal, body ?? {});
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Patch(":reminderId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("reminderId") reminderId: string,
    @Body() body: ReminderUpdate,
  ) {
    return this.reminders.update(principal, reminderId, body ?? {});
  }
}

@Module({
  imports: [DependentsModule, CommunicationsModule],
  controllers: [PatientMedicationReminderController],
  providers: [MedicationReminderService],
})
export class MedicationReminderModule {}
