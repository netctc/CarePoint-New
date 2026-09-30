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
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";

type ModeFilter = "ALL" | "GROUND" | "AIR";
type SlaFilter = "ALL" | "BREACHED" | "COMPLIANT" | "PENDING";
type SlaState = "BREACHED" | "COMPLIANT" | "PENDING" | "NOT_APPLICABLE";

type QueryInput = {
  windowDays?: string | undefined;
  mode?: string | undefined;
  providerId?: string | undefined;
  sla?: string | undefined;
  page?: string | undefined;
  limit?: string | undefined;
};

@Injectable()
export class TransportCommandCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async overview(principal: AuthPrincipal, query: QueryInput) {
    const options = this.options(query, true);
    const built = await this.build(options);
    const pageStart = (options.page - 1) * options.limit;
    const pageItems = built.items.slice(pageStart, pageStart + options.limit);

    const payload = {
      generatedAt: built.generatedAt,
      filters: {
        windowDays: options.windowDays,
        mode: options.mode,
        providerId: options.providerId,
        sla: options.sla,
        page: options.page,
        limit: options.limit,
        providers: built.providers,
      },
      summary: built.summary,
      pagination: {
        page: options.page,
        limit: options.limit,
        total: built.items.length,
        totalPages: Math.max(1, Math.ceil(built.items.length / options.limit)),
        truncatedSource: built.truncatedSource,
      },
      sensitiveDataPolicy: this.sensitiveDataPolicy(),
      items: pageItems,
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_COMMAND_CENTER_READ",
      objectType: "TRANSPORT_COMMAND_CENTER",
      objectId: String(options.windowDays) + "D",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        windowDays: options.windowDays,
        mode: options.mode,
        sla: options.sla,
        providerFilterApplied: Boolean(options.providerId),
        resultCount: built.items.length,
        pageResultCount: pageItems.length,
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
      },
    });

    return payload;
  }

  async managementReport(principal: AuthPrincipal, query: QueryInput) {
    const options = this.options(query, false);
    const built = await this.build(options);
    const filename =
      "carepoint-transport-management-" +
      built.generatedAt.slice(0, 10) +
      "-" +
      String(options.windowDays) +
      "d.csv";

    const columns = [
      "requestId",
      "mode",
      "status",
      "providerId",
      "providerName",
      "requestedAt",
      "scheduledFor",
      "assignedAt",
      "enRouteAt",
      "completedAt",
      "overallSlaState",
      "assignmentSlaState",
      "assignmentMinutes",
      "resourceReadinessSlaState",
      "resourceReadinessMinutes",
      "departureSlaState",
      "departureDelayMinutes",
      "etaEvidence",
      "warningIncidents",
      "criticalIncidents",
      "escalations",
      "openEscalations",
    ] as const;

    const rows = built.items.map((item) => ({
      requestId: item.requestId,
      mode: item.mode,
      status: item.status,
      providerId: item.provider?.id ?? "",
      providerName: item.provider?.displayName ?? "",
      requestedAt: item.requestedAt,
      scheduledFor: item.scheduledFor,
      assignedAt: item.assignedAt ?? "",
      enRouteAt: item.enRouteAt ?? "",
      completedAt: item.completedAt ?? "",
      overallSlaState: item.sla.overall,
      assignmentSlaState: item.sla.assignment.state,
      assignmentMinutes: item.sla.assignment.minutes ?? "",
      resourceReadinessSlaState: item.sla.resourceReadiness.state,
      resourceReadinessMinutes: item.sla.resourceReadiness.minutes ?? "",
      departureSlaState: item.sla.departure.state,
      departureDelayMinutes: item.sla.departure.minutes ?? "",
      etaEvidence:
        item.mode === "GROUND" ? (item.etaEvidence ? "YES" : "NO") : "N/A",
      warningIncidents: item.incidents.warning,
      criticalIncidents: item.incidents.critical,
      escalations: item.escalations.total,
      openEscalations: item.escalations.open,
    }));

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_MANAGEMENT_REPORT_EXPORTED",
      objectType: "TRANSPORT_MANAGEMENT_REPORT",
      objectId: String(options.windowDays) + "D",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        format: "CSV_CLIENT_RENDERED",
        rowCount: rows.length,
        columns: columns.length,
        windowDays: options.windowDays,
        mode: options.mode,
        sla: options.sla,
        providerFilterApplied: Boolean(options.providerId),
        truncatedSource: built.truncatedSource,
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
      },
    });

    return {
      generatedAt: built.generatedAt,
      filename,
      format: "CSV_CLIENT_RENDERED",
      columns,
      rows,
      summary: built.summary,
      truncatedSource: built.truncatedSource,
      sensitiveDataPolicy: this.sensitiveDataPolicy(),
    };
  }

  private async build(options: {
    windowDays: number;
    mode: ModeFilter;
    providerId: string | null;
    sla: SlaFilter;
    page: number;
    limit: number;
  }) {
    const now = new Date();
    const since = new Date(
      now.getTime() - options.windowDays * 24 * 60 * 60 * 1000,
    );
    const thresholds = this.thresholds();
    const where: any = {
      requestedAt: { gte: since, lt: now },
      ...(options.mode !== "ALL" ? { mode: options.mode } : {}),
      ...(options.providerId
        ? { assignedProviderId: options.providerId }
        : {}),
    };

    const SOURCE_LIMIT = 5000;
    const requests = await this.prisma.medicalTransportRequest.findMany({
      where,
      select: {
        id: true,
        mode: true,
        status: true,
        requestedAt: true,
        scheduledFor: true,
        assignedProviderId: true,
        assignedAt: true,
        enRouteAt: true,
        arrivedAt: true,
        transportingAt: true,
        completedAt: true,
        cancelledAt: true,
        etaMinutes: true,
      },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: SOURCE_LIMIT + 1,
    });
    const truncatedSource = requests.length > SOURCE_LIMIT;
    const source = requests.slice(0, SOURCE_LIMIT);
    const requestIds = source.map((row) => row.id);
    const providerIds = [
      ...new Set(
        source
          .map((row) => row.assignedProviderId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    const [
      providers,
      filterProviders,
      assignments,
      routes,
      incidents,
      escalations,
    ] = await Promise.all([
        providerIds.length
          ? this.prisma.provider.findMany({
              where: { id: { in: providerIds } },
              select: { id: true, displayName: true },
              orderBy: [{ displayName: "asc" }, { id: "asc" }],
              take: 2000,
            })
          : [],
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
          select: { id: true, displayName: true },
          orderBy: [{ displayName: "asc" }, { id: "asc" }],
          take: 2000,
        }),
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
              take: 20_000,
            })
          : [],
        requestIds.length
          ? this.prisma.transportRouteRevision.findMany({
              where: { transportRequestId: { in: requestIds } },
              select: { id: true, transportRequestId: true },
              take: 20_000,
            })
          : [],
        requestIds.length
          ? this.prisma.transportIncident.findMany({
              where: { transportRequestId: { in: requestIds } },
              select: {
                id: true,
                transportRequestId: true,
                severity: true,
              },
              take: 20_000,
            })
          : [],
        requestIds.length
          ? this.prisma.transportOperationalEscalation.findMany({
              where: { transportRequestId: { in: requestIds } },
              select: {
                id: true,
                transportRequestId: true,
                status: true,
                severity: true,
              },
              take: 20_000,
            })
          : [],
      ]);

    const providerById = new Map(providers.map((row) => [row.id, row]));
    const firstReadyAssignment = new Map<
      string,
      (typeof assignments)[number]
    >();
    for (const row of assignments) {
      if (
        row.transportUnitId &&
        row.crewProviderIds.length > 0 &&
        !firstReadyAssignment.has(row.transportRequestId)
      ) {
        firstReadyAssignment.set(row.transportRequestId, row);
      }
    }
    const routeRequestIds = new Set(
      routes.map((row) => row.transportRequestId),
    );
    const incidentsByRequest = this.groupByRequest(incidents);
    const escalationsByRequest = this.groupByRequest(escalations);

    const items = source
      .map((request) => {
        const assignment = this.assignmentSla(
          request,
          now,
          thresholds.assignmentSlaMinutes,
        );
        const readiness = this.resourceReadinessSla(
          request,
          firstReadyAssignment.get(request.id),
          now,
          thresholds.resourceReadySlaMinutes,
        );
        const departure = this.departureSla(
          request,
          now,
          thresholds.departureGraceMinutes,
        );
        const requestIncidents = incidentsByRequest.get(request.id) ?? [];
        const requestEscalations = escalationsByRequest.get(request.id) ?? [];
        const provider = request.assignedProviderId
          ? providerById.get(request.assignedProviderId)
          : undefined;
        const metrics = [assignment, readiness, departure];
        const breachCount = metrics.filter(
          (row) => row.state === "BREACHED",
        ).length;
        const pendingCount = metrics.filter(
          (row) => row.state === "PENDING",
        ).length;
        const applicableCount = metrics.filter(
          (row) => row.state !== "NOT_APPLICABLE",
        ).length;

        return {
          requestId: request.id,
          mode: request.mode,
          status: request.status,
          requestedAt: request.requestedAt.toISOString(),
          scheduledFor: request.scheduledFor.toISOString(),
          assignedAt: request.assignedAt?.toISOString() ?? null,
          enRouteAt: request.enRouteAt?.toISOString() ?? null,
          arrivedAt: request.arrivedAt?.toISOString() ?? null,
          transportingAt: request.transportingAt?.toISOString() ?? null,
          completedAt: request.completedAt?.toISOString() ?? null,
          cancelledAt: request.cancelledAt?.toISOString() ?? null,
          provider: provider
            ? { id: provider.id, displayName: provider.displayName }
            : null,
          sla: {
            assignment,
            resourceReadiness: readiness,
            departure,
            breachCount,
            pendingCount,
            overall:
              applicableCount === 0
                ? "NOT_APPLICABLE"
                : breachCount > 0
                  ? "BREACHED"
                  : pendingCount > 0
                    ? "PENDING"
                    : "COMPLIANT",
          },
          etaEvidence:
            request.mode === "GROUND" &&
            Boolean(
              request.etaMinutes != null || routeRequestIds.has(request.id),
            ),
          incidents: {
            total: requestIncidents.length,
            warning: requestIncidents.filter(
              (row) => row.severity === "WARNING",
            ).length,
            critical: requestIncidents.filter(
              (row) => row.severity === "CRITICAL",
            ).length,
          },
          escalations: {
            total: requestEscalations.length,
            open: requestEscalations.filter((row) => row.status === "OPEN")
              .length,
            acknowledged: requestEscalations.filter(
              (row) => row.status === "ACKNOWLEDGED",
            ).length,
            resolved: requestEscalations.filter(
              (row) => row.status === "RESOLVED",
            ).length,
            critical: requestEscalations.filter(
              (row) => row.severity === "CRITICAL",
            ).length,
          },
        };
      })
      .filter((row) => this.matchesSla(row.sla.overall, options.sla));

    const providersForFilter = filterProviders;

    return {
      generatedAt: now.toISOString(),
      providers: providersForFilter,
      truncatedSource,
      summary: {
        requests: items.length,
        completed: items.filter((row) => row.status === "COMPLETED").length,
        cancelled: items.filter((row) => row.status === "CANCELLED").length,
        active: items.filter((row) =>
          [
            "REQUESTED",
            "ASSIGNED",
            "EN_ROUTE",
            "ARRIVED",
            "TRANSPORTING",
          ].includes(row.status),
        ).length,
        slaBreached: items.filter((row) => row.sla.overall === "BREACHED")
          .length,
        slaPending: items.filter((row) => row.sla.overall === "PENDING")
          .length,
        slaCompliant: items.filter(
          (row) => row.sla.overall === "COMPLIANT",
        ).length,
        slaNotApplicable: items.filter(
          (row) => row.sla.overall === "NOT_APPLICABLE",
        ).length,
        requestsWithCriticalIncidents: items.filter(
          (row) => row.incidents.critical > 0,
        ).length,
        requestsWithOpenEscalations: items.filter(
          (row) => row.escalations.open + row.escalations.acknowledged > 0,
        ).length,
        distinctProviders: new Set(
          items
            .map((row) => row.provider?.id)
            .filter((value): value is string => Boolean(value)),
        ).size,
      },
      items,
    };
  }

  private assignmentSla(
    request: {
      status: string;
      requestedAt: Date;
      assignedAt: Date | null;
    },
    now: Date,
    threshold: number,
  ) {
    if (request.status === "CANCELLED") {
      return this.metric("NOT_APPLICABLE", null, threshold);
    }
    if (request.assignedAt) {
      const minutes = this.minutes(request.requestedAt, request.assignedAt);
      return this.metric(
        minutes <= threshold ? "COMPLIANT" : "BREACHED",
        minutes,
        threshold,
      );
    }
    const minutes = this.minutes(request.requestedAt, now);
    return this.metric(
      minutes > threshold ? "BREACHED" : "PENDING",
      minutes,
      threshold,
    );
  }

  private resourceReadinessSla(
    request: {
      status: string;
      assignedAt: Date | null;
    },
    ready:
      | {
          assignedAt: Date;
        }
      | undefined,
    now: Date,
    threshold: number,
  ) {
    if (!request.assignedAt || request.status === "CANCELLED") {
      return this.metric("NOT_APPLICABLE", null, threshold);
    }
    if (ready) {
      const minutes = this.minutes(request.assignedAt, ready.assignedAt);
      return this.metric(
        minutes <= threshold ? "COMPLIANT" : "BREACHED",
        minutes,
        threshold,
      );
    }
    const minutes = this.minutes(request.assignedAt, now);
    return this.metric(
      minutes > threshold ? "BREACHED" : "PENDING",
      minutes,
      threshold,
    );
  }

  private departureSla(
    request: {
      status: string;
      scheduledFor: Date;
      enRouteAt: Date | null;
    },
    now: Date,
    threshold: number,
  ) {
    if (request.status === "CANCELLED" && !request.enRouteAt) {
      return this.metric("NOT_APPLICABLE", null, threshold);
    }
    if (request.enRouteAt) {
      const minutes = Math.max(
        0,
        this.minutes(request.scheduledFor, request.enRouteAt),
      );
      return this.metric(
        minutes <= threshold ? "COMPLIANT" : "BREACHED",
        minutes,
        threshold,
      );
    }
    if (request.scheduledFor.getTime() > now.getTime()) {
      return this.metric("PENDING", 0, threshold);
    }
    const minutes = this.minutes(request.scheduledFor, now);
    return this.metric(
      minutes > threshold ? "BREACHED" : "PENDING",
      minutes,
      threshold,
    );
  }

  private metric(state: SlaState, minutes: number | null, threshold: number) {
    return {
      state,
      minutes,
      thresholdMinutes: threshold,
    };
  }

  private matchesSla(overall: string, filter: SlaFilter) {
    if (filter === "ALL") return true;
    return overall === filter;
  }

  private groupByRequest<T extends { transportRequestId: string }>(rows: T[]) {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.transportRequestId) ?? [];
      list.push(row);
      map.set(row.transportRequestId, list);
    }
    return map;
  }

  private options(query: QueryInput, paginated: boolean) {
    const windowDays = this.integer(
      query.windowDays,
      90,
      7,
      365,
      "windowDays",
    );
    const page = paginated
      ? this.integer(query.page, 1, 1, 1000, "page")
      : 1;
    const limit = paginated
      ? this.integer(query.limit, 100, 25, 250, "limit")
      : 5000;
    const mode = this.enumValue<ModeFilter>(
      query.mode,
      ["ALL", "GROUND", "AIR"],
      "ALL",
      "mode",
    );
    const sla = this.enumValue<SlaFilter>(
      query.sla,
      ["ALL", "BREACHED", "COMPLIANT", "PENDING"],
      "ALL",
      "sla",
    );
    const providerId = this.optionalId(query.providerId, "providerId");
    return { windowDays, page, limit, mode, sla, providerId };
  }

  private integer(
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
        field +
          " must be an integer between " +
          String(min) +
          " and " +
          String(max) +
          ".",
      );
    }
    return value;
  }

  private enumValue<T extends string>(
    raw: string | undefined,
    allowed: readonly T[],
    fallback: T,
    field: string,
  ) {
    if (raw == null || raw.trim() === "") return fallback;
    const normalized = raw.trim().toUpperCase() as T;
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(field + " is invalid.");
    }
    return normalized;
  }

  private optionalId(raw: string | undefined, field: string) {
    if (raw == null || raw.trim() === "") return null;
    const value = raw.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(value)) {
      throw new BadRequestException(field + " is invalid.");
    }
    return value;
  }

  private thresholds() {
    return {
      assignmentSlaMinutes: this.envInteger(
        "TRANSPORT_ASSIGNMENT_SLA_MINUTES",
        15,
      ),
      resourceReadySlaMinutes: this.envInteger(
        "TRANSPORT_RESOURCE_READY_SLA_MINUTES",
        10,
      ),
      departureGraceMinutes: this.envInteger(
        "TRANSPORT_DEPARTURE_GRACE_MINUTES",
        10,
      ),
    };
  }

  private envInteger(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= 1 && value <= 1440
      ? value
      : fallback;
  }

  private minutes(from: Date, to: Date) {
    return Math.max(
      0,
      Math.round(((to.getTime() - from.getTime()) / 60_000) * 10) / 10,
    );
  }

  private sensitiveDataPolicy() {
    return {
      patientIdentityIncluded: false,
      patientContactIncluded: false,
      pickupAddressIncluded: false,
      destinationAddressIncluded: false,
      coordinatesIncluded: false,
      managementReportPurpose: "TRANSPORT_OPERATIONS",
    };
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportCommandCenterController {
  constructor(private readonly commandCenter: TransportCommandCenterService) {}

  @Get("command-center")
  @Header("Cache-Control", "no-store")
  overview(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("windowDays") windowDays?: string,
    @Query("mode") mode?: string,
    @Query("providerId") providerId?: string,
    @Query("sla") sla?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.commandCenter.overview(principal, {
      windowDays,
      mode,
      providerId,
      sla,
      page,
      limit,
    });
  }

  @Get("management-report")
  @Header("Cache-Control", "no-store")
  report(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("windowDays") windowDays?: string,
    @Query("mode") mode?: string,
    @Query("providerId") providerId?: string,
    @Query("sla") sla?: string,
  ) {
    return this.commandCenter.managementReport(principal, {
      windowDays,
      mode,
      providerId,
      sla,
    });
  }
}

@Module({
  controllers: [TransportCommandCenterController],
  providers: [TransportCommandCenterService],
  exports: [TransportCommandCenterService],
})
export class TransportCommandCenterModule {}
