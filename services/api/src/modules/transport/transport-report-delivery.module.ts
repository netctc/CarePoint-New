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
      executionMode: "EXTERNAL_DELIVERY_ADAPTER_REQUIRED",
      reportDeliveryPerformed: false,
      items,
    };
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
}

@Module({
  controllers: [TransportReportDeliveryController],
  providers: [TransportReportDeliveryOutboxService],
  exports: [TransportReportDeliveryOutboxService],
})
export class TransportReportDeliveryModule {}
