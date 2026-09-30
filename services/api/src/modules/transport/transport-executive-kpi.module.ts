import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";

type ScheduleInput = {
  name?: unknown;
  cadence?: unknown;
  weekday?: unknown;
  dayOfMonth?: unknown;
  hourUtc?: unknown;
  minuteUtc?: unknown;
  windowDays?: unknown;
  artifactRetentionDays?: unknown;
  mode?: unknown;
  sla?: unknown;
  providerId?: unknown;
  enabled?: unknown;
};

@Injectable()
export class TransportExecutiveKpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async kpis(principal: AuthPrincipal, windowDaysRaw?: string) {
    const windowDays = this.integerString(windowDaysRaw, 30, 7, 180, "windowDays");
    const now = new Date();
    const currentStart = new Date(now.getTime() - windowDays * 86_400_000);
    const previousStart = new Date(currentStart.getTime() - windowDays * 86_400_000);

    const requests = await this.prisma.medicalTransportRequest.findMany({
      where: { requestedAt: { gte: previousStart, lt: now } },
      select: {
        id: true,
        mode: true,
        status: true,
        requestedAt: true,
        scheduledFor: true,
        assignedAt: true,
        enRouteAt: true,
      },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      take: 30_000,
    });
    const requestIds = requests.map((row) => row.id);
    const [assignments, incidents, escalations] = await Promise.all([
      requestIds.length
        ? this.prisma.crewAssignment.findMany({
            where: { transportRequestId: { in: requestIds } },
            select: {
              id: true,
              transportRequestId: true,
              transportUnitId: true,
              crewProviderIds: true,
              assignedAt: true,
            },
            orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
            take: 40_000,
          })
        : [],
      requestIds.length
        ? this.prisma.transportIncident.findMany({
            where: { transportRequestId: { in: requestIds } },
            select: { id: true, transportRequestId: true, severity: true },
            take: 40_000,
          })
        : [],
      requestIds.length
        ? this.prisma.transportOperationalEscalation.findMany({
            where: { transportRequestId: { in: requestIds } },
            select: { id: true, transportRequestId: true, status: true },
            take: 40_000,
          })
        : [],
    ]);

    const firstReady = new Map<string, (typeof assignments)[number]>();
    for (const assignment of assignments) {
      if (
        assignment.transportUnitId &&
        assignment.crewProviderIds.length > 0 &&
        !firstReady.has(assignment.transportRequestId)
      ) {
        firstReady.set(assignment.transportRequestId, assignment);
      }
    }
    const criticalIncidentIds = new Set(
      incidents
        .filter((row) => row.severity === "CRITICAL")
        .map((row) => row.transportRequestId),
    );
    const activeEscalationIds = new Set(
      escalations
        .filter((row) => row.status === "OPEN" || row.status === "ACKNOWLEDGED")
        .map((row) => row.transportRequestId),
    );
    const thresholds = this.thresholds();

    const currentRequests = requests.filter(
      (row) => row.requestedAt.getTime() >= currentStart.getTime(),
    );
    const previousRequests = requests.filter(
      (row) => row.requestedAt.getTime() < currentStart.getTime(),
    );

    const current = this.periodMetrics(
      currentRequests,
      firstReady,
      criticalIncidentIds,
      activeEscalationIds,
      thresholds,
      now,
    );
    const previous = this.periodMetrics(
      previousRequests,
      firstReady,
      criticalIncidentIds,
      activeEscalationIds,
      thresholds,
      currentStart,
    );

    const payload = {
      generatedAt: now.toISOString(),
      windowDays,
      comparison: {
        method: "EQUAL_PREVIOUS_PERIOD",
        current: {
          from: currentStart.toISOString(),
          to: now.toISOString(),
          metrics: current,
        },
        previous: {
          from: previousStart.toISOString(),
          to: currentStart.toISOString(),
          metrics: previous,
        },
        delta: this.delta(current, previous),
      },
      trend: this.trend(
        currentRequests,
        previousRequests,
        firstReady,
        thresholds,
        currentStart,
        previousStart,
        now,
        windowDays,
      ),
      interpretation: {
        automatedRating: false,
        providerRanking: false,
        machineLearning: false,
        note:
          "Deltas are descriptive current-minus-previous values; they are not an automated quality judgment.",
      },
      sensitiveDataPolicy: {
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
      },
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_EXECUTIVE_KPI_READ",
      objectType: "TRANSPORT_EXECUTIVE_KPI",
      objectId: String(windowDays) + "D",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        windowDays,
        comparisonMethod: "EQUAL_PREVIOUS_PERIOD",
        currentRequests: current.requests,
        previousRequests: previous.requests,
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
      },
    });

    return payload;
  }

  async schedules(principal: AuthPrincipal) {
    const rows = await this.prisma.transportManagementReportSchedule.findMany({
      orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }, { createdAt: "asc" }],
      take: 500,
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_SCHEDULES_READ",
      objectType: "TRANSPORT_REPORT_SCHEDULE",
      objectId: "LIST",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { count: rows.length, automaticDeliveryAvailable: false },
    });
    return {
      generatedAt: new Date().toISOString(),
      executionMode: "EXTERNAL_SCHEDULER_REQUIRED",
      automaticDeliveryAvailable: false,
      items: rows.map((row) => this.presentSchedule(row)),
    };
  }

  async createSchedule(principal: AuthPrincipal, body: ScheduleInput) {
    const normalized = this.scheduleInput(body, null);
    const now = new Date();
    const nextRunAt = this.nextRun(normalized, now);
    const row = await this.prisma.transportManagementReportSchedule.create({
      data: {
        ...normalized,
        nextRunAt,
        deliveryMode: "EXTERNAL_SCHEDULER",
        createdByAccountId: principal.accountId,
        updatedByAccountId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_SCHEDULE_CREATED",
      objectType: "TRANSPORT_REPORT_SCHEDULE",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        cadence: row.cadence,
        enabled: row.enabled,
        nextRunAt: row.nextRunAt.toISOString(),
        automaticDeliveryAvailable: false,
      },
    });
    return this.presentSchedule(row);
  }

  async updateSchedule(
    principal: AuthPrincipal,
    scheduleId: string,
    body: ScheduleInput,
  ) {
    const id = this.id(scheduleId, "scheduleId");
    const existing = await this.prisma.transportManagementReportSchedule.findUnique({
      where: { id },
    });
    if (!existing) throw new BadRequestException("Transport report schedule was not found.");
    const normalized = this.scheduleInput(body, existing);
    const timingChanged =
      body.cadence !== undefined ||
      body.weekday !== undefined ||
      body.dayOfMonth !== undefined ||
      body.hourUtc !== undefined ||
      body.minuteUtc !== undefined;
    const nextRunAt = timingChanged
      ? this.nextRun(normalized, new Date())
      : existing.nextRunAt;
    const row = await this.prisma.transportManagementReportSchedule.update({
      where: { id },
      data: {
        ...normalized,
        nextRunAt,
        updatedByAccountId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_SCHEDULE_UPDATED",
      objectType: "TRANSPORT_REPORT_SCHEDULE",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        cadence: row.cadence,
        enabled: row.enabled,
        nextRunAt: row.nextRunAt.toISOString(),
        automaticDeliveryAvailable: false,
      },
    });
    return this.presentSchedule(row);
  }

  async markRun(principal: AuthPrincipal, scheduleId: string) {
    const id = this.id(scheduleId, "scheduleId");
    const existing = await this.prisma.transportManagementReportSchedule.findUnique({
      where: { id },
    });
    if (!existing) throw new BadRequestException("Transport report schedule was not found.");
    if (!existing.enabled) throw new BadRequestException("Transport report schedule is disabled.");
    const now = new Date();
    const nextRunAt = this.nextRun(existing, new Date(now.getTime() + 60_000));
    const row = await this.prisma.transportManagementReportSchedule.update({
      where: { id },
      data: {
        lastRunAt: now,
        nextRunAt,
        updatedByAccountId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_SCHEDULE_RUN_RECORDED",
      objectType: "TRANSPORT_REPORT_SCHEDULE",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        lastRunAt: now.toISOString(),
        nextRunAt: nextRunAt.toISOString(),
        reportDeliveryPerformed: false,
      },
    });
    return {
      ...this.presentSchedule(row),
      reportDeliveryPerformed: false,
      note:
        "Run timing was recorded only. Report generation/delivery remains the responsibility of an external scheduler/worker.",
    };
  }

  private periodMetrics(
    requests: Array<{
      id: string;
      mode: string;
      status: string;
      requestedAt: Date;
      scheduledFor: Date;
      assignedAt: Date | null;
      enRouteAt: Date | null;
    }>,
    firstReady: Map<string, { assignedAt: Date }>,
    criticalIncidentIds: Set<string>,
    activeEscalationIds: Set<string>,
    thresholds: {
      assignmentSlaMinutes: number;
      resourceReadySlaMinutes: number;
      departureGraceMinutes: number;
    },
    asOf: Date,
  ) {
    let assignmentEvaluated = 0;
    let assignmentCompliant = 0;
    let readinessEvaluated = 0;
    let readinessCompliant = 0;
    let departureEvaluated = 0;
    let departureCompliant = 0;
    let breachedRequests = 0;

    for (const request of requests) {
      if (request.status === "CANCELLED") continue;
      let breached = false;

      if (request.assignedAt) {
        assignmentEvaluated += 1;
        if (
          this.minutes(request.requestedAt, request.assignedAt) <=
          thresholds.assignmentSlaMinutes
        ) {
          assignmentCompliant += 1;
        } else {
          breached = true;
        }

        const ready = firstReady.get(request.id);
        if (ready) {
          readinessEvaluated += 1;
          if (
            this.minutes(request.assignedAt, ready.assignedAt) <=
            thresholds.resourceReadySlaMinutes
          ) {
            readinessCompliant += 1;
          } else {
            breached = true;
          }
        } else if (
          this.minutes(request.assignedAt, asOf) >
          thresholds.resourceReadySlaMinutes
        ) {
          readinessEvaluated += 1;
          breached = true;
        }
      } else if (
        this.minutes(request.requestedAt, asOf) > thresholds.assignmentSlaMinutes
      ) {
        assignmentEvaluated += 1;
        breached = true;
      }

      if (request.enRouteAt) {
        departureEvaluated += 1;
        if (
          Math.max(0, this.minutes(request.scheduledFor, request.enRouteAt)) <=
          thresholds.departureGraceMinutes
        ) {
          departureCompliant += 1;
        } else {
          breached = true;
        }
      } else if (
        asOf.getTime() >
        request.scheduledFor.getTime() + thresholds.departureGraceMinutes * 60_000
      ) {
        departureEvaluated += 1;
        breached = true;
      }

      if (breached) breachedRequests += 1;
    }

    const completed = requests.filter((row) => row.status === "COMPLETED").length;
    const cancelled = requests.filter((row) => row.status === "CANCELLED").length;
    const ground = requests.filter((row) => row.mode === "GROUND").length;
    const air = requests.filter((row) => row.mode === "AIR").length;

    return {
      requests: requests.length,
      completed,
      cancelled,
      completionRatePercent: this.rate(completed, requests.length),
      cancellationRatePercent: this.rate(cancelled, requests.length),
      ground,
      air,
      assignmentSlaCompliancePercent: this.rate(
        assignmentCompliant,
        assignmentEvaluated,
      ),
      resourceReadinessSlaCompliancePercent: this.rate(
        readinessCompliant,
        readinessEvaluated,
      ),
      departureSlaCompliancePercent: this.rate(
        departureCompliant,
        departureEvaluated,
      ),
      requestsWithAnySlaBreach: breachedRequests,
      slaBreachRatePercent: this.rate(breachedRequests, requests.length - cancelled),
      requestsWithCriticalIncidents: requests.filter((row) =>
        criticalIncidentIds.has(row.id),
      ).length,
      requestsWithActiveEscalations: requests.filter((row) =>
        activeEscalationIds.has(row.id),
      ).length,
    };
  }

  private delta(
    current: ReturnType<TransportExecutiveKpiService["periodMetrics"]>,
    previous: ReturnType<TransportExecutiveKpiService["periodMetrics"]>,
  ) {
    const keys = [
      "requests",
      "completed",
      "cancelled",
      "completionRatePercent",
      "cancellationRatePercent",
      "assignmentSlaCompliancePercent",
      "resourceReadinessSlaCompliancePercent",
      "departureSlaCompliancePercent",
      "requestsWithAnySlaBreach",
      "slaBreachRatePercent",
      "requestsWithCriticalIncidents",
      "requestsWithActiveEscalations",
    ] as const;
    return Object.fromEntries(
      keys.map((key) => [
        key,
        {
          current: current[key],
          previous: previous[key],
          absolute:
            current[key] == null || previous[key] == null
              ? null
              : Math.round((Number(current[key]) - Number(previous[key])) * 10) / 10,
        },
      ]),
    );
  }

  private trend(
    current: Array<any>,
    previous: Array<any>,
    firstReady: Map<string, { assignedAt: Date }>,
    thresholds: {
      assignmentSlaMinutes: number;
      resourceReadySlaMinutes: number;
      departureGraceMinutes: number;
    },
    currentStart: Date,
    previousStart: Date,
    now: Date,
    windowDays: number,
  ) {
    const bucketDays = windowDays <= 31 ? 1 : 7;
    const bucketMs = bucketDays * 86_400_000;
    const buckets = Math.ceil(windowDays / bucketDays);
    const rows = [];
    for (let index = 0; index < buckets; index += 1) {
      const currentFrom = new Date(currentStart.getTime() + index * bucketMs);
      const currentTo = new Date(Math.min(now.getTime(), currentFrom.getTime() + bucketMs));
      const previousFrom = new Date(previousStart.getTime() + index * bucketMs);
      const previousTo = new Date(Math.min(currentStart.getTime(), previousFrom.getTime() + bucketMs));
      const pick = (source: Array<any>, from: Date, to: Date) =>
        source.filter(
          (row) =>
            row.requestedAt.getTime() >= from.getTime() &&
            row.requestedAt.getTime() < to.getTime(),
        );
      const currentRows = pick(current, currentFrom, currentTo);
      const previousRows = pick(previous, previousFrom, previousTo);
      const breachCount = (source: Array<any>, asOf: Date) =>
        source.filter((request) => {
          if (request.status === "CANCELLED") return false;
          if (
            !request.assignedAt &&
            this.minutes(request.requestedAt, asOf) > thresholds.assignmentSlaMinutes
          ) {
            return true;
          }
          if (
            request.assignedAt &&
            this.minutes(request.requestedAt, request.assignedAt) >
              thresholds.assignmentSlaMinutes
          ) {
            return true;
          }
          const ready = firstReady.get(request.id);
          if (
            request.assignedAt &&
            ready &&
            this.minutes(request.assignedAt, ready.assignedAt) >
              thresholds.resourceReadySlaMinutes
          ) {
            return true;
          }
          if (
            request.enRouteAt &&
            Math.max(0, this.minutes(request.scheduledFor, request.enRouteAt)) >
              thresholds.departureGraceMinutes
          ) {
            return true;
          }
          return false;
        }).length;

      rows.push({
        bucket: index + 1,
        bucketDays,
        current: {
          from: currentFrom.toISOString(),
          to: currentTo.toISOString(),
          requests: currentRows.length,
          completed: currentRows.filter((row) => row.status === "COMPLETED").length,
          slaBreached: breachCount(currentRows, currentTo),
        },
        previous: {
          from: previousFrom.toISOString(),
          to: previousTo.toISOString(),
          requests: previousRows.length,
          completed: previousRows.filter((row) => row.status === "COMPLETED").length,
          slaBreached: breachCount(previousRows, previousTo),
        },
      });
    }
    return { bucketDays, items: rows };
  }

  private scheduleInput(
    body: ScheduleInput,
    existing:
      | {
          name: string;
          cadence: string;
          weekday: number | null;
          dayOfMonth: number | null;
          hourUtc: number;
          minuteUtc: number;
          windowDays: number;
          artifactRetentionDays: number;
          mode: string;
          sla: string;
          providerId: string | null;
          enabled: boolean;
        }
      | null,
  ) {
    const cadence = this.enumValue(
      body.cadence,
      ["DAILY", "WEEKLY", "MONTHLY"] as const,
      existing?.cadence ?? "WEEKLY",
      "cadence",
    );
    const weekday =
      cadence === "WEEKLY"
        ? this.integerUnknown(body.weekday, existing?.weekday ?? 1, 0, 6, "weekday")
        : null;
    const dayOfMonth =
      cadence === "MONTHLY"
        ? this.integerUnknown(
            body.dayOfMonth,
            existing?.dayOfMonth ?? 1,
            1,
            28,
            "dayOfMonth",
          )
        : null;
    return {
      name: this.text(body.name, existing?.name ?? "Transport Management Report", "name"),
      cadence,
      weekday,
      dayOfMonth,
      hourUtc: this.integerUnknown(body.hourUtc, existing?.hourUtc ?? 7, 0, 23, "hourUtc"),
      minuteUtc: this.integerUnknown(
        body.minuteUtc,
        existing?.minuteUtc ?? 0,
        0,
        59,
        "minuteUtc",
      ),
      windowDays: this.integerUnknown(
        body.windowDays,
        existing?.windowDays ?? 30,
        7,
        365,
        "windowDays",
      ),
      artifactRetentionDays: this.integerUnknown(
        body.artifactRetentionDays,
        existing?.artifactRetentionDays ?? 90,
        7,
        3650,
        "artifactRetentionDays",
      ),
      mode: this.enumValue(
        body.mode,
        ["ALL", "GROUND", "AIR"] as const,
        existing?.mode ?? "ALL",
        "mode",
      ),
      sla: this.enumValue(
        body.sla,
        ["ALL", "BREACHED", "COMPLIANT", "PENDING"] as const,
        existing?.sla ?? "ALL",
        "sla",
      ),
      providerId: this.optionalId(body.providerId, existing?.providerId ?? null),
      enabled:
        body.enabled === undefined
          ? existing?.enabled ?? true
          : this.boolean(body.enabled, "enabled"),
    };
  }

  private nextRun(
    input: {
      cadence: string;
      weekday: number | null;
      dayOfMonth: number | null;
      hourUtc: number;
      minuteUtc: number;
    },
    after: Date,
  ) {
    if (input.cadence === "DAILY") {
      const candidate = new Date(
        Date.UTC(
          after.getUTCFullYear(),
          after.getUTCMonth(),
          after.getUTCDate(),
          input.hourUtc,
          input.minuteUtc,
        ),
      );
      if (candidate.getTime() <= after.getTime()) {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
      }
      return candidate;
    }
    if (input.cadence === "WEEKLY") {
      const weekday = input.weekday ?? 1;
      const candidate = new Date(
        Date.UTC(
          after.getUTCFullYear(),
          after.getUTCMonth(),
          after.getUTCDate(),
          input.hourUtc,
          input.minuteUtc,
        ),
      );
      let addDays = (weekday - candidate.getUTCDay() + 7) % 7;
      if (addDays === 0 && candidate.getTime() <= after.getTime()) addDays = 7;
      candidate.setUTCDate(candidate.getUTCDate() + addDays);
      return candidate;
    }
    const day = input.dayOfMonth ?? 1;
    let candidate = new Date(
      Date.UTC(
        after.getUTCFullYear(),
        after.getUTCMonth(),
        day,
        input.hourUtc,
        input.minuteUtc,
      ),
    );
    if (candidate.getTime() <= after.getTime()) {
      candidate = new Date(
        Date.UTC(
          after.getUTCFullYear(),
          after.getUTCMonth() + 1,
          day,
          input.hourUtc,
          input.minuteUtc,
        ),
      );
    }
    return candidate;
  }

  private presentSchedule(row: any) {
    return {
      id: row.id,
      name: row.name,
      cadence: row.cadence,
      weekday: row.weekday,
      dayOfMonth: row.dayOfMonth,
      hourUtc: row.hourUtc,
      minuteUtc: row.minuteUtc,
      windowDays: row.windowDays,
      artifactRetentionDays: row.artifactRetentionDays,
      mode: row.mode,
      sla: row.sla,
      providerId: row.providerId,
      enabled: row.enabled,
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt,
      deliveryMode: row.deliveryMode,
      automaticDeliveryAvailable: false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private integerString(
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
    field: string,
  ) {
    if (raw == null || raw.trim() === "") return fallback;
    return this.integerUnknown(raw, fallback, min, max, field);
  }

  private integerUnknown(
    raw: unknown,
    fallback: number,
    min: number,
    max: number,
    field: string,
  ) {
    if (raw == null || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(
        field + " must be an integer between " + String(min) + " and " + String(max) + ".",
      );
    }
    return value;
  }

  private enumValue<T extends string>(
    raw: unknown,
    allowed: readonly T[],
    fallback: T,
    field: string,
  ): T {
    if (raw == null || raw === "") return fallback;
    if (typeof raw !== "string") throw new BadRequestException(field + " is invalid.");
    const value = raw.trim().toUpperCase() as T;
    if (!allowed.includes(value)) throw new BadRequestException(field + " is invalid.");
    return value;
  }

  private text(raw: unknown, fallback: string, field: string) {
    if (raw == null) return fallback;
    if (typeof raw !== "string") throw new BadRequestException(field + " must be text.");
    const value = raw.trim();
    if (!/^[\x20-\x7E]{1,120}$/.test(value)) {
      throw new BadRequestException(field + " must contain 1 to 120 printable characters.");
    }
    return value;
  }

  private optionalId(raw: unknown, fallback: string | null) {
    if (raw === undefined) return fallback;
    if (raw === null || raw === "") return null;
    if (typeof raw !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(raw.trim())) {
      throw new BadRequestException("providerId is invalid.");
    }
    return raw.trim();
  }

  private boolean(raw: unknown, field: string) {
    if (typeof raw !== "boolean") throw new BadRequestException(field + " must be boolean.");
    return raw;
  }

  private id(raw: string, field: string) {
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(raw.trim())) {
      throw new BadRequestException(field + " is invalid.");
    }
    return raw.trim();
  }

  private thresholds() {
    return {
      assignmentSlaMinutes: this.envInteger("TRANSPORT_ASSIGNMENT_SLA_MINUTES", 15),
      resourceReadySlaMinutes: this.envInteger(
        "TRANSPORT_RESOURCE_READY_SLA_MINUTES",
        10,
      ),
      departureGraceMinutes: this.envInteger("TRANSPORT_DEPARTURE_GRACE_MINUTES", 10),
    };
  }

  private envInteger(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= 1 && value <= 1440 ? value : fallback;
  }

  private minutes(from: Date, to: Date) {
    return Math.max(
      0,
      Math.round(((to.getTime() - from.getTime()) / 60_000) * 10) / 10,
    );
  }

  private rate(numerator: number, denominator: number) {
    return denominator <= 0
      ? null
      : Math.round((numerator / denominator) * 1000) / 10;
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportExecutiveKpiController {
  constructor(private readonly service: TransportExecutiveKpiService) {}

  @Get("executive-kpis")
  @Header("Cache-Control", "no-store")
  kpis(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("windowDays") windowDays?: string,
  ) {
    return this.service.kpis(principal, windowDays);
  }

  @Get("report-schedules")
  @Header("Cache-Control", "no-store")
  schedules(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.schedules(principal);
  }

  @Post("report-schedules")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: ScheduleInput,
  ) {
    return this.service.createSchedule(principal, body ?? {});
  }

  @Patch("report-schedules/:scheduleId")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("scheduleId") scheduleId: string,
    @Body() body: ScheduleInput,
  ) {
    return this.service.updateSchedule(principal, scheduleId, body ?? {});
  }

  @Post("report-schedules/:scheduleId/mark-run")
  markRun(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("scheduleId") scheduleId: string,
  ) {
    return this.service.markRun(principal, scheduleId);
  }
}

@Module({
  controllers: [TransportExecutiveKpiController],
  providers: [TransportExecutiveKpiService],
})
export class TransportExecutiveKpiModule {}
