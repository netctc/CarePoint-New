import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { NotificationEventType, UpdateNotificationPreferencesInput, RegisterNotificationEndpointInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { NotificationGatewayService } from "./notification-gateway.service";

const SUPPORTED_LOCALES = new Set(["en", "ar", "fr", "es"]);
const SAFE_TEMPLATE_KEY = /^[a-z0-9._-]{3,120}$/i;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly gateway: NotificationGatewayService,
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
    return this.prisma.notificationEvent.findMany({
      where: { accountId: principal.accountId },
      include: { deliveries: { orderBy: { channel: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async markRead(principal: AuthPrincipal, notificationId: string) {
    const updated = await this.prisma.notificationEvent.updateMany({ where: { id: notificationId, accountId: principal.accountId }, data: { readAt: new Date() } });
    if (updated.count === 0) throw new NotFoundException("Notification not found.");
    return this.prisma.notificationEvent.findUnique({ where: { id: notificationId }, include: { deliveries: true } });
  }

  async notifyAccount(input: {
    accountId: string;
    dedupeKey: string;
    type: NotificationEventType;
    entityType: string;
    entityId: string;
    safeTitleKey: string;
    safeBodyKey: string;
  }) {
    const dedupeKey = `${input.accountId}:${this.requiredText(input.dedupeKey, 3, 180, "dedupeKey")}`;
    const safeTitleKey = this.safeTemplateKey(input.safeTitleKey, "safeTitleKey");
    const safeBodyKey = this.safeTemplateKey(input.safeBodyKey, "safeBodyKey");
    const entityType = this.requiredText(input.entityType, 2, 80, "entityType");
    const entityId = this.requiredText(input.entityId, 1, 180, "entityId");
    const notification = await this.prisma.notificationEvent.upsert({
      where: { dedupeKey },
      create: { accountId: input.accountId, dedupeKey, type: input.type, entityType, entityId, safeTitleKey, safeBodyKey },
      update: {},
      include: { deliveries: true },
    });
    if (notification.deliveries.length > 0) return notification;
    await this.deliver(notification.id, input.accountId, { safeTitleKey, safeBodyKey, entityType, entityId });
    return this.prisma.notificationEvent.findUnique({ where: { id: notification.id }, include: { deliveries: true } });
  }

  private async deliver(notificationId: string, accountId: string, safe: { safeTitleKey: string; safeBodyKey: string; entityType: string; entityId: string }) {
    const preference = await this.ensurePreferences(accountId);
    await this.persistDelivery(notificationId, "IN_APP", preference.inAppEnabled ? "SENT" : "SKIPPED");

    const endpointRows = await this.prisma.notificationEndpoint.findMany({ where: { accountId, active: true } });
    const endpointByChannel = new Map(endpointRows.map((item) => [item.channel, item.externalEndpointRef]));
    const user = await this.prisma.user.findUnique({ where: { id: accountId }, select: { email: true } });
    if (!user) throw new NotFoundException("Notification recipient account not found.");

    const external: Array<{ channel: "PUSH" | "EMAIL" | "SMS"; enabled: boolean; destinationRef: string | undefined }> = [
      { channel: "PUSH", enabled: preference.pushEnabled, destinationRef: endpointByChannel.get("PUSH") },
      { channel: "EMAIL", enabled: preference.emailEnabled, destinationRef: user.email },
      { channel: "SMS", enabled: preference.smsEnabled, destinationRef: endpointByChannel.get("SMS") },
    ];

    for (const item of external) {
      if (!item.enabled || !item.destinationRef) {
        await this.persistDelivery(notificationId, item.channel, "SKIPPED");
        continue;
      }
      try {
        const sent = await this.gateway.send({ notificationId, channel: item.channel, destinationRef: item.destinationRef, locale: preference.locale, ...safe });
        await this.persistDelivery(notificationId, item.channel, "SENT", sent.reference);
      } catch (error) {
        const code = error instanceof Error ? error.constructor.name.slice(0, 80) : "DELIVERY_FAILED";
        await this.persistDelivery(notificationId, item.channel, "FAILED", undefined, code);
      }
    }
  }

  private async persistDelivery(notificationId: string, channel: "IN_APP" | "PUSH" | "EMAIL" | "SMS", status: "SENT" | "FAILED" | "SKIPPED", providerRef?: string, lastErrorCode?: string) {
    return this.prisma.notificationDelivery.upsert({
      where: { notificationId_channel: { notificationId, channel } },
      create: {
        notificationId,
        channel,
        status,
        attemptedAt: new Date(),
        ...(providerRef ? { providerRef } : {}),
        ...(lastErrorCode ? { lastErrorCode } : {}),
      },
      update: {},
    });
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
