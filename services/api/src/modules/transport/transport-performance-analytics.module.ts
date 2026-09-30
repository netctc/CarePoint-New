import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  jsonStringArray,
  missingCurrentCredentialTypes,
} from "../../security/provider-credential-validity";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";

type Mode = "GROUND" | "AIR";

@Injectable()
export class TransportPerformanceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async analytics(
    principal: AuthPrincipal,
    windowDaysRaw?: string,
    forecastDaysRaw?: string,
  ) {
    const now = new Date();
    const windowDays = this.boundedInteger(windowDaysRaw, 90, 7, 365, "windowDays");
    const forecastDays = this.boundedInteger(
      forecastDaysRaw,
      14,
      1,
      30,
      "forecastDays",
    );
    const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const forecastUntil = new Date(
      now.getTime() + forecastDays * 24 * 60 * 60 * 1000,
    );
    const capacityUntil = new Date(
      now.getTime() + Math.max(forecastDays, 7) * 24 * 60 * 60 * 1000,
    );
    const thresholds = this.thresholds();

    const [
      historical,
      historicalScheduled,
      future,
      activeCurrent,
      providers,
      units,
      escalations,
      incidents,
    ] = await Promise.all([
        this.prisma.medicalTransportRequest.findMany({
          where: { requestedAt: { gte: since, lt: now } },
          orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
          take: 20_000,
        }),
        this.prisma.medicalTransportRequest.findMany({
          where: { scheduledFor: { gte: since, lt: now } },
          select: {
            id: true,
            mode: true,
            scheduledFor: true,
          },
          orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
          take: 20_000,
        }),
        this.prisma.medicalTransportRequest.findMany({
          where: {
            scheduledFor: { gte: now, lt: capacityUntil },
            status: {
              in: ["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"],
            },
          },
          orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
          take: 10_000,
        }),
        this.prisma.medicalTransportRequest.findMany({
          where: {
            status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] },
          },
          select: {
            id: true,
            assignedProviderId: true,
            status: true,
          },
          take: 10_000,
        }),
        this.prisma.provider.findMany({
          where: {
            class: "OTHER_PROVIDER",
            otherProviderProfile: {
              category: {
                family: {
                  in: ["MEDICAL_TRANSPORT_GROUND", "MEDICAL_TRANSPORT_AIR"],
                },
              },
            },
          },
          include: {
            user: { select: { status: true } },
            credentials: true,
            otherProviderProfile: { include: { category: true } },
          },
          orderBy: [{ displayName: "asc" }, { id: "asc" }],
          take: 1000,
        }),
        this.prisma.transportUnit.findMany({
          where: { mode: { in: ["GROUND", "AIR"] } },
          orderBy: [{ mode: "asc" }, { providerId: "asc" }, { code: "asc" }],
          take: 10_000,
        }),
        this.prisma.transportOperationalEscalation.findMany({
          where: { firstTriggeredAt: { gte: since, lt: now } },
          orderBy: [{ firstTriggeredAt: "asc" }, { id: "asc" }],
          take: 20_000,
        }),
        this.prisma.transportIncident.findMany({
          where: { occurredAt: { gte: since, lt: now } },
          select: {
            id: true,
            transportRequestId: true,
            severity: true,
            occurredAt: true,
          },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          take: 20_000,
        }),
      ]);

    const historicalIds = historical.map((row) => row.id);
    const [assignments, routes] = await Promise.all([
      historicalIds.length
        ? this.prisma.crewAssignment.findMany({
            where: { transportRequestId: { in: historicalIds } },
            orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
            take: 30_000,
          })
        : [],
      historicalIds.length
        ? this.prisma.transportRouteRevision.findMany({
            where: {
              transportRequestId: { in: historicalIds },
              createdAt: { gte: since, lt: now },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 30_000,
          })
        : [],
    ]);

    const activeJobsByProvider = new Map<string, number>();
    for (const request of activeCurrent) {
      if (!request.assignedProviderId) continue;
      activeJobsByProvider.set(
        request.assignedProviderId,
        (activeJobsByProvider.get(request.assignedProviderId) ?? 0) + 1,
      );
    }

    const unitsByProvider = new Map<string, typeof units>();
    for (const unit of units) {
      const list = unitsByProvider.get(unit.providerId) ?? [];
      list.push(unit);
      unitsByProvider.set(unit.providerId, list);
    }

    const providerReadiness = providers.map((provider) => {
      const category = provider.otherProviderProfile?.category;
      const family = category?.family;
      const mode: Mode =
        family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND";
      const required = jsonStringArray(category?.requiredCredentialTypes);
      const usable = (provider.credentials ?? []).filter(
        (credential: { status?: string }) =>
          credential.status === "VALID" || credential.status === "VERIFIED",
      );
      const missing = missingCurrentCredentialTypes(required, usable);
      const activeUnits = (unitsByProvider.get(provider.id) ?? []).filter(
        (unit) => unit.active && unit.mode === mode,
      );
      const dispatchReady =
        provider.status === "ACTIVE" &&
        provider.user?.status === "ACTIVE" &&
        category?.active === true &&
        missing.length === 0 &&
        activeUnits.length > 0;
      return {
        id: provider.id,
        displayName: provider.displayName,
        mode,
        dispatchReady,
        activeUnitCount: activeUnits.length,
        activeJobs: activeJobsByProvider.get(provider.id) ?? 0,
      };
    });

    const firstReadyAssignmentByRequest = new Map<
      string,
      (typeof assignments)[number]
    >();
    for (const assignment of assignments) {
      if (
        assignment.transportUnitId &&
        assignment.crewProviderIds.length > 0 &&
        !firstReadyAssignmentByRequest.has(assignment.transportRequestId)
      ) {
        firstReadyAssignmentByRequest.set(
          assignment.transportRequestId,
          assignment,
        );
      }
    }

    const incidentsByRequest = new Map<string, typeof incidents>();
    for (const incident of incidents) {
      const list = incidentsByRequest.get(incident.transportRequestId) ?? [];
      list.push(incident);
      incidentsByRequest.set(incident.transportRequestId, list);
    }

    const escalationsByRequest = new Map<string, typeof escalations>();
    for (const escalation of escalations) {
      const list =
        escalationsByRequest.get(escalation.transportRequestId) ?? [];
      list.push(escalation);
      escalationsByRequest.set(escalation.transportRequestId, list);
    }

    const routesByRequest = new Map<string, typeof routes>();
    for (const route of routes) {
      const list = routesByRequest.get(route.transportRequestId) ?? [];
      list.push(route);
      routesByRequest.set(route.transportRequestId, list);
    }

    const assignmentMinutes: number[] = [];
    const resourceReadyMinutes: number[] = [];
    const departureDelayMinutes: number[] = [];
    const totalCompletionMinutes: number[] = [];
    const transportMinutes: number[] = [];
    let assignmentEvaluated = 0;
    let assignmentPendingWithinSla = 0;
    let assignmentWithinSla = 0;
    let assignmentBreached = 0;
    let resourceReadyEvaluated = 0;
    let resourceReadyWithinSla = 0;
    let resourceReadyBreached = 0;
    let departureEvaluated = 0;
    let departurePendingWithinGrace = 0;
    let departureWithinSla = 0;
    let departureBreached = 0;
    let etaGroundAssigned = 0;
    let etaGroundPresent = 0;

    for (const request of historical) {
      if (request.status !== "CANCELLED") {
        if (request.assignedAt) {
          assignmentEvaluated += 1;
          const minutes = this.minutes(request.requestedAt, request.assignedAt);
          assignmentMinutes.push(minutes);
          if (minutes <= thresholds.assignmentSlaMinutes) assignmentWithinSla += 1;
          else assignmentBreached += 1;
        } else {
          const elapsed = this.minutes(request.requestedAt, now);
          if (elapsed > thresholds.assignmentSlaMinutes) {
            assignmentEvaluated += 1;
            assignmentBreached += 1;
          } else {
            assignmentPendingWithinSla += 1;
          }
        }
      }

      if (request.assignedAt && request.status !== "CANCELLED") {
        const ready = firstReadyAssignmentByRequest.get(request.id);
        if (ready) {
          resourceReadyEvaluated += 1;
          const minutes = this.minutes(request.assignedAt, ready.assignedAt);
          resourceReadyMinutes.push(minutes);
          if (minutes <= thresholds.resourceReadySlaMinutes) {
            resourceReadyWithinSla += 1;
          } else {
            resourceReadyBreached += 1;
          }
        } else if (
          this.minutes(request.assignedAt, now) > thresholds.resourceReadySlaMinutes
        ) {
          resourceReadyEvaluated += 1;
          resourceReadyBreached += 1;
        }
      }

      if (request.status !== "CANCELLED") {
        if (request.enRouteAt) {
          departureEvaluated += 1;
          const delayMinutes = Math.max(
            0,
            this.minutes(request.scheduledFor, request.enRouteAt),
          );
          departureDelayMinutes.push(delayMinutes);
          if (delayMinutes <= thresholds.departureGraceMinutes) {
            departureWithinSla += 1;
          } else {
            departureBreached += 1;
          }
        } else {
          const overdue = this.minutes(request.scheduledFor, now);
          if (now.getTime() > request.scheduledFor.getTime() + thresholds.departureGraceMinutes * 60_000) {
            departureEvaluated += 1;
            departureBreached += 1;
          } else if (request.scheduledFor.getTime() <= now.getTime()) {
            departurePendingWithinGrace += 1;
          }
        }
      }

      if (request.completedAt) {
        totalCompletionMinutes.push(
          this.minutes(request.requestedAt, request.completedAt),
        );
        if (request.transportingAt) {
          transportMinutes.push(
            this.minutes(request.transportingAt, request.completedAt),
          );
        }
      }

      if (request.mode === "GROUND" && request.assignedProviderId) {
        etaGroundAssigned += 1;
        if (request.etaMinutes != null || (routesByRequest.get(request.id) ?? []).length > 0) {
          etaGroundPresent += 1;
        }
      }
    }

    const escalationAckMinutes = escalations
      .filter((row) => row.acknowledgedAt)
      .map((row) => this.minutes(row.firstTriggeredAt, row.acknowledgedAt!));
    const escalationResolutionMinutes = escalations
      .filter((row) => row.resolvedAt)
      .map((row) => this.minutes(row.firstTriggeredAt, row.resolvedAt!));

    const historicalByProvider = new Map<string, typeof historical>();
    for (const request of historical) {
      if (!request.assignedProviderId) continue;
      const list = historicalByProvider.get(request.assignedProviderId) ?? [];
      list.push(request);
      historicalByProvider.set(request.assignedProviderId, list);
    }

    const providerPerformance = providers
      .map((provider) => {
        const requests = historicalByProvider.get(provider.id) ?? [];
        if (requests.length === 0) return null;
        const completed = requests.filter((row) => row.status === "COMPLETED");
        const cancelled = requests.filter((row) => row.status === "CANCELLED");
        const departures = requests.filter((row) => row.enRouteAt);
        const onTime = departures.filter(
          (row) =>
            Math.max(0, this.minutes(row.scheduledFor, row.enRouteAt!)) <=
            thresholds.departureGraceMinutes,
        );
        const providerIncidents = requests.reduce(
          (sum, row) => sum + (incidentsByRequest.get(row.id) ?? []).length,
          0,
        );
        const providerEscalations = requests.reduce(
          (sum, row) => sum + (escalationsByRequest.get(row.id) ?? []).length,
          0,
        );
        const durations = completed
          .filter((row) => row.transportingAt && row.completedAt)
          .map((row) => this.minutes(row.transportingAt!, row.completedAt!));
        const readiness = providerReadiness.find((row) => row.id === provider.id);
        return {
          providerId: provider.id,
          displayName: provider.displayName,
          mode: readiness?.mode ?? "GROUND",
          dispatchReadyNow: readiness?.dispatchReady ?? false,
          requests: requests.length,
          completed: completed.length,
          cancelled: cancelled.length,
          completionRatePercent: this.rate(completed.length, requests.length),
          measurableDepartures: departures.length,
          onTimeDepartureRatePercent: this.rate(onTime.length, departures.length),
          transportDurationMinutes: this.distribution(durations),
          incidents: providerIncidents,
          escalations: providerEscalations,
          activeJobs: readiness?.activeJobs ?? 0,
          activeUnitCount: readiness?.activeUnitCount ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort(
        (a, b) =>
          b.requests - a.requests ||
          a.displayName.localeCompare(b.displayName),
      );

    const daily = this.dailySeries(historical, since, now);
    const capacity = this.capacitySnapshot(
      future,
      providerReadiness,
      units,
      now,
    );
    const forecast = this.forecast(
      historicalScheduled,
      future,
      units,
      since,
      now,
      forecastDays,
    );

    const payload = {
      generatedAt: now.toISOString(),
      method: {
        analyticsWindowDays: windowDays,
        forecastDays,
        forecastMethod: "SAME_WEEKDAY_HISTORICAL_AVERAGE",
        machineLearning: false,
        capacityGuarantee: false,
        providerRanking: false,
      },
      thresholds,
      summary: {
        historicalRequests: historical.length,
        completed: historical.filter((row) => row.status === "COMPLETED").length,
        cancelled: historical.filter((row) => row.status === "CANCELLED").length,
        currentDispatchReadyProviders: providerReadiness.filter(
          (row) => row.dispatchReady,
        ).length,
        currentActiveUnits: units.filter((row) => row.active).length,
        upcomingScheduledRequests: future.filter(
          (row) => row.scheduledFor.getTime() < forecastUntil.getTime(),
        ).length,
      },
      sla: {
        assignment: {
          evaluated: assignmentEvaluated,
          pendingWithinSla: assignmentPendingWithinSla,
          measurableAssigned: assignmentMinutes.length,
          withinSla: assignmentWithinSla,
          breached: assignmentBreached,
          compliancePercent: this.rate(
            assignmentWithinSla,
            assignmentEvaluated,
          ),
          minutes: this.distribution(assignmentMinutes),
        },
        resourceReadiness: {
          evaluated: resourceReadyEvaluated,
          measurableReady: resourceReadyMinutes.length,
          withinSla: resourceReadyWithinSla,
          breached: resourceReadyBreached,
          compliancePercent: this.rate(
            resourceReadyWithinSla,
            resourceReadyEvaluated,
          ),
          minutes: this.distribution(resourceReadyMinutes),
        },
        departure: {
          evaluated: departureEvaluated,
          pendingWithinGrace: departurePendingWithinGrace,
          measurableDepartures: departureDelayMinutes.length,
          withinGrace: departureWithinSla,
          breached: departureBreached,
          compliancePercent: this.rate(
            departureWithinSla,
            departureEvaluated,
          ),
          delayMinutes: this.distribution(departureDelayMinutes),
        },
        etaCoverage: {
          eligibleGroundAssigned: etaGroundAssigned,
          withEtaEvidence: etaGroundPresent,
          coveragePercent: this.rate(etaGroundPresent, etaGroundAssigned),
        },
      },
      lifecycle: {
        requestToCompletionMinutes: this.distribution(totalCompletionMinutes),
        transportingToCompletionMinutes: this.distribution(transportMinutes),
      },
      escalations: {
        total: escalations.length,
        open: escalations.filter((row) => row.status === "OPEN").length,
        acknowledged: escalations.filter((row) => row.status === "ACKNOWLEDGED")
          .length,
        resolved: escalations.filter((row) => row.status === "RESOLVED").length,
        autoResolved: escalations.filter((row) => row.autoResolved).length,
        acknowledgementMinutes: this.distribution(escalationAckMinutes),
        resolutionMinutes: this.distribution(escalationResolutionMinutes),
      },
      incidents: {
        total: incidents.length,
        warning: incidents.filter((row) => row.severity === "WARNING").length,
        critical: incidents.filter((row) => row.severity === "CRITICAL").length,
      },
      capacity,
      forecast,
      providerPerformance,
      daily,
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_PERFORMANCE_ANALYTICS_READ",
      objectType: "TRANSPORT_PERFORMANCE_ANALYTICS",
      objectId: `${windowDays}D_${forecastDays}D`,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        analyticsWindowDays: windowDays,
        forecastDays,
        historicalRequests: historical.length,
        upcomingScheduledRequests: future.filter(
          (row) => row.scheduledFor.getTime() < forecastUntil.getTime(),
        ).length,
        forecastMethod: "SAME_WEEKDAY_HISTORICAL_AVERAGE",
        machineLearning: false,
        capacityGuarantee: false,
      },
    });

    return payload;
  }

  private capacitySnapshot(
    future: any[],
    providers: Array<{
      mode: Mode;
      dispatchReady: boolean;
      activeUnitCount: number;
      activeJobs: number;
    }>,
    units: any[],
    now: Date,
  ) {
    const windowEnd = (hours: number) =>
      new Date(now.getTime() + hours * 60 * 60 * 1000);
    const countWindow = (mode: Mode, hours: number) =>
      future.filter(
        (row) =>
          row.mode === mode &&
          row.scheduledFor.getTime() < windowEnd(hours).getTime(),
      ).length;

    const mode = (value: Mode) => {
      const activeUnits = units.filter(
        (row) => row.active && row.mode === value,
      ).length;
      const readyProviders = providers.filter(
        (row) => row.mode === value && row.dispatchReady,
      );
      const activeJobs = providers
        .filter((row) => row.mode === value)
        .reduce((sum, row) => sum + row.activeJobs, 0);
      return {
        activeUnits,
        dispatchReadyProviders: readyProviders.length,
        activeJobs,
        upcoming24h: countWindow(value, 24),
        upcoming72h: countWindow(value, 72),
        upcoming7d: countWindow(value, 168),
        upcoming24hPerActiveUnit: this.ratio(
          countWindow(value, 24),
          activeUnits,
        ),
        upcoming72hPerActiveUnit: this.ratio(
          countWindow(value, 72),
          activeUnits,
        ),
        note:
          "Requests per active unit is a planning load proxy; one unit may serve multiple trips and this is not a capacity guarantee.",
      };
    };

    return {
      ground: mode("GROUND"),
      air: mode("AIR"),
    };
  }

  private forecast(
    historicalScheduled: Array<{
      id: string;
      mode: Mode;
      scheduledFor: Date;
    }>,
    future: any[],
    units: any[],
    since: Date,
    now: Date,
    forecastDays: number,
  ) {
    const historyByModeWeekday = new Map<string, number[]>();
    for (const mode of ["GROUND", "AIR"] as const) {
      for (let weekday = 0; weekday < 7; weekday += 1) {
        historyByModeWeekday.set(`${mode}:${weekday}`, []);
      }
    }

    const historicalDaily = new Map<string, { GROUND: number; AIR: number }>();
    for (const request of historicalScheduled) {
      const date = this.dateKey(request.scheduledFor);
      const row = historicalDaily.get(date) ?? { GROUND: 0, AIR: 0 };
      row[request.mode as Mode] += 1;
      historicalDaily.set(date, row);
    }

    const historicalDates = this.dateRange(
      since,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
    );
    for (const date of historicalDates) {
      const row = historicalDaily.get(this.dateKey(date)) ?? {
        GROUND: 0,
        AIR: 0,
      };
      for (const mode of ["GROUND", "AIR"] as const) {
        historyByModeWeekday
          .get(`${mode}:${date.getUTCDay()}`)!
          .push(row[mode]);
      }
    }

    const activeUnits = {
      GROUND: units.filter((row) => row.active && row.mode === "GROUND").length,
      AIR: units.filter((row) => row.active && row.mode === "AIR").length,
    };

    const days = [];
    for (let offset = 0; offset < forecastDays; offset += 1) {
      const dayStart = this.startOfUtcDay(
        new Date(now.getTime() + offset * 24 * 60 * 60 * 1000),
      );
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const byMode = (mode: Mode) => {
        const samples =
          historyByModeWeekday.get(`${mode}:${dayStart.getUTCDay()}`) ?? [];
        const expected = this.average(samples);
        const booked = future.filter(
          (row) =>
            row.mode === mode &&
            row.scheduledFor.getTime() >= dayStart.getTime() &&
            row.scheduledFor.getTime() < dayEnd.getTime(),
        ).length;
        const unitsCount = activeUnits[mode];
        return {
          historicalWeekdayAverage: expected,
          booked,
          bookedVsHistoricalAveragePercent:
            expected <= 0
              ? booked > 0
                ? null
                : 0
              : Math.round(((booked - expected) / expected) * 100),
          historicalAveragePerActiveUnit: this.ratio(expected, unitsCount),
          bookedPerActiveUnit: this.ratio(booked, unitsCount),
          planningSignal: this.planningSignal(
            booked,
            expected,
            unitsCount,
          ),
        };
      };
      days.push({
        date: this.dateKey(dayStart),
        weekday: dayStart.toLocaleDateString("en-US", {
          timeZone: "UTC",
          weekday: "long",
        }),
        ground: byMode("GROUND"),
        air: byMode("AIR"),
      });
    }

    return {
      method: "SAME_WEEKDAY_HISTORICAL_AVERAGE",
      machineLearning: false,
      capacityGuarantee: false,
      days,
    };
  }

  private planningSignal(
    booked: number,
    expected: number,
    activeUnits: number,
  ) {
    if (activeUnits === 0 && (booked > 0 || expected > 0)) {
      return "NO_ACTIVE_UNITS";
    }
    if (expected >= 1 && booked > expected * 1.25) {
      return "BOOKED_ABOVE_HISTORICAL_WEEKDAY_AVERAGE";
    }
    if (expected > 0 && booked >= expected) {
      return "BOOKED_NEAR_OR_ABOVE_HISTORICAL_AVERAGE";
    }
    return "WITHIN_HISTORICAL_RANGE";
  }

  private dailySeries(historical: any[], since: Date, now: Date) {
    const rows = new Map<
      string,
      {
        date: string;
        ground: number;
        air: number;
        completed: number;
        cancelled: number;
      }
    >();
    for (const date of this.dateRange(since, now)) {
      const key = this.dateKey(date);
      rows.set(key, {
        date: key,
        ground: 0,
        air: 0,
        completed: 0,
        cancelled: 0,
      });
    }
    for (const request of historical) {
      const key = this.dateKey(request.requestedAt);
      const row = rows.get(key);
      if (!row) continue;
      if (request.mode === "GROUND") row.ground += 1;
      if (request.mode === "AIR") row.air += 1;
      if (request.status === "COMPLETED") row.completed += 1;
      if (request.status === "CANCELLED") row.cancelled += 1;
    }
    return [...rows.values()];
  }

  private distribution(values: number[]) {
    const sorted = values
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    return {
      count: sorted.length,
      average: this.average(sorted),
      p50: this.percentile(sorted, 0.5),
      p90: this.percentile(sorted, 0.9),
      max: sorted.length ? sorted[sorted.length - 1] : null,
    };
  }

  private percentile(sorted: number[], fraction: number) {
    if (!sorted.length) return null;
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * fraction) - 1),
    );
    return sorted[index];
  }

  private average(values: number[]) {
    if (!values.length) return 0;
    return Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10;
  }

  private rate(numerator: number, denominator: number) {
    return denominator <= 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
  }

  private ratio(numerator: number, denominator: number) {
    if (denominator <= 0) return numerator > 0 ? null : 0;
    return Math.round((numerator / denominator) * 100) / 100;
  }

  private minutes(from: Date, to: Date) {
    return Math.max(
      0,
      Math.round(((to.getTime() - from.getTime()) / 60_000) * 10) / 10,
    );
  }

  private thresholds() {
    return {
      assignmentSlaMinutes: this.envInteger(
        "TRANSPORT_ASSIGNMENT_SLA_MINUTES",
        15,
        1,
        1440,
      ),
      resourceReadySlaMinutes: this.envInteger(
        "TRANSPORT_RESOURCE_READY_SLA_MINUTES",
        10,
        1,
        1440,
      ),
      departureGraceMinutes: this.envInteger(
        "TRANSPORT_DEPARTURE_GRACE_MINUTES",
        10,
        1,
        1440,
      ),
    };
  }

  private boundedInteger(
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
    field: string,
  ) {
    if (raw == null || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(
        `${field} must be an integer between ${min} and ${max}.`,
      );
    }
    return value;
  }

  private envInteger(name: string, fallback: number, min: number, max: number) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= min && value <= max
      ? value
      : fallback;
  }

  private dateRange(from: Date, to: Date) {
    const rows: Date[] = [];
    let cursor = this.startOfUtcDay(from);
    const end = this.startOfUtcDay(to);
    while (cursor.getTime() <= end.getTime()) {
      rows.push(cursor);
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return rows;
  }

  private startOfUtcDay(value: Date) {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
      ),
    );
  }

  private dateKey(value: Date) {
    return this.startOfUtcDay(value).toISOString().slice(0, 10);
  }
}

@Controller("admin/transport/performance-analytics")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportPerformanceAnalyticsController {
  constructor(private readonly analytics: TransportPerformanceAnalyticsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  read(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("windowDays") windowDays?: string,
    @Query("forecastDays") forecastDays?: string,
  ) {
    return this.analytics.analytics(principal, windowDays, forecastDays);
  }
}

@Module({
  controllers: [TransportPerformanceAnalyticsController],
  providers: [TransportPerformanceAnalyticsService],
})
export class TransportPerformanceAnalyticsModule {}
