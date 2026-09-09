import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

export type DurableNotificationChannel = "IN_APP" | "PUSH" | "EMAIL" | "SMS";

const APPOINTMENT_REMINDER_BODY_KEY = "notification.appointment.reminder.body";

export interface DurableNotificationWorkItem {
  id: string;
  notificationId: string;
  channel: DurableNotificationChannel;
  attemptCount: number;
  notification: {
    id: string;
    accountId: string;
    dedupeKey: string;
    safeTitleKey: string;
    safeBodyKey: string;
    entityType: string;
    entityId: string;
  };
}

export interface NotificationRoutingContext {
  enabled: boolean;
  locale: string;
  destinationRef?: string | undefined;
}

@Injectable()
export class NotificationOutboxStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async recoverable(limit: number): Promise<Array<{ id: string }>> {
    const now = new Date();
    return this.prisma.notificationDelivery.findMany({
      where: {
        status: "PENDING",
        availableAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      select: { id: true },
      orderBy: [{ availableAt: "asc" }, { attemptedAt: "asc" }],
      take: limit,
    });
  }

  async claim(deliveryId: string, owner: string, leaseSeconds: number): Promise<DurableNotificationWorkItem | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const claimed = await this.prisma.notificationDelivery.updateMany({
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
    const row = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: { notification: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      notificationId: row.notificationId,
      channel: row.channel,
      attemptCount: row.attemptCount,
      notification: {
        id: row.notification.id,
        accountId: row.notification.accountId,
        dedupeKey: row.notification.dedupeKey,
        safeTitleKey: row.notification.safeTitleKey,
        safeBodyKey: row.notification.safeBodyKey,
        entityType: row.notification.entityType,
        entityId: row.notification.entityId,
      },
    };
  }

  async routingContext(item: DurableNotificationWorkItem): Promise<NotificationRoutingContext> {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { accountId: item.notification.accountId },
    });
    const locale = preference?.locale ?? "en";

    if (item.notification.entityType === "APPOINTMENT" && item.notification.safeBodyKey === APPOINTMENT_REMINDER_BODY_KEY) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: item.notification.entityId },
        select: { status: true, startsAt: true, updatedAt: true },
      });
      const currentGeneration = appointment ? `:${appointment.updatedAt.getTime()}` : "";
      const stale = !appointment
        || appointment.status !== "CONFIRMED"
        || appointment.startsAt.getTime() <= Date.now()
        || !item.notification.dedupeKey.endsWith(currentGeneration);
      if (stale) return { enabled: false, locale };
    }

    const enabled = item.channel === "IN_APP"
      ? preference?.inAppEnabled ?? true
      : item.channel === "PUSH"
        ? preference?.pushEnabled ?? false
        : item.channel === "EMAIL"
          ? preference?.emailEnabled ?? false
          : preference?.smsEnabled ?? false;
    if (!enabled || item.channel === "IN_APP") return { enabled, locale };

    if (item.channel === "EMAIL") {
      const account = await this.prisma.user.findUnique({
        where: { id: item.notification.accountId },
        select: { email: true },
      });
      return { enabled, locale, destinationRef: account?.email || undefined };
    }

    const endpoint = await this.prisma.notificationEndpoint.findFirst({
      where: {
        accountId: item.notification.accountId,
        channel: item.channel,
        active: true,
      },
      select: { externalEndpointRef: true },
      orderBy: { updatedAt: "desc" },
    });
    return { enabled, locale, destinationRef: endpoint?.externalEndpointRef };
  }

  async markSent(deliveryId: string, owner: string, providerRef?: string): Promise<boolean> {
    const now = new Date();
    const updated = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: owner, status: "PENDING" },
      data: {
        status: "SENT",
        attemptedAt: now,
        sentAt: now,
        providerRef: providerRef?.slice(0, 300) || null,
        lastErrorCode: null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    return updated.count === 1;
  }

  async markSkipped(deliveryId: string, owner: string): Promise<boolean> {
    const updated = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: owner, status: "PENDING" },
      data: {
        status: "SKIPPED",
        attemptedAt: new Date(),
        lastErrorCode: null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    return updated.count === 1;
  }

  async requeue(deliveryId: string, owner: string, availableAt: Date, errorCode: string): Promise<boolean> {
    const updated = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: owner, status: "PENDING" },
      data: {
        attemptedAt: new Date(),
        availableAt,
        lastErrorCode: errorCode,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    return updated.count === 1;
  }

  async markFailed(deliveryId: string, owner: string, errorCode: string): Promise<boolean> {
    const updated = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: owner, status: "PENDING" },
      data: {
        status: "FAILED",
        attemptedAt: new Date(),
        lastErrorCode: errorCode,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    return updated.count === 1;
  }
}
