import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { NotificationEventType, UpdateNotificationPreferencesInput, RegisterNotificationEndpointInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { NotificationOutboxWorkerService } from "./notification-outbox-worker.service";

const SUPPORTED_LOCALES = new Set(["en", "ar", "fr", "es"]);
const SAFE_TEMPLATE_KEY = /^[a-z0-9._-]{3,120}$/i;
const OUTBOX_CHANNELS = ["IN_APP", "PUSH", "EMAIL", "SMS"] as const;

type NotificationInput = {
  accountId: string;
  dedupeKey: string;
  type: NotificationEventType;
  entityType: string;
  entityId: string;
  safeTitleKey: string;
  safeBodyKey: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly worker: NotificationOutboxWorkerService,
  ) {}

  async preferences(principal: AuthPrincipal) {
    return this.ensurePreferences(principal.accountId);
  }

  async updatePreferences(principal: AuthPrincipal, input: UpdateNotificationPreferencesInput) {
    const data: Record<string, unknown> = {};
    if (input.locale !== undefined) {
      if (!SUPPORTED_LOCALES.has(input.locale)) throw new BadRequestException("Unsupported notification locale.");
      data.locale = input.locale;
    }
    for (const key of ["inAppEnabled", "pushEnabled", "emailEnabled", "smsEnabled"] as const) {
      const value = input[key];
      if (value !== undefined) {
        if (typeof value !== "boolean") throw new BadRequestException(`${key} must be boolean.`);
        data[key] = value;
      }
    }
    const current = await this.ensurePreferences(principal.accountId);
    const updated = Object.keys(data).length === 0 ? current : await this.prisma.notificationPreference.update({ where: { accountId: principal.accountId }, data });
    await this.audit.write({ actorId: principal.accountId, action: "NOTIFICATION_PREFERENCES_UPDATED", objectType: "NOTIFICATION_PREFERENCE", objectId: updated.id, purpose: "USER_PREFERENCE", result: "SUCCESS" });
    return updated;
  }

  async registerEndpoint(principal: AuthPrincipal, input: RegisterNotificationEndpointInput) {
    if (input.channel !== "PUSH" && input.channel !== "SMS") throw new BadRequestException("Only PUSH and SMS external endpoints may be registered.");
    const ref = this.requiredText(input.externalEndpointRef, 8, 500, "externalEndpointRef");
    const endpoint = await this.prisma.notificationEndpoint.upsert({
      where: { accountId_channel_externalEndpointRef: { accountId: principal.accountId, channel: input.channel, externalEndpointRef: ref } },
      create: { accountId: principal.accountId, channel: input.channel, externalEndpointRef: ref, active: true },
      update: { active: true },
    });
    await this.audit.write({ actorId: principal.accountId, action: "NOTIFICATION_ENDPOINT_REGISTERED", objectType: "NOTIFICATION_ENDPOINT", objectId: endpoint.id, purpose: "USER_PREFERENCE", result: "SUCCESS", metadata: { channel: input.channel } });
    return this.presentEndpoint(endpoint);
  }

  async deactivateEndpoint(principal: AuthPrincipal, endpointId: string) {
    const endpoint = await this.prisma.notificationEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) throw new NotFoundException("Notification endpoint not found.");
    if (endpoint.accountId !== principal.accountId) throw new ForbiddenException("Notification endpoint access denied.");
    const updated = await this.prisma.notificationEndpoint.update({ where: { id: endpoint.id }, data: { active: false } });
    await this.audit.write({ actorId: principal.accountId, action: "NOTIFICATION_ENDPOINT_DEACTIVATED", objectType: "NOTIFICATION_ENDPOINT", objectId: endpoint.id, purpose: "USER_PREFERENCE", result: "SUCCESS", metadata: { channel: endpoint.channel } });
    return this.presentEndpoint(updated);
  }

  async endpoints(principal: AuthPrincipal) {
    const rows = await this.prisma.notificationEndpoint.findMany({ where: { accountId: principal.accountId }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => this.presentEndpoint(row));
  }

  async list(principal: AuthPrincipal) {
    const rows = await this.prisma.notificationEvent.findMany({
      where: { accountId: principal.accountId },
      include: { deliveries: { orderBy: { channel: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((row) => this.presentNotification(row));
  }

  async markRead(principal: AuthPrincipal, notificationId: string) {
    const updated = await this.prisma.notificationEvent.updateMany({ where: { id: notificationId, accountId: principal.accountId }, data: { readAt: new Date() } });
    if (updated.count === 0) throw new NotFoundException("Notification not found.");
    const row = await this.prisma.notificationEvent.findUnique({ where: { id: notificationId }, include: { deliveries: { orderBy: { channel: "asc" } } } });
    if (!row) throw new NotFoundException("Notification not found.");
    return this.presentNotification(row);
  }

  async notifyAccount(input: NotificationInput) {
    const notificationId = await this.prisma.$transaction(async (tx) => {
      const notification = await this.enqueueAccountInTransaction(tx, input);
      return notification.id;
    });
    this.worker.wake();
    return this.prisma.notificationEvent.findUnique({ where: { id: notificationId }, include: { deliveries: true } });
  }

  async enqueueAccountInTransaction(tx: Prisma.TransactionClient, input: NotificationInput) {
    const normalized = this.normalizedNotification(input);
    const notification = await tx.notificationEvent.upsert({
      where: { dedupeKey: normalized.dedupeKey },
      create: normalized,
      update: {},
    });
    await tx.notificationDelivery.createMany({
      data: OUTBOX_CHANNELS.map((channel) => ({
        notificationId: notification.id,
        channel,
        status: "PENDING" as const,
      })),
      skipDuplicates: true,
    });
    return notification;
  }

  wakeOutbox(): void {
    this.worker.wake();
  }

  private normalizedNotification(input: NotificationInput) {
    return {
      accountId: input.accountId,
      dedupeKey: `${input.accountId}:${this.requiredText(input.dedupeKey, 3, 180, "dedupeKey")}`,
      type: input.type,
      entityType: this.requiredText(input.entityType, 2, 80, "entityType"),
      entityId: this.requiredText(input.entityId, 1, 180, "entityId"),
      safeTitleKey: this.safeTemplateKey(input.safeTitleKey, "safeTitleKey"),
      safeBodyKey: this.safeTemplateKey(input.safeBodyKey, "safeBodyKey"),
    };
  }

  private async ensurePreferences(accountId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { accountId },
      create: { accountId },
      update: {},
    });
  }

  private presentEndpoint(endpoint: { id: string; channel: string; active: boolean; createdAt: Date; updatedAt: Date }) {
    return { id: endpoint.id, channel: endpoint.channel, active: endpoint.active, externalEndpointReferenceStoredExternally: true, createdAt: endpoint.createdAt, updatedAt: endpoint.updatedAt };
  }

  private presentNotification(notification: {
    id: string;
    type: string;
    entityType: string;
    entityId: string;
    safeTitleKey: string;
    safeBodyKey: string;
    readAt: Date | null;
    createdAt: Date;
    deliveries: Array<{ channel: string; status: string; attemptedAt: Date | null }>;
  }) {
    return {
      id: notification.id,
      type: notification.type,
      entityType: notification.entityType,
      entityId: notification.entityId,
      safeTitleKey: notification.safeTitleKey,
      safeBodyKey: notification.safeBodyKey,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      deliveries: notification.deliveries.map((delivery) => ({ channel: delivery.channel, status: delivery.status, attemptedAt: delivery.attemptedAt })),
    };
  }

  private safeTemplateKey(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_TEMPLATE_KEY.test(value)) throw new BadRequestException(`${field} must be a safe template key.`);
    return value;
  }

  private requiredText(value: unknown, min: number, max: number, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (text.length < min || text.length > max) throw new BadRequestException(`${field} must contain between ${min} and ${max} characters.`);
    return text;
  }
}
