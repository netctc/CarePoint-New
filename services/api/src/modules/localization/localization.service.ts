import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

export const SUPPORTED_LOCALES = ["en", "ar", "fr", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const CATALOG_CODE = "GLOBAL";
const MAX_BUNDLE_KEYS = 500;

export interface LocalizationBundleQuery {
  locale?: string;
  namespace?: string;
  keys?: string;
  limit?: string;
}

export interface CreateTranslationKeyInput {
  key: string;
  namespace?: string;
  textEn: string;
  textAr?: string | null;
  textFr?: string | null;
  textEs?: string | null;
  reasonCode?: string;
}

export interface PublishTranslationVersionInput {
  expectedVersion: number;
  textEn: string;
  textAr?: string | null;
  textFr?: string | null;
  textEs?: string | null;
  reasonCode: string;
}

type TranslationTexts = {
  textEn: string;
  textAr: string | null;
  textFr: string | null;
  textEs: string | null;
};

@Injectable()
export class LocalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async bundle(query: LocalizationBundleQuery) {
    const locale = this.locale(query?.locale);
    const namespace = query?.namespace ? this.namespace(query.namespace) : null;
    const requestedKeys = this.keyList(query?.keys);
    const limit = this.limit(query?.limit);
    const catalog = await this.prisma.localizationCatalog.findUnique({ where: { code: CATALOG_CODE } });
    if (!catalog) throw new NotFoundException("Localization catalog is not initialized.");

    const keyRows = await this.prisma.translationKey.findMany({
      where: {
        active: true,
        ...(namespace ? { namespace } : {}),
        ...(requestedKeys ? { key: { in: requestedKeys } } : {}),
      },
      select: { id: true, key: true, namespace: true, currentVersion: true },
      orderBy: { key: "asc" },
      take: requestedKeys ? Math.min(requestedKeys.length, MAX_BUNDLE_KEYS) : limit,
    });

    const versions = keyRows.length
      ? await this.prisma.translationVersion.findMany({
        where: { OR: keyRows.map((row) => ({ translationKeyId: row.id, version: row.currentVersion })) },
        select: {
          translationKeyId: true,
          version: true,
          textEn: true,
          textAr: true,
          textFr: true,
          textEs: true,
        },
      })
      : [];
    const versionByKeyId = new Map(versions.map((row) => [row.translationKeyId, row]));

    const items = keyRows.map((row) => {
      const version = versionByKeyId.get(row.id);
      if (!version) return this.keyFallback(row.key, row.namespace);
      const resolved = this.resolveText(locale, version);
      return {
        key: row.key,
        namespace: row.namespace,
        value: resolved.value,
        sourceLocale: resolved.sourceLocale,
        translationVersion: version.version,
      };
    });

    if (requestedKeys) {
      const existing = new Set(keyRows.map((row) => row.key));
      for (const key of requestedKeys) {
        if (!existing.has(key)) items.push(this.keyFallback(key, namespace ?? this.namespaceFromKey(key)));
      }
      items.sort((a, b) => a.key.localeCompare(b.key));
    }

    return {
      catalogVersion: catalog.currentVersion,
      locale,
      direction: locale === "ar" ? "rtl" : "ltr",
      fallbackLocale: "en",
      generatedAt: new Date().toISOString(),
      items,
    };
  }

  async listAdmin() {
    const catalog = await this.prisma.localizationCatalog.findUnique({ where: { code: CATALOG_CODE } });
    if (!catalog) throw new NotFoundException("Localization catalog is not initialized.");
    const keys = await this.prisma.translationKey.findMany({ orderBy: [{ namespace: "asc" }, { key: "asc" }] });
    const items = await Promise.all(keys.map(async (row) => ({
      ...row,
      version: await this.prisma.translationVersion.findUnique({
        where: { translationKeyId_version: { translationKeyId: row.id, version: row.currentVersion } },
      }),
    })));
    return { catalogVersion: catalog.currentVersion, items };
  }

  async create(principal: AuthPrincipal, input: CreateTranslationKeyInput) {
    const key = this.key(input?.key);
    const namespace = input?.namespace ? this.namespace(input.namespace) : this.namespaceFromKey(key);
    const texts = this.texts(input);
    const reasonCode = this.optionalReason(input?.reasonCode);

    try {
      const createdId = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        const catalog = await this.lockCatalog(tx);
        const row = await tx.translationKey.create({
          data: { key, namespace, currentVersion: 1, active: true },
        });
        await tx.translationVersion.create({
          data: {
            translationKeyId: row.id,
            version: 1,
            ...texts,
            createdByActorId: principal.accountId,
            reasonCode,
          },
        });
        const nextCatalogVersion = catalog.currentVersion + 1;
        await tx.localizationCatalog.update({
          where: { id: catalog.id },
          data: { currentVersion: nextCatalogVersion },
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "TRANSLATION_KEY_CREATED",
          objectType: "TRANSLATION_KEY",
          objectId: row.id,
          result: "SUCCESS",
          metadata: { key, namespace, translationVersion: 1, catalogVersion: nextCatalogVersion, reasonCode },
        });
        return row.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.adminEntry(createdId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Translation key already exists.");
      }
      throw error;
    }
  }

  async publish(principal: AuthPrincipal, translationKeyIdInput: string, input: PublishTranslationVersionInput) {
    const translationKeyId = this.identifier(translationKeyIdInput, "translationKeyId");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    const texts = this.texts(input);
    const reasonCode = this.reason(input?.reasonCode);

    await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      const catalog = await this.lockCatalog(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "TranslationKey" WHERE id = ${translationKeyId} FOR UPDATE`);
      const current = await tx.translationKey.findUnique({ where: { id: translationKeyId } });
      if (!current) throw new NotFoundException("Translation key not found.");
      if (current.currentVersion !== expectedVersion) {
        throw new ConflictException({ message: "Translation version conflict.", currentVersion: current.currentVersion });
      }
      const nextVersion = current.currentVersion + 1;
      await tx.translationVersion.create({
        data: {
          translationKeyId,
          version: nextVersion,
          ...texts,
          createdByActorId: principal.accountId,
          reasonCode,
        },
      });
      await tx.translationKey.update({ where: { id: translationKeyId }, data: { currentVersion: nextVersion } });
      const nextCatalogVersion = catalog.currentVersion + 1;
      await tx.localizationCatalog.update({ where: { id: catalog.id }, data: { currentVersion: nextCatalogVersion } });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "TRANSLATION_VERSION_PUBLISHED",
        objectType: "TRANSLATION_KEY",
        objectId: translationKeyId,
        result: "SUCCESS",
        metadata: {
          key: current.key,
          previousVersion: current.currentVersion,
          translationVersion: nextVersion,
          catalogVersion: nextCatalogVersion,
          reasonCode,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.adminEntry(translationKeyId);
  }

  private async adminEntry(id: string) {
    const row = await this.prisma.translationKey.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Translation key not found.");
    const version = await this.prisma.translationVersion.findUnique({
      where: { translationKeyId_version: { translationKeyId: id, version: row.currentVersion } },
    });
    return { ...row, version };
  }

  private async lockCatalog(tx: Prisma.TransactionClient) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LocalizationCatalog" WHERE code = ${CATALOG_CODE} FOR UPDATE`);
    const catalog = await tx.localizationCatalog.findUnique({ where: { code: CATALOG_CODE } });
    if (!catalog) throw new NotFoundException("Localization catalog is not initialized.");
    return catalog;
  }

  private resolveText(locale: SupportedLocale, version: TranslationTexts) {
    const requested = locale === "ar"
      ? version.textAr
      : locale === "fr"
        ? version.textFr
        : locale === "es"
          ? version.textEs
          : version.textEn;
    const normalized = requested?.trim();
    if (normalized) return { value: normalized, sourceLocale: locale };
    return { value: version.textEn, sourceLocale: "en" as const };
  }

  private keyFallback(key: string, namespace: string) {
    return { key, namespace, value: key, sourceLocale: "key" as const, translationVersion: null };
  }

  private texts(input: { textEn?: string; textAr?: string | null; textFr?: string | null; textEs?: string | null }): TranslationTexts {
    return {
      textEn: this.requiredText(input?.textEn, "textEn"),
      textAr: this.optionalText(input?.textAr, "textAr"),
      textFr: this.optionalText(input?.textFr, "textFr"),
      textEs: this.optionalText(input?.textEs, "textEs"),
    };
  }

  private locale(value: unknown): SupportedLocale {
    if (value === undefined || value === null || value === "") return "en";
    if (typeof value !== "string") throw new BadRequestException("locale is invalid.");
    const base = value.trim().toLowerCase().split(/[-_]/)[0];
    if (!SUPPORTED_LOCALES.includes(base as SupportedLocale)) return "en";
    return base as SupportedLocale;
  }

  private keyList(value: unknown): string[] | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("keys is invalid.");
    const keys = [...new Set(value.split(",").map((part) => this.key(part)).filter(Boolean))];
    if (keys.length === 0 || keys.length > MAX_BUNDLE_KEYS) throw new BadRequestException(`keys must contain between 1 and ${MAX_BUNDLE_KEYS} entries.`);
    return keys;
  }

  private key(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("translation key is required.");
    const normalized = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,159}$/.test(normalized)) throw new BadRequestException("translation key is invalid.");
    return normalized;
  }

  private namespace(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("namespace is required.");
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(normalized)) throw new BadRequestException("namespace is invalid.");
    return normalized;
  }

  private namespaceFromKey(key: string) {
    const first = key.split(/[.:]/)[0]?.toLowerCase() || "common";
    return /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(first) ? first : "common";
  }

  private requiredText(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > 1000) throw new BadRequestException(`${field} must contain 1-1000 characters.`);
    return normalized;
  }

  private optionalText(value: unknown, field: string) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} is invalid.`);
    const normalized = value.trim();
    if (normalized.length > 1000) throw new BadRequestException(`${field} must contain at most 1000 characters.`);
    return normalized || null;
  }

  private limit(value: unknown) {
    if (value === undefined || value === null || value === "") return MAX_BUNDLE_KEYS;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BUNDLE_KEYS) {
      throw new BadRequestException(`limit must be an integer between 1 and ${MAX_BUNDLE_KEYS}.`);
    }
    return parsed;
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private positiveInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private reason(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("reasonCode is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9_.:-]{2,80}$/.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
    return normalized;
  }

  private optionalReason(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    return this.reason(value);
  }
}
