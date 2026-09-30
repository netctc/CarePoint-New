import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
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
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";

const ACTIVE_STATUSES = [
  "REQUESTED",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "TRANSPORTING",
] as const;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const SAFE_EXCEPTION = /^[A-Z0-9_:-]{3,80}$/;

type ExceptionSeverity = "CRITICAL" | "WARNING" | "INFO";
type ExceptionItem = {
  code: string;
  severity: ExceptionSeverity;
  title: string;
  detail: string;
  since: string;
  overdueMinutes: number | null;
  recommendedAction:
    | "ASSIGN_PROVIDER"
    | "ASSIGN_RESOURCES"
    | "RECALCULATE_ETA"
    | "REVIEW_PROVIDER"
    | "REVIEW_INCIDENT"
    | "ADVANCE_OR_REVIEW_STATUS";
};

type ProviderAttentionBody = {
  exceptionCode?: unknown;
};

@Injectable()
class TransportLiveOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async overview(principal: AuthPrincipal) {
    const now = new Date();
    const thresholds = this.thresholds();

    const requests = await this.prisma.medicalTransportRequest.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] as any[] } },
      orderBy: [{ scheduledFor: "asc" }, { requestedAt: "asc" }],
      take: 300,
    });

    const requestIds = requests.map((row) => row.id);
    const patientIds = [...new Set(requests.map((row) => row.patientId))];
    const providerIds = [
      ...new Set(
        requests
          .map((row) => row.assignedProviderId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    const [patients, assignments, routeRevisions, incidents, providers, units] =
      await Promise.all([
        patientIds.length
          ? this.prisma.patientProfile.findMany({
              where: { id: { in: patientIds } },
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            })
          : [],
        requestIds.length
          ? this.prisma.crewAssignment.findMany({
              where: { transportRequestId: { in: requestIds } },
              orderBy: { assignedAt: "desc" },
              take: 3000,
            })
          : [],
        requestIds.length
          ? this.prisma.transportRouteRevision.findMany({
              where: { transportRequestId: { in: requestIds } },
              orderBy: { createdAt: "desc" },
              take: 3000,
            })
          : [],
        requestIds.length
          ? this.prisma.transportIncident.findMany({
              where: {
                transportRequestId: { in: requestIds },
                severity: { in: ["WARNING", "CRITICAL"] },
                occurredAt: {
                  gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
                },
              },
              orderBy: { occurredAt: "desc" },
              take: 3000,
              select: {
                id: true,
                transportRequestId: true,
                category: true,
                severity: true,
                reasonCode: true,
                occurredAt: true,
              },
            })
          : [],
        providerIds.length
          ? this.prisma.provider.findMany({
              where: { id: { in: providerIds } },
              include: {
                user: { select: { id: true, status: true } },
                credentials: true,
                otherProviderProfile: { include: { category: true } },
              },
            })
          : [],
        providerIds.length
          ? this.prisma.transportUnit.findMany({
              where: { providerId: { in: providerIds } },
              orderBy: [{ providerId: "asc" }, { code: "asc" }],
            })
          : [],
      ]);

    const patientById = new Map(patients.map((row) => [row.id, row]));
    const providerById = new Map(providers.map((row) => [row.id, row]));

    const latestAssignmentByRequest = new Map<string, (typeof assignments)[number]>();
    for (const row of assignments) {
      if (!latestAssignmentByRequest.has(row.transportRequestId)) {
        latestAssignmentByRequest.set(row.transportRequestId, row);
      }
    }

    const latestRouteByRequest = new Map<string, (typeof routeRevisions)[number]>();
    for (const row of routeRevisions) {
      if (!latestRouteByRequest.has(row.transportRequestId)) {
        latestRouteByRequest.set(row.transportRequestId, row);
      }
    }

    const incidentsByRequest = new Map<string, typeof incidents>();
    for (const incident of incidents) {
      const current = incidentsByRequest.get(incident.transportRequestId) ?? [];
      current.push(incident);
      incidentsByRequest.set(incident.transportRequestId, current);
    }

    const unitsByProvider = new Map<string, typeof units>();
    for (const unit of units) {
      const current = unitsByProvider.get(unit.providerId) ?? [];
      current.push(unit);
      unitsByProvider.set(unit.providerId, current);
    }

    const rows = requests
      .map((request) => {
        const patient = patientById.get(request.patientId);
        const provider = request.assignedProviderId
          ? providerById.get(request.assignedProviderId)
          : undefined;
        const assignment = latestAssignmentByRequest.get(request.id);
        const latestRoute = latestRouteByRequest.get(request.id);
        const requestIncidents = incidentsByRequest.get(request.id) ?? [];
        const exceptions: ExceptionItem[] = [];

        const assignmentAge = this.minutesBetween(request.requestedAt, now);
        if (
          request.status === "REQUESTED" &&
          assignmentAge >= thresholds.assignmentSlaMinutes
        ) {
          exceptions.push({
            code: "ASSIGNMENT_SLA_BREACH",
            severity: this.severityForOverdue(
              assignmentAge - thresholds.assignmentSlaMinutes,
            ),
            title: "Provider assignment overdue",
            detail: `Request has remained unassigned for ${assignmentAge} minutes.`,
            since: request.requestedAt.toISOString(),
            overdueMinutes: assignmentAge - thresholds.assignmentSlaMinutes,
            recommendedAction: "ASSIGN_PROVIDER",
          });
        }

        if (
          request.assignedProviderId &&
          request.status === "ASSIGNED" &&
          (!assignment ||
            !assignment.transportUnitId ||
            assignment.crewProviderIds.length === 0)
        ) {
          const anchor = request.assignedAt ?? request.updatedAt;
          const resourceAge = this.minutesBetween(anchor, now);
          if (resourceAge >= thresholds.resourceReadySlaMinutes) {
            exceptions.push({
              code: "RESOURCE_READY_SLA_BREACH",
              severity: this.severityForOverdue(
                resourceAge - thresholds.resourceReadySlaMinutes,
              ),
              title: "Crew or transport unit not ready",
              detail:
                "The provider is assigned but the latest crew/unit revision is incomplete.",
              since: anchor.toISOString(),
              overdueMinutes:
                resourceAge - thresholds.resourceReadySlaMinutes,
              recommendedAction: "ASSIGN_RESOURCES",
            });
          }
        }

        if (request.mode === "GROUND" && request.assignedProviderId) {
          const destinationChanged =
            latestRoute?.source === "PROVIDER_DESTINATION_CHANGE";
          if (request.etaMinutes == null) {
            const anchor = latestRoute?.createdAt ?? request.assignedAt ?? request.updatedAt;
            const etaAge = this.minutesBetween(anchor, now);
            if (etaAge >= thresholds.etaRefreshSlaMinutes) {
              exceptions.push({
                code: destinationChanged
                  ? "ETA_STALE_AFTER_DESTINATION_CHANGE"
                  : "ETA_REFRESH_SLA_BREACH",
                severity: etaAge >= thresholds.etaRefreshSlaMinutes * 2
                  ? "CRITICAL"
                  : "WARNING",
                title: destinationChanged
                  ? "ETA stale after destination change"
                  : "ETA refresh overdue",
                detail:
                  "A current Ground Transport ETA is not available for this assigned job.",
                since: anchor.toISOString(),
                overdueMinutes: etaAge - thresholds.etaRefreshSlaMinutes,
                recommendedAction: "RECALCULATE_ETA",
              });
            }
          }
        }

        if (
          (request.status === "REQUESTED" || request.status === "ASSIGNED") &&
          now.getTime() >
            request.scheduledFor.getTime() +
              thresholds.departureGraceMinutes * 60_000
        ) {
          const overdue = this.minutesBetween(request.scheduledFor, now);
          exceptions.push({
            code: "DEPARTURE_SLA_BREACH",
            severity: overdue >= thresholds.departureGraceMinutes * 2
              ? "CRITICAL"
              : "WARNING",
            title: "Scheduled departure overdue",
            detail:
              "The scheduled transport has not advanced to EN_ROUTE within the configured grace window.",
            since: request.scheduledFor.toISOString(),
            overdueMinutes: Math.max(
              0,
              overdue - thresholds.departureGraceMinutes,
            ),
            recommendedAction: "ADVANCE_OR_REVIEW_STATUS",
          });
        }

        if (provider && !this.providerDispatchReady(provider, unitsByProvider.get(provider.id) ?? [])) {
          exceptions.push({
            code: "ASSIGNED_PROVIDER_NOT_READY",
            severity: "CRITICAL",
            title: "Assigned provider is no longer dispatch ready",
            detail:
              "Account, provider status, credentials, category or compatible active fleet no longer satisfies dispatch readiness.",
            since: request.updatedAt.toISOString(),
            overdueMinutes: null,
            recommendedAction: "REVIEW_PROVIDER",
          });
        }

        for (const incident of requestIncidents) {
          exceptions.push({
            code:
              incident.severity === "CRITICAL"
                ? "CRITICAL_TRANSPORT_INCIDENT"
                : "WARNING_TRANSPORT_INCIDENT",
            severity:
              incident.severity === "CRITICAL" ? "CRITICAL" : "WARNING",
            title:
              incident.severity === "CRITICAL"
                ? "Critical transport incident"
                : "Transport incident requires review",
            detail: `${incident.category} · ${incident.reasonCode}`,
            since: incident.occurredAt.toISOString(),
            overdueMinutes: null,
            recommendedAction: "REVIEW_INCIDENT",
          });
        }

        const patientLabel = [patient?.firstName, patient?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();

        return {
          requestId: request.id,
          patientLabel: patientLabel || "Patient",
          mode: request.mode,
          status: request.status,
          scheduledFor: request.scheduledFor,
          assignedProvider: provider
            ? {
                id: provider.id,
                displayName: provider.displayName,
              }
            : null,
          etaMinutes: request.etaMinutes,
          exceptionCount: exceptions.length,
          highestSeverity: this.highestSeverity(exceptions),
          exceptions: exceptions.sort(
            (a, b) => this.severityWeight(b.severity) - this.severityWeight(a.severity),
          ),
        };
      })
      .filter((row) => row.exceptionCount > 0)
      .sort((a, b) => {
        const severity =
          this.severityWeight(b.highestSeverity) -
          this.severityWeight(a.highestSeverity);
        if (severity !== 0) return severity;
        return new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime();
      });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_LIVE_OPERATIONS_READ",
      objectType: "TRANSPORT_LIVE_OPERATIONS",
      objectId: "ACTIVE",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        exceptionRequestCount: rows.length,
        criticalCount: rows.filter((row) => row.highestSeverity === "CRITICAL").length,
      },
    });

    return {
      generatedAt: now.toISOString(),
      trackingMode: "ESTIMATED_ROUTE_ONLY",
      liveGpsTrackingAvailable: false,
      thresholds,
      summary: {
        exceptionRequests: rows.length,
        criticalRequests: rows.filter(
          (row) => row.highestSeverity === "CRITICAL",
        ).length,
        warningRequests: rows.filter(
          (row) => row.highestSeverity === "WARNING",
        ).length,
        totalExceptions: rows.reduce(
          (sum, row) => sum + row.exceptionCount,
          0,
        ),
      },
      items: rows,
    };
  }

  async notifyAssignedProvider(
    principal: AuthPrincipal,
    requestIdRaw: string,
    body: ProviderAttentionBody,
  ) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const exceptionCode = this.exceptionCode(body.exceptionCode);
    const request = await this.prisma.medicalTransportRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        assignedProviderId: true,
        status: true,
      },
    });
    if (!request || !ACTIVE_STATUSES.includes(request.status as any)) {
      throw new NotFoundException("Active medical transport request not found.");
    }
    if (!request.assignedProviderId) {
      throw new ConflictException(
        "Assign a Transport Provider before sending operational attention.",
      );
    }
    const provider = await this.prisma.provider.findUnique({
      where: { id: request.assignedProviderId },
      select: { id: true, userId: true, displayName: true },
    });
    if (!provider?.userId) {
      throw new ConflictException(
        "Assigned Transport Provider does not have a notification account.",
      );
    }

    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    await this.notifications.notifyAccount({
      accountId: provider.userId,
      dedupeKey: `transport-live:${request.id}:${exceptionCode}:${bucket}`,
      type: "TRANSPORT_UPDATE",
      entityType: "MEDICAL_TRANSPORT_REQUEST",
      entityId: request.id,
      safeTitleKey: "transport.operations.attention.title",
      safeBodyKey: "transport.operations.attention.body",
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_PROVIDER_ATTENTION_SENT",
      objectType: "MEDICAL_TRANSPORT_REQUEST",
      objectId: request.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        providerId: provider.id,
        exceptionCode,
        dedupeWindowMinutes: 15,
      },
    });
    return {
      sent: true,
      requestId: request.id,
      providerId: provider.id,
      exceptionCode,
      dedupeWindowMinutes: 15,
    };
  }

  private thresholds() {
    return {
      assignmentSlaMinutes: this.envMinutes(
        "TRANSPORT_ASSIGNMENT_SLA_MINUTES",
        15,
      ),
      resourceReadySlaMinutes: this.envMinutes(
        "TRANSPORT_RESOURCE_READY_SLA_MINUTES",
        10,
      ),
      etaRefreshSlaMinutes: this.envMinutes(
        "TRANSPORT_ETA_REFRESH_SLA_MINUTES",
        10,
      ),
      departureGraceMinutes: this.envMinutes(
        "TRANSPORT_DEPARTURE_GRACE_MINUTES",
        10,
      ),
    };
  }

  private providerDispatchReady(provider: any, units: any[]) {
    const category = provider.otherProviderProfile?.category;
    const family = category?.family;
    const expectedMode = family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND";
    const required = jsonStringArray(category?.requiredCredentialTypes);
    const usable = (provider.credentials ?? []).filter(
      (credential: { status?: string }) =>
        credential.status === "VALID" || credential.status === "VERIFIED",
    );
    return (
      provider.status === "ACTIVE" &&
      provider.user?.status === "ACTIVE" &&
      category?.active === true &&
      missingCurrentCredentialTypes(required, usable).length === 0 &&
      units.some(
        (unit) =>
          unit.active &&
          unit.mode === expectedMode,
      )
    );
  }

  private highestSeverity(exceptions: ExceptionItem[]): ExceptionSeverity {
    if (exceptions.some((item) => item.severity === "CRITICAL")) return "CRITICAL";
    if (exceptions.some((item) => item.severity === "WARNING")) return "WARNING";
    return "INFO";
  }

  private severityWeight(severity: ExceptionSeverity) {
    return severity === "CRITICAL" ? 3 : severity === "WARNING" ? 2 : 1;
  }

  private severityForOverdue(overdueMinutes: number): ExceptionSeverity {
    return overdueMinutes >= 15 ? "CRITICAL" : "WARNING";
  }

  private minutesBetween(from: Date, to: Date) {
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
  }

  private envMinutes(name: string, fallback: number) {
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1 || value > 1440) return fallback;
    return value;
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private exceptionCode(value: unknown) {
    if (typeof value !== "string") {
      throw new BadRequestException("exceptionCode is required.");
    }
    const normalized = value.trim().toUpperCase();
    if (!SAFE_EXCEPTION.test(normalized)) {
      throw new BadRequestException("exceptionCode is invalid.");
    }
    return normalized;
  }
}

@Controller("admin/transport/live-operations")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportLiveOperationsController {
  constructor(private readonly live: TransportLiveOperationsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  overview(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.live.overview(principal);
  }

  @Post(":requestId/notify-provider")
  @Header("Cache-Control", "no-store")
  notifyProvider(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: ProviderAttentionBody,
  ) {
    return this.live.notifyAssignedProvider(principal, requestId, body ?? {});
  }
}

@Module({
  imports: [CommunicationsModule],
  controllers: [TransportLiveOperationsController],
  providers: [TransportLiveOperationsService],
})
export class TransportLiveOperationsModule {}
