import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma, type AppointmentStatus, type TelehealthSessionStatus } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const LOOKBACK_MS = 2 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const READINESS_WARNING_MINUTES = 30;
const JOIN_EARLY_MINUTES = 15;
const JOIN_LATE_MINUTES = 60;
const TERMINATION_REASONS = ["TECHNICAL_FAILURE", "SECURITY", "PROVIDER_REQUEST", "OPERATIONS"] as const;
const ACTIONS = ["RESET_READINESS", "TERMINATE_SESSION"] as const;

type AdminTelehealthAction = (typeof ACTIONS)[number];
type TerminationReason = (typeof TERMINATION_REASONS)[number];
type Severity = "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";

type TelehealthRow = {
  id: string;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  provider: { id: string; class: string; displayName: string };
  service: { id: string; name: string };
  telehealthSession: {
    id: string;
    status: TelehealthSessionStatus;
    consentId: string | null;
    patientReadyAt: Date | null;
    providerReadyAt: Date | null;
    startedAt: Date | null;
    endedAt: Date | null;
    recordingEnabled: boolean;
  } | null;
};

@Injectable()
class AdminTelehealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async workspace(principal: AuthPrincipal) {
    this.requireAdmin(principal);
    const generatedAt = new Date();
    const from = new Date(generatedAt.getTime() - LOOKBACK_MS);
    const to = new Date(generatedAt.getTime() + LOOKAHEAD_MS);

    const rows = await this.prisma.appointment.findMany({
      where: {
        modality: "TELEMEDICINE",
        startsAt: { gte: from, lt: to },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 300,
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        provider: { select: { id: true, class: true, displayName: true } },
        service: { select: { id: true, name: true } },
        telehealthSession: {
          select: {
            id: true,
            status: true,
            consentId: true,
            patientReadyAt: true,
            providerReadyAt: true,
            startedAt: true,
            endedAt: true,
            recordingEnabled: true,
          },
        },
      },
    });

    const items = rows.map((row) => this.present(row, generatedAt));
    const severityRank: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };
    items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    const summary = {
      appointmentsInWindow: items.length,
      waiting: items.filter((item) => item.sessionStatus === "WAITING" || item.sessionStatus === null).length,
      ready: items.filter((item) => item.sessionStatus === "READY").length,
      active: items.filter((item) => item.sessionStatus === "ACTIVE").length,
      attentionNeeded: items.filter((item) => item.severity === "HIGH" || item.severity === "CRITICAL").length,
    };

    return {
      generatedAt: generatedAt.toISOString(),
      window: { from: from.toISOString(), to: to.toISOString() },
      privacy: {
        phiNeutral: true,
        patientIdentityExcluded: true,
        roomCredentialsExcluded: true,
        encryptionMaterialExcluded: true,
      },
      policy: {
        adminCannotJoin: true,
        recordingEnabled: false,
        appointmentLifecycleManagedSeparately: true,
      },
      summary,
      queue: items,
    };
  }

  async act(principal: AuthPrincipal, input: { action?: string; sessionId?: string; reasonCode?: string }) {
    this.requireAdmin(principal);
    const action = this.action(input.action);
    const sessionId = this.identifier(input.sessionId, "sessionId");
    if (action === "RESET_READINESS") return this.resetReadiness(principal, sessionId);
    return this.terminateSession(principal, sessionId, this.terminationReason(input.reasonCode));
  }

  private async resetReadiness(principal: AuthPrincipal, sessionId: string) {
    const current = await this.prisma.telehealthSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        appointmentId: true,
        status: true,
        consentId: true,
        patientReadyAt: true,
        providerReadyAt: true,
        appointment: { select: { modality: true, status: true } },
      },
    });
    if (!current) throw new NotFoundException("Telehealth session not found.");
    if (current.appointment.modality !== "TELEMEDICINE") throw new ConflictException("Telehealth operation requires a telemedicine appointment.");
    if (current.appointment.status !== "CONFIRMED" && current.appointment.status !== "REQUESTED") {
      throw new ConflictException("Readiness can only be reset for an active appointment.");
    }
    if (current.status !== "WAITING" && current.status !== "READY") {
      throw new ConflictException("Readiness can only be reset before a telehealth session becomes active.");
    }

    const changed = await this.prisma.telehealthSession.updateMany({
      where: { id: current.id, status: current.status },
      data: {
        status: "WAITING",
        patientReadyAt: null,
        providerReadyAt: null,
        patientReadiness: Prisma.DbNull,
        providerReadiness: Prisma.DbNull,
      },
    });
    if (changed.count !== 1) throw new ConflictException("Telehealth session changed concurrently. Refresh and retry.");

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TELEHEALTH_READINESS_RESET",
      objectType: "TELEHEALTH_SESSION",
      objectId: current.id,
      purpose: "TELEHEALTH_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        appointmentId: current.appointmentId,
        fromStatus: current.status,
        consentPreserved: Boolean(current.consentId),
        patientWasReady: Boolean(current.patientReadyAt),
        providerWasReady: Boolean(current.providerReadyAt),
      },
    });

    return {
      action: "RESET_READINESS" as const,
      sessionId: current.id,
      appointmentId: current.appointmentId,
      status: "WAITING" as const,
      consentPreserved: Boolean(current.consentId),
      patientReady: false,
      providerReady: false,
    };
  }

  private async terminateSession(principal: AuthPrincipal, sessionId: string, reasonCode: TerminationReason) {
    const current = await this.prisma.telehealthSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        appointmentId: true,
        status: true,
        startedAt: true,
        endedAt: true,
        appointment: { select: { modality: true, status: true } },
      },
    });
    if (!current) throw new NotFoundException("Telehealth session not found.");
    if (current.appointment.modality !== "TELEMEDICINE") throw new ConflictException("Telehealth operation requires a telemedicine appointment.");
    if (current.status !== "ACTIVE") throw new ConflictException("Only an active telehealth session can be administratively terminated.");

    const endedAt = new Date();
    const changed = await this.prisma.telehealthSession.updateMany({
      where: { id: current.id, status: "ACTIVE" },
      data: { status: "ENDED", endedAt },
    });
    if (changed.count !== 1) throw new ConflictException("Telehealth session changed concurrently. Refresh and retry.");

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TELEHEALTH_SESSION_TERMINATED",
      objectType: "TELEHEALTH_SESSION",
      objectId: current.id,
      purpose: "TELEHEALTH_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        appointmentId: current.appointmentId,
        appointmentStatusPreserved: current.appointment.status,
        reasonCode,
        hadStarted: Boolean(current.startedAt),
      },
    });

    return {
      action: "TERMINATE_SESSION" as const,
      sessionId: current.id,
      appointmentId: current.appointmentId,
      status: "ENDED" as const,
      endedAt: endedAt.toISOString(),
      appointmentStatus: current.appointment.status,
      reasonCode,
    };
  }

  private present(row: TelehealthRow, now: Date) {
    const session = row.telehealthSession;
    const consentGranted = Boolean(session?.consentId);
    const patientReady = Boolean(session?.patientReadyAt);
    const providerReady = Boolean(session?.providerReadyAt);
    const reasons: string[] = [];
    let severity: Severity = "INFO";
    const minutesToStart = Math.round((row.startsAt.getTime() - now.getTime()) / 60_000);
    const minutesAfterEnd = Math.round((now.getTime() - row.endsAt.getTime()) / 60_000);
    const appointmentTerminal = row.status === "CANCELLED" || row.status === "NO_SHOW" || row.status === "COMPLETED";

    const escalate = (next: Severity, reason: string) => {
      const rank: Record<Severity, number> = { INFO: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
      if (rank[next] > rank[severity]) severity = next;
      if (!reasons.includes(reason)) reasons.push(reason);
    };

    if (session?.recordingEnabled) escalate("CRITICAL", "RECORDING_POLICY_VIOLATION");
    if (session?.status === "ACTIVE" && (row.status === "CANCELLED" || row.status === "NO_SHOW")) {
      escalate("CRITICAL", "APPOINTMENT_SESSION_MISMATCH");
    }
    if (session?.status === "ACTIVE" && minutesAfterEnd > JOIN_LATE_MINUTES) {
      escalate("CRITICAL", "OVERDUE_ACTIVE_SESSION");
    }
    if (!appointmentTerminal && row.status === "CONFIRMED" && minutesToStart <= JOIN_EARLY_MINUTES && minutesAfterEnd <= JOIN_LATE_MINUTES) {
      if (!session) escalate("HIGH", "SESSION_NOT_INITIALIZED");
      if (!consentGranted) escalate("HIGH", "CONSENT_MISSING");
      if (!patientReady) escalate("HIGH", "PATIENT_NOT_READY");
      if (!providerReady) escalate("HIGH", "PROVIDER_NOT_READY");
    } else if (!appointmentTerminal && row.status === "CONFIRMED" && minutesToStart <= READINESS_WARNING_MINUTES && minutesToStart > JOIN_EARLY_MINUTES) {
      if (!session) escalate("MEDIUM", "SESSION_NOT_INITIALIZED");
      if (!consentGranted) escalate("MEDIUM", "CONSENT_PENDING");
      if (!patientReady || !providerReady) escalate("MEDIUM", "READINESS_INCOMPLETE");
    }
    if (appointmentTerminal && session && session.status !== "ENDED" && session.status !== "CANCELLED") {
      escalate(session.status === "ACTIVE" ? "CRITICAL" : "HIGH", "TERMINAL_APPOINTMENT_OPEN_SESSION");
    }

    return {
      appointmentId: row.id,
      sessionId: session?.id ?? null,
      appointmentStatus: row.status,
      sessionStatus: session?.status ?? null,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      provider: row.provider,
      service: row.service,
      consentGranted,
      patientReady,
      providerReady,
      startedAt: session?.startedAt?.toISOString() ?? null,
      endedAt: session?.endedAt?.toISOString() ?? null,
      recordingEnabled: session?.recordingEnabled ?? false,
      severity: severity as Severity,
      attentionReasons: reasons,
      actions: {
        canResetReadiness: Boolean(session) && (session?.status === "WAITING" || session?.status === "READY") && (row.status === "CONFIRMED" || row.status === "REQUESTED"),
        canTerminateSession: session?.status === "ACTIVE",
      },
    };
  }

  private action(value?: string): AdminTelehealthAction {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || !(ACTIONS as readonly string[]).includes(normalized)) throw new BadRequestException("Unsupported telehealth action.");
    return normalized as AdminTelehealthAction;
  }

  private terminationReason(value?: string): TerminationReason {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || !(TERMINATION_REASONS as readonly string[]).includes(normalized)) {
      throw new BadRequestException(`reasonCode must be one of: ${TERMINATION_REASONS.join(", ")}.`);
    }
    return normalized as TerminationReason;
  }

  private identifier(value: string | undefined, field: string): string {
    const cleaned = value?.trim();
    if (!cleaned) throw new BadRequestException(`${field} is required.`);
    if (cleaned.length > 160) throw new BadRequestException(`${field} is too long.`);
    return cleaned;
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Administrator telehealth operations access is required.");
  }
}

@Controller("admin/operations/telehealth")
class AdminTelehealthController {
  constructor(private readonly telehealth: AdminTelehealthService) {}

  @RequirePermissions("APPOINTMENT_OPERATE")
  @Get("workspace")
  workspace(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.telehealth.workspace(principal);
  }

  @RequirePermissions("APPOINTMENT_OPERATE")
  @Post("actions")
  action(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: { action?: string; sessionId?: string; reasonCode?: string },
  ) {
    return this.telehealth.act(principal, body);
  }
}

@Module({
  controllers: [AdminTelehealthController],
  providers: [AdminTelehealthService],
})
export class AdminTelehealthModule {}
