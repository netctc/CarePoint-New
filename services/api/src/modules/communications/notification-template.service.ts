import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

const LOCALES = ["en", "ar", "fr", "es"] as const;
const SAFE_TEMPLATE_KEY = /^[a-z0-9._-]{3,120}$/i;
const PROHIBITED_TEMPLATE_TEXT = /\{|\}|\$\{|%s|https?:\/\/|\bdiagnos|\bprescription|\bmedication|\bclinical note|\bclaim\b|\bmessage body\b/i;

type Locale = (typeof LOCALES)[number];
export type NotificationTemplateTranslations = Record<Locale, string>;

export interface CreateNotificationTemplateInput {
  key: string;
  translations: NotificationTemplateTranslations;
}

export interface PublishNotificationTemplateVersionInput {
  expectedVersion: number;
  translations: NotificationTemplateTranslations;
}

@Injectable()
export class NotificationTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async list() {
    const templates = await this.prisma.notificationTemplate.findMany({ orderBy: { key: "asc" } });
    const versions = await this.prisma.notificationTemplateVersion.findMany({
      where: { templateId: { in: templates.map((row) => row.id) } },
      orderBy: [{ templateId: "asc" }, { version: "desc" }, { locale: "asc" }],
    });
    const byTemplate = new Map<string, typeof versions>();
    for (const row of versions) {
      const list = byTemplate.get(row.templateId) ?? [];
      list.push(row);
      byTemplate.set(row.templateId, list);
    }
    return templates.map((template) => ({
      id: template.id,
      key: template.key,
      active: template.active,
      currentVersion: template.currentVersion,
      currentTranslations: this.translations(
        (byTemplate.get(template.id) ?? []).filter((row) => row.version === template.currentVersion),
      ),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }));
  }

  async create(principal: AuthPrincipal, input: CreateNotificationTemplateInput) {
    const key = this.key(input?.key);
    const translations = this.safeTranslations(input?.translations);
    try {
      const template = await this.prisma.$transaction(async (tx) => {
        const anchor = await tx.notificationTemplate.create({ data: { key, currentVersion: 1, active: true } });
        await tx.notificationTemplateVersion.createMany({
          data: LOCALES.map((locale) => ({
            templateId: anchor.id,
            version: 1,
            locale,
            text: translations[locale],
            createdByActorId: principal.accountId,
          })),
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "NOTIFICATION_TEMPLATE_CREATED",
          objectType: "NOTIFICATION_TEMPLATE",
          objectId: anchor.id,
          result: "SUCCESS",
          metadata: { key, version: 1, locales: [...LOCALES], phiSafeStaticText: true },
        });
        return anchor;
      });
      return this.present(template.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Notification template key already exists.");
      }
      throw error;
    }
  }

  async publishVersion(
    principal: AuthPrincipal,
    templateIdInput: string,
    input: PublishNotificationTemplateVersionInput,
  ) {
    const templateId = this.id(templateIdInput, "templateId");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    const translations = this.safeTranslations(input?.translations);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "NotificationTemplate" WHERE id = ${templateId} FOR UPDATE`);
      const current = await tx.notificationTemplate.findUnique({ where: { id: templateId } });
      if (!current) throw new NotFoundException("Notification template not found.");
      if (current.currentVersion !== expectedVersion) {
        throw new ConflictException({
          message: "Notification template version conflict.",
          currentVersion: current.currentVersion,
        });
      }
      const version = current.currentVersion + 1;
      await tx.notificationTemplateVersion.createMany({
        data: LOCALES.map((locale) => ({
          templateId,
          version,
          locale,
          text: translations[locale],
          createdByActorId: principal.accountId,
        })),
      });
      const anchor = await tx.notificationTemplate.update({ where: { id: templateId }, data: { currentVersion: version } });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "NOTIFICATION_TEMPLATE_VERSION_PUBLISHED",
        objectType: "NOTIFICATION_TEMPLATE",
        objectId: templateId,
        result: "SUCCESS",
        metadata: { key: current.key, version, locales: [...LOCALES], phiSafeStaticText: true },
      });
      return anchor;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.present(updated.id);
  }

  async render(keyInput: string, versionInput: number, localeInput: string) {
    const key = this.key(keyInput);
    const version = this.positiveInteger(versionInput, "version");
    const locale = this.locale(localeInput);
    const template = await this.prisma.notificationTemplate.findUnique({ where: { key } });
    if (!template) throw new NotFoundException("Notification template not found.");
    const row = await this.prisma.notificationTemplateVersion.findUnique({
      where: { templateId_version_locale: { templateId: template.id, version, locale } },
    });
    if (!row) throw new NotFoundException("Notification template version not found.");
    return { key, version, locale, text: row.text };
  }

  private async present(templateId: string) {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException("Notification template not found.");
    const rows = await this.prisma.notificationTemplateVersion.findMany({
      where: { templateId, version: template.currentVersion },
      orderBy: { locale: "asc" },
    });
    return {
      id: template.id,
      key: template.key,
      active: template.active,
      currentVersion: template.currentVersion,
      translations: this.translations(rows),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  private translations(rows: Array<{ locale: string; text: string }>) {
    return Object.fromEntries(rows.map((row) => [row.locale, row.text]));
  }

  private safeTranslations(value: unknown): NotificationTemplateTranslations {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("translations must contain en, ar, fr and es static text.");
    }
    const translations = value as Record<string, unknown>;
    const normalized = {} as NotificationTemplateTranslations;
    for (const locale of LOCALES) normalized[locale] = this.safeText(translations[locale], locale);
    const extra = Object.keys(translations).filter((key) => !LOCALES.includes(key as Locale));
    if (extra.length > 0) throw new BadRequestException("Unsupported notification template locale.");
    return normalized;
  }

  private safeText(value: unknown, locale: string): string {
    if (typeof value !== "string") throw new BadRequestException(`translations.${locale} must be text.`);
    const text = value.trim();
    if (!text || text.length > 240) throw new BadRequestException(`translations.${locale} must contain 1-240 characters.`);
    if (PROHIBITED_TEMPLATE_TEXT.test(text)) {
      throw new BadRequestException(`translations.${locale} must be PHI-neutral fixed text with no placeholders or sensitive clinical terms.`);
    }
    return text;
  }

  private key(value: unknown): string {
    if (typeof value !== "string" || !SAFE_TEMPLATE_KEY.test(value)) throw new BadRequestException("Template key is invalid.");
    return value;
  }

  private locale(value: unknown): Locale {
    if (typeof value !== "string" || !LOCALES.includes(value as Locale)) throw new BadRequestException("Unsupported notification locale.");
    return value as Locale;
  }

  private id(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }
}
