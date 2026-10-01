import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";
import {
  CommunicationsModule,
} from "../communications/communications.module";
import { NotificationGatewayService } from "../communications/notification-gateway.service";

type DestinationInput = {
  scheduleId?: unknown;
  label?: unknown;
  recipientAccountId?: unknown;
  channel?: unknown;
};

@Injectable()
export class TransportReportDeliveryOutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async destinations(principal: AuthPrincipal) {
    const items = await this.prisma.transportManagementReportDestination.findMany({
      include: {
        schedule: {
          select: {
            id: true,
            name: true,
            cadence: true,
            enabled: true,
          },
        },
      },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      take: 500,
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_DESTINATIONS_READ",
      objectType: "TRANSPORT_REPORT_DESTINATION",
      objectId: "LIST",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { count: items.length },
    });
    return {
      generatedAt: new Date().toISOString(),
      items,
    };
  }

  async createDestination(principal: AuthPrincipal, body: DestinationInput) {
    const scheduleId = this.id(body.scheduleId, "scheduleId");
    const recipientAccountId = this.id(
      body.recipientAccountId,
      "recipientAccountId",
    );
    const label = this.text(body.label, "label");
    const channel = this.channel(body.channel);

    const [schedule, recipient] = await Promise.all([
      this.prisma.transportManagementReportSchedule.findUnique({
        where: { id: scheduleId },
        select: { id: true, name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: recipientAccountId },
        select: { id: true, role: true, status: true },
      }),
    ]);
    if (!schedule) {
      throw new BadRequestException("Transport report schedule was not found.");
    }
    if (!recipient || recipient.status !== "ACTIVE" || recipient.role !== "ADMIN") {
      throw new BadRequestException(
        "Transport report destination must reference an active ADMIN account.",
      );
    }

    const existing =
      await this.prisma.transportManagementReportDestination.findFirst({
        where: { scheduleId, recipientAccountId, channel },
      });
    const row = existing
      ? await this.prisma.transportManagementReportDestination.update({
          where: { id: existing.id },
          data: {
            label,
            active: true,
            updatedByAccountId: principal.accountId,
          },
        })
      : await this.prisma.transportManagementReportDestination.create({
          data: {
            scheduleId,
            label,
            recipientAccountId,
            channel,
            active: true,
            createdByAccountId: principal.accountId,
            updatedByAccountId: principal.accountId,
          },
        });

    await this.audit.write({
      actorId: principal.accountId,
      action: existing
        ? "ADMIN_TRANSPORT_REPORT_DESTINATION_REACTIVATED"
        : "ADMIN_TRANSPORT_REPORT_DESTINATION_CREATED",
      objectType: "TRANSPORT_REPORT_DESTINATION",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        scheduleId,
        recipientAccountId,
        channel,
        recipientRole: "ADMIN",
      },
    });
    return row;
  }

  async deactivateDestination(
    principal: AuthPrincipal,
    destinationIdRaw: string,
  ) {
    const destinationId = this.id(destinationIdRaw, "destinationId");
    const existing =
      await this.prisma.transportManagementReportDestination.findUnique({
        where: { id: destinationId },
      });
    if (!existing) {
      throw new BadRequestException("Transport report destination was not found.");
    }
    const row = await this.prisma.transportManagementReportDestination.update({
      where: { id: destinationId },
      data: {
        active: false,
        updatedByAccountId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_DESTINATION_DEACTIVATED",
      objectType: "TRANSPORT_REPORT_DESTINATION",
      objectId: destinationId,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { scheduleId: row.scheduleId },
    });
    return row;
  }

  async enqueueForRun(
    principal: AuthPrincipal,
    run: { id: string; scheduleId: string },
  ) {
    const destinations =
      await this.prisma.transportManagementReportDestination.findMany({
        where: { scheduleId: run.scheduleId, active: true },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 100,
      });

    const created = destinations.length
      ? await this.prisma.transportManagementReportDelivery.createMany({
          data: destinations.map((destination) => ({
            runId: run.id,
            destinationId: destination.id,
            status: "PENDING",
          })),
          skipDuplicates: true,
        })
      : { count: 0 };

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_DELIVERY_OUTBOX_ENQUEUED",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: run.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        scheduleId: run.scheduleId,
        configuredDestinations: destinations.length,
        newlyQueued: created.count,
        externalDeliveryRequired: true,
        reportDeliveryPerformed: false,
      },
    });

    return {
      configuredDestinations: destinations.length,
      newlyQueued: created.count,
    };
  }

  async deliveries(principal: AuthPrincipal) {
    const items = await this.prisma.transportManagementReportDelivery.findMany({
      include: {
        destination: {
          select: {
            id: true,
            label: true,
            recipientAccountId: true,
            channel: true,
            active: true,
            scheduleId: true,
          },
        },
        run: {
          select: {
            id: true,
            scheduleId: true,
            scheduledFor: true,
            reportFilename: true,
            artifactSha256: true,
            artifactStorageProvider: true,
            deliveryStatus: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_DELIVERY_OUTBOX_READ",
      objectType: "TRANSPORT_REPORT_DELIVERY",
      objectId: "LIST",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { count: items.length },
    });
    return {
      generatedAt: new Date().toISOString(),
      executionMode: "REPORT_READY_NOTIFICATION_WORKER",
      notificationDeliveryEnabled: true,
      artifactDeliveryPerformed: false,
      reportDeliveryPerformed: false,
      items,
    };
  }

  async inbox(principal: AuthPrincipal) {
    const items = await this.prisma.transportManagementReportDelivery.findMany({
      where: {
        status: "SENT",
        destination: {
          recipientAccountId: principal.accountId,
        },
      },
      select: {
        id: true,
        status: true,
        sentAt: true,
        downloadedAt: true,
        downloadedByAccountId: true,
        destination: {
          select: {
            id: true,
            label: true,
            channel: true,
            scheduleId: true,
          },
        },
        run: {
          select: {
            id: true,
            scheduleId: true,
            scheduledFor: true,
            reportFilename: true,
            rowCount: true,
            artifactSha256: true,
            artifactBytes: true,
            artifactStoredAt: true,
            artifactDeletedAt: true,
            artifactIntegrityStatus: true,
          },
        },
      },
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_INBOX_READ",
      objectType: "TRANSPORT_REPORT_DELIVERY",
      objectId: principal.accountId,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        count: items.length,
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
        objectStorageKeyIncluded: false,
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      recipientAccountId: principal.accountId,
      sensitiveDataPolicy: {
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
        objectStorageKeyIncluded: false,
      },
      items: items.map((item) => ({
        ...item,
        artifactAvailable: Boolean(
          item.run.artifactSha256 &&
            !item.run.artifactDeletedAt &&
            item.run.artifactIntegrityStatus !== "MISMATCH",
        ),
      })),
    };
  }

  async recoverable(limit: number) {
    const now = new Date();
    return this.prisma.transportManagementReportDelivery.findMany({
      where: {
        status: "PENDING",
        availableAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      select: { id: true },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async claim(deliveryId: string, owner: string, leaseSeconds: number) {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const claimed = await this.prisma.transportManagementReportDelivery.updateMany({
      where: {
        id: deliveryId,
        status: "PENDING",
        availableAt: { lte: now },
        OR: [
          { leaseUntil: null },
          { leaseUntil: { lt: now } },
          { leaseOwner: owner },
        ],
      },
      data: {
        leaseOwner: owner,
        leaseUntil,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.transportManagementReportDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        destination: true,
        run: {
          select: {
            id: true,
            scheduleId: true,
            reportFilename: true,
          },
        },
      },
    });
  }

  async routingContext(item: {
    destination: {
      active: boolean;
      recipientAccountId: string;
      channel: string;
    };
  }) {
    if (!item.destination.active || item.destination.channel !== "EMAIL") {
      return { enabled: false, destinationRef: null as string | null };
    }
    const recipient = await this.prisma.user.findUnique({
      where: { id: item.destination.recipientAccountId },
      select: { email: true, role: true, status: true },
    });
    if (!recipient || recipient.role !== "ADMIN" || recipient.status !== "ACTIVE") {
      return { enabled: false, destinationRef: null as string | null };
    }
    return {
      enabled: true,
      destinationRef: recipient.email,
    };
  }

  async markSent(
    deliveryId: string,
    owner: string,
    runId: string,
    providerRef: string,
  ) {
    const now = new Date();
    const updated = await this.prisma.transportManagementReportDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: owner, status: "PENDING" },
      data: {
        status: "SENT",
        attemptedAt: now,
        sentAt: now,
        providerRef: providerRef.slice(0, 300),
        lastErrorCode: null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (updated.count === 1) await this.syncRunDeliveryStatus(runId);
    return updated.count === 1;
  }

  async markSkipped(deliveryId: string, owner: string, runId: string) {
    const updated = await this.prisma.transportManagementReportDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: owner, status: "PENDING" },
      data: {
        status: "SKIPPED",
        attemptedAt: new Date(),
        lastErrorCode: null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (updated.count === 1) await this.syncRunDeliveryStatus(runId);
    return updated.count === 1;
  }

  async requeue(
    deliveryId: string,
    owner: string,
    availableAt: Date,
    errorCode: string,
  ) {
    const updated = await this.prisma.transportManagementReportDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: owner, status: "PENDING" },
      data: {
        attemptedAt: new Date(),
        availableAt,
        lastErrorCode: errorCode.slice(0, 120),
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    return updated.count === 1;
  }

  async markFailed(
    deliveryId: string,
    owner: string,
    runId: string,
    errorCode: string,
  ) {
    const updated = await this.prisma.transportManagementReportDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: owner, status: "PENDING" },
      data: {
        status: "FAILED",
        attemptedAt: new Date(),
        failedAt: new Date(),
        lastErrorCode: errorCode.slice(0, 120),
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (updated.count === 1) await this.syncRunDeliveryStatus(runId);
    return updated.count === 1;
  }

  private async syncRunDeliveryStatus(runId: string) {
    const rows = await this.prisma.transportManagementReportDelivery.findMany({
      where: { runId },
      select: { status: true },
      take: 200,
    });
    if (!rows.length || rows.some((row) => row.status === "PENDING")) return;
    const failed = rows.some((row) => row.status === "FAILED");
    await this.prisma.transportManagementReportRun.update({
      where: { id: runId },
      data: {
        deliveryStatus: failed
          ? "DELIVERY_ATTENTION_REQUIRED"
          : "DELIVERY_NOTIFICATION_COMPLETE",
      },
    });
  }

  private channel(raw: unknown): "EMAIL" {
    if (raw == null || raw === "" || raw === "EMAIL") return "EMAIL";
    if (typeof raw === "string" && raw.trim().toUpperCase() === "EMAIL") {
      return "EMAIL";
    }
    throw new BadRequestException("Only EMAIL report delivery destinations are supported.");
  }

  private id(raw: unknown, field: string): string {
    if (typeof raw !== "string") {
      throw new BadRequestException(field + " is required.");
    }
    const value = raw.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(value)) {
      throw new BadRequestException(field + " is invalid.");
    }
    return value;
  }

  private text(raw: unknown, field: string): string {
    if (typeof raw !== "string") {
      throw new BadRequestException(field + " is required.");
    }
    const value = raw.trim();
    if (!/^[\x20-\x7E]{1,120}$/.test(value)) {
      throw new BadRequestException(
        field + " must contain 1 to 120 printable characters.",
      );
    }
    return value;
  }
}


@Injectable()
export class TransportReportDeliveryWorkerService {
  private static readonly LEASE_SECONDS = 60;
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly RETRY_BASE_SECONDS = 5;
  private static readonly MAX_RETRY_SECONDS = 15 * 60;

  constructor(
    private readonly outbox: TransportReportDeliveryOutboxService,
    private readonly gateway: NotificationGatewayService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async runOnce(limit = 25) {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const owner =
      "transport-report-delivery-" +
      process.pid +
      "-" +
      Date.now().toString(36);
    const result = {
      claimed: 0,
      sent: 0,
      skipped: 0,
      requeued: 0,
      failed: 0,
      artifactDeliveryPerformed: false,
    };

    const candidates = await this.outbox.recoverable(boundedLimit);
    for (const candidate of candidates) {
      const item = await this.outbox.claim(
        candidate.id,
        owner,
        TransportReportDeliveryWorkerService.LEASE_SECONDS,
      );
      if (!item) continue;
      result.claimed += 1;

      try {
        const routing = await this.outbox.routingContext(item);
        if (!routing.enabled || !routing.destinationRef) {
          if (await this.outbox.markSkipped(item.id, owner, item.runId)) {
            result.skipped += 1;
          }
          continue;
        }

        const sent = await this.gateway.send({
          notificationId: item.id,
          channel: "EMAIL",
          destinationRef: routing.destinationRef,
          locale: "en",
          safeTitleKey: "transport.report.ready.title",
          safeBodyKey: "transport.report.ready.body",
          entityType: "TRANSPORT_REPORT_RUN",
          entityId: item.runId,
        });
        if (
          await this.outbox.markSent(
            item.id,
            owner,
            item.runId,
            sent.reference,
          )
        ) {
          result.sent += 1;
        }
      } catch (error) {
        const errorCode = this.safeErrorCode(error);
        if (
          item.attemptCount >=
          TransportReportDeliveryWorkerService.MAX_ATTEMPTS
        ) {
          if (
            await this.outbox.markFailed(
              item.id,
              owner,
              item.runId,
              errorCode,
            )
          ) {
            result.failed += 1;
            await this.audit.write({
              actorId: "transport-report-delivery-worker",
              action: "TRANSPORT_REPORT_DELIVERY_NOTIFICATION_EXHAUSTED",
              objectType: "TRANSPORT_REPORT_DELIVERY",
              objectId: item.id,
              purpose: "TRANSPORT_OPERATIONS",
              result: "FAILED",
              metadata: {
                attemptCount: item.attemptCount,
                errorCode,
                artifactDeliveryPerformed: false,
              },
            }).catch(() => undefined);
          }
          continue;
        }

        const delaySeconds = Math.min(
          TransportReportDeliveryWorkerService.MAX_RETRY_SECONDS,
          TransportReportDeliveryWorkerService.RETRY_BASE_SECONDS *
            2 ** Math.max(0, item.attemptCount - 1),
        );
        if (
          await this.outbox.requeue(
            item.id,
            owner,
            new Date(Date.now() + delaySeconds * 1000),
            errorCode,
          )
        ) {
          result.requeued += 1;
        }
      }
    }

    return result;
  }

  private safeErrorCode(error: unknown) {
    const name =
      error instanceof Error ? error.constructor.name : "DeliveryError";
    return (
      name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) ||
      "DeliveryError"
    );
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportReportDeliveryController {
  constructor(private readonly service: TransportReportDeliveryOutboxService) {}

  @Get("report-destinations")
  destinations(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.destinations(principal);
  }

  @Post("report-destinations")
  createDestination(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: DestinationInput,
  ) {
    return this.service.createDestination(principal, body ?? {});
  }

  @Post("report-destinations/:destinationId/deactivate")
  deactivateDestination(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.deactivateDestination(principal, destinationId);
  }

  @Get("report-deliveries")
  deliveries(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.deliveries(principal);
  }

  @Get("report-inbox")
  inbox(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.inbox(principal);
  }
}

@Module({
  imports: [CommunicationsModule],
  controllers: [TransportReportDeliveryController],
  providers: [
    TransportReportDeliveryOutboxService,
    TransportReportDeliveryWorkerService,
  ],
  exports: [
    TransportReportDeliveryOutboxService,
    TransportReportDeliveryWorkerService,
  ],
})
export class TransportReportDeliveryModule {}
