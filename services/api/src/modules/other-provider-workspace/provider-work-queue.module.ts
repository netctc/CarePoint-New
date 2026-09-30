import { Controller, ForbiddenException, Get, Header, Injectable, Module } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import type {
  ProviderWorkItem,
  ProviderWorkQueueCriterion,
} from "./provider-work-queue.types";

const ACTIVE_TRANSPORT_STATUSES = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] as const;
const PRIORITY_VERSION = "operational-v1" as const;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type CategoryContext = {
  family: string;
  capabilities: Record<string, unknown>;
};

type QueueCandidate = Omit<ProviderWorkItem, "priority"> & {
  priority: Omit<ProviderWorkItem["priority"], "rank">;
};

@Injectable()
class ProviderWorkQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async queue(principal: AuthPrincipal) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    const category = provider?.otherProviderProfile?.category;
    if (
      !provider ||
      provider.class !== "OTHER_PROVIDER" ||
      provider.status !== "ACTIVE" ||
      !category?.active
    ) {
      throw new ForbiddenException("An active Other Provider account is required for the work queue.");
    }

    const now = new Date();
    const from = new Date(now.getTime() - 8 * HOUR);
    const until = new Date(now.getTime() + 14 * DAY);
    const categoryContext: CategoryContext = {
      family: category.family,
      capabilities: this.objectValue(category.capabilities),
    };

    const [homeVisits, transports] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          providerId: provider.id,
          modality: "HOME_VISIT",
          status: "CONFIRMED",
          startsAt: { gte: from, lte: until },
        },
        select: {
          id: true,
          patientId: true,
          status: true,
          startsAt: true,
          endsAt: true,
        },
        orderBy: { startsAt: "asc" },
        take: 200,
      }),
      this.prisma.medicalTransportRequest.findMany({
        where: {
          assignedProviderId: provider.id,
          status: { in: [...ACTIVE_TRANSPORT_STATUSES] },
        },
        select: {
          id: true,
          patientId: true,
          status: true,
          mode: true,
          scheduledFor: true,
          etaMinutes: true,
          assistance: true,
          equipment: true,
          requestedAt: true,
          assignedAt: true,
        },
        orderBy: { scheduledFor: "asc" },
        take: 200,
      }),
    ]);

    const patientIds = [...new Set([
      ...homeVisits.map((item) => item.patientId),
      ...transports.map((item) => item.patientId),
    ])];
    const patients = patientIds.length === 0
      ? []
      : await this.prisma.patientProfile.findMany({
          where: { id: { in: patientIds } },
          select: { id: true, firstName: true, lastName: true },
        });
    const patientNames = new Map(
      patients.map((patient) => [patient.id, `${patient.firstName} ${patient.lastName}`.trim()]),
    );

    const candidates: QueueCandidate[] = [
      ...homeVisits.map((appointment) => {
        const criteria = this.criteria({
          kind: "HOME_VISIT",
          status: appointment.status,
          scheduledAt: appointment.startsAt,
          etaMinutes: null,
          capabilityFit: this.homeVisitCapabilityFit(categoryContext),
          now,
        });
        return {
          id: `HOME_VISIT:${appointment.id}`,
          jobId: appointment.id,
          kind: "HOME_VISIT" as const,
          status: appointment.status,
          patientId: appointment.patientId,
          patientDisplayName: patientNames.get(appointment.patientId) ?? "",
          scheduledAt: appointment.startsAt.toISOString(),
          etaMinutes: null,
          priority: {
            score: this.score(criteria),
            version: PRIORITY_VERSION,
            criteria,
          },
          navigation: { workspace: "HOME_VISIT" as const, contextId: appointment.id },
          autonomousClinicalDecision: false as const,
        };
      }),
      ...transports.map((transport) => {
        const criteria = this.criteria({
          kind: "MEDICAL_TRANSPORT",
          status: transport.status,
          scheduledAt: transport.scheduledFor,
          etaMinutes: transport.etaMinutes,
          capabilityFit: this.transportCapabilityFit(categoryContext, transport.mode),
          now,
        });
        return {
          id: `MEDICAL_TRANSPORT:${transport.id}`,
          jobId: transport.id,
          kind: "MEDICAL_TRANSPORT" as const,
          status: transport.status,
          patientId: transport.patientId,
          patientDisplayName: patientNames.get(transport.patientId) ?? "",
          scheduledAt: transport.scheduledFor.toISOString(),
          etaMinutes: transport.etaMinutes,
          priority: {
            score: this.score(criteria),
            version: PRIORITY_VERSION,
            criteria,
          },
          navigation: { workspace: "TRANSPORT" as const, contextId: transport.id },
          autonomousClinicalDecision: false as const,
        };
      }),
    ];

    candidates.sort((left, right) =>
      right.priority.score - left.priority.score ||
      Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt) ||
      left.id.localeCompare(right.id),
    );

    const items: ProviderWorkItem[] = candidates.map((candidate, index) => ({
      ...candidate,
      priority: { ...candidate.priority, rank: index + 1 },
    }));

    await this.audit.write({
      actorId: principal.accountId,
      action: "OTHER_PROVIDER_WORK_QUEUE_READ",
      objectType: "PROVIDER",
      objectId: provider.id,
      purpose: "CARE_DELIVERY_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        providerId: provider.id,
        priorityVersion: PRIORITY_VERSION,
        itemCount: items.length,
        homeVisitCount: homeVisits.length,
        transportCount: transports.length,
        autonomousClinicalDecision: false,
      },
    });

    return {
      providerId: provider.id,
      generatedAt: now.toISOString(),
      priorityVersion: PRIORITY_VERSION,
      autonomousClinicalDecision: false,
      policy: {
        descriptionKey: "provider.workQueue.policy.operationalOnly",
        weights: {
          scheduleTime: 30,
          distanceEta: 15,
          operationalUrgency: 25,
          sla: 25,
          capabilityFit: 5,
        },
        rules: [
          "No diagnosis, symptom, clinical observation, questionnaire answer, or inferred clinical risk is used.",
          "Distance is not inferred. Existing provider ETA is used when available; otherwise the criterion contributes zero.",
          "Operational urgency is derived only from job kind and lifecycle status.",
          "Every score contribution is returned to the client for explanation.",
        ],
      },
      items,
    };
  }

  private criteria(input: {
    kind: "HOME_VISIT" | "MEDICAL_TRANSPORT";
    status: string;
    scheduledAt: Date;
    etaMinutes: number | null;
    capabilityFit: boolean;
    now: Date;
  }): ProviderWorkQueueCriterion[] {
    const minutesToSchedule = Math.floor((input.scheduledAt.getTime() - input.now.getTime()) / 60000);
    return [
      this.scheduleCriterion(minutesToSchedule),
      this.etaCriterion(input.etaMinutes),
      this.operationalUrgencyCriterion(input.kind, input.status),
      this.slaCriterion(minutesToSchedule),
      {
        key: "CAPABILITY_FIT",
        contribution: input.capabilityFit ? 5 : 0,
        maximum: 5,
        source: "PROVIDER_CATEGORY_CAPABILITY",
        value: input.capabilityFit,
        explanationKey: input.capabilityFit
          ? "provider.workQueue.reason.capabilityFit"
          : "provider.workQueue.reason.capabilityMismatchAssignedStillVisible",
      },
    ];
  }

  private scheduleCriterion(minutes: number): ProviderWorkQueueCriterion {
    let contribution = 0;
    let explanationKey = "provider.workQueue.reason.scheduledLater";
    if (minutes <= 0) {
      contribution = 30;
      explanationKey = "provider.workQueue.reason.scheduledDueOrOverdue";
    } else if (minutes <= 30) {
      contribution = 26;
      explanationKey = "provider.workQueue.reason.scheduledWithin30m";
    } else if (minutes <= 120) {
      contribution = 18;
      explanationKey = "provider.workQueue.reason.scheduledWithin2h";
    } else if (minutes <= 480) {
      contribution = 10;
      explanationKey = "provider.workQueue.reason.scheduledWithin8h";
    } else if (minutes <= 1440) {
      contribution = 5;
      explanationKey = "provider.workQueue.reason.scheduledWithin24h";
    }
    return {
      key: "SCHEDULE_TIME",
      contribution,
      maximum: 30,
      source: "SCHEDULED_AT",
      value: minutes,
      explanationKey,
    };
  }

  private etaCriterion(etaMinutes: number | null): ProviderWorkQueueCriterion {
    if (etaMinutes == null) {
      return {
        key: "DISTANCE_ETA",
        contribution: 0,
        maximum: 15,
        source: "UNAVAILABLE",
        value: null,
        explanationKey: "provider.workQueue.reason.etaUnavailableNoDistanceInference",
      };
    }
    const bounded = Math.max(0, Math.min(24 * 60, etaMinutes));
    const contribution = bounded <= 15 ? 15 : bounded <= 30 ? 10 : bounded <= 60 ? 5 : 2;
    return {
      key: "DISTANCE_ETA",
      contribution,
      maximum: 15,
      source: "PROVIDER_ETA_MINUTES",
      value: bounded,
      explanationKey: bounded <= 15
        ? "provider.workQueue.reason.etaWithin15m"
        : bounded <= 30
          ? "provider.workQueue.reason.etaWithin30m"
          : bounded <= 60
            ? "provider.workQueue.reason.etaWithin60m"
            : "provider.workQueue.reason.etaOver60m",
    };
  }

  private operationalUrgencyCriterion(
    kind: "HOME_VISIT" | "MEDICAL_TRANSPORT",
    status: string,
  ): ProviderWorkQueueCriterion {
    let contribution = kind === "HOME_VISIT" ? 8 : 10;
    let explanationKey = kind === "HOME_VISIT"
      ? "provider.workQueue.reason.homeVisitConfirmed"
      : "provider.workQueue.reason.transportAssigned";
    if (kind === "MEDICAL_TRANSPORT") {
      if (status === "EN_ROUTE") {
        contribution = 15;
        explanationKey = "provider.workQueue.reason.transportEnRoute";
      } else if (status === "ARRIVED") {
        contribution = 20;
        explanationKey = "provider.workQueue.reason.transportArrived";
      } else if (status === "TRANSPORTING") {
        contribution = 25;
        explanationKey = "provider.workQueue.reason.transportingPatient";
      }
    }
    return {
      key: "OPERATIONAL_URGENCY",
      contribution,
      maximum: 25,
      source: "JOB_KIND_AND_LIFECYCLE_STATUS",
      value: `${kind}:${status}`,
      explanationKey,
    };
  }

  private slaCriterion(minutesToSchedule: number): ProviderWorkQueueCriterion {
    let contribution = 0;
    let explanationKey = "provider.workQueue.reason.slaHealthy";
    if (minutesToSchedule < -15) {
      contribution = 25;
      explanationKey = "provider.workQueue.reason.slaBreached";
    } else if (minutesToSchedule <= 0) {
      contribution = 20;
      explanationKey = "provider.workQueue.reason.slaDue";
    } else if (minutesToSchedule <= 15) {
      contribution = 15;
      explanationKey = "provider.workQueue.reason.slaWithin15m";
    } else if (minutesToSchedule <= 60) {
      contribution = 8;
      explanationKey = "provider.workQueue.reason.slaWithin60m";
    }
    return {
      key: "SLA",
      contribution,
      maximum: 25,
      source: "SCHEDULE_START_SLA_V1",
      value: minutesToSchedule,
      explanationKey,
    };
  }

  private homeVisitCapabilityFit(category: CategoryContext): boolean {
    const values = this.stringArray(category.capabilities.enabledModalities);
    return values.includes("HOME_VISIT");
  }

  private transportCapabilityFit(category: CategoryContext, mode: string): boolean {
    return (
      (mode === "GROUND" && category.family === "MEDICAL_TRANSPORT_GROUND") ||
      (mode === "AIR" && category.family === "MEDICAL_TRANSPORT_AIR")
    );
  }

  private score(criteria: ProviderWorkQueueCriterion[]) {
    return criteria.reduce((sum, criterion) => sum + criterion.contribution, 0);
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toUpperCase());
  }
}

@Controller("provider/jobs")
class ProviderWorkQueueController {
  constructor(private readonly queueService: ProviderWorkQueueService) {}

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get("work-queue")
  @Header("Cache-Control", "no-store")
  queue(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.queueService.queue(principal);
  }
}

@Module({
  controllers: [ProviderWorkQueueController],
  providers: [ProviderWorkQueueService],
})
export class ProviderWorkQueueModule {}
