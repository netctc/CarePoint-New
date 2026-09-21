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
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ClinicalProfileSchemaStatus, Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash } from "node:crypto";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const SUPPORTED_LOCALES = ["en", "ar", "fr", "es"] as const;
const SUPPORTED_FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "DATE",
  "BOOLEAN",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "NUMBER",
] as const;
const MAX_SCHEMA_BYTES = 128 * 1024;
const MAX_SECTIONS = 40;
const MAX_FIELDS_PER_SECTION = 80;
const MAX_OPTIONS_PER_FIELD = 100;

type Locale = (typeof SUPPORTED_LOCALES)[number];
type FieldType = (typeof SUPPORTED_FIELD_TYPES)[number];
type Labels = Record<Locale, string>;
type ClinicalProfileOption = { value: string; labels: Labels };
type ClinicalProfileField = {
  key: string;
  labels: Labels;
  type: FieldType;
  required: boolean;
  enabled: boolean;
  unit?: string;
  min?: number;
  max?: number;
  options?: ClinicalProfileOption[];
};
type ClinicalProfileSection = {
  key: string;
  labels: Labels;
  enabled: boolean;
  order: number;
  fields: ClinicalProfileField[];
};
type ClinicalProfileDefinition = {
  sections: ClinicalProfileSection[];
};
type SchemaValidation = {
  definition: ClinicalProfileDefinition | null;
  errors: string[];
};

type ListQuery = {
  jurisdiction?: string;
  status?: string;
  version?: string;
};

@Injectable()
class AdminClinicalProfileSchemaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async list(principal: AuthPrincipal, query: ListQuery) {
    this.requireAdmin(principal);
    const jurisdiction = query.jurisdiction ? this.jurisdiction(query.jurisdiction) : undefined;
    const status = query.status ? this.status(query.status) : undefined;
    const version = query.version ? this.integer(query.version, "version", 1, 100_000) : undefined;

    const schemas = await this.prisma.clinicalProfileSchema.findMany({
      where: {
        ...(jurisdiction ? { jurisdiction } : {}),
        ...(status ? { status } : {}),
        ...(version ? { version } : {}),
      },
      orderBy: [{ jurisdiction: "asc" }, { version: "desc" }],
      take: 200,
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_CLINICAL_PROFILE_SCHEMA_LISTED",
      objectType: "CLINICAL_PROFILE_SCHEMA",
      purpose: "CLINICAL_CONFIGURATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        jurisdictionFilterApplied: Boolean(jurisdiction),
        statusFilterApplied: Boolean(status),
        versionFilterApplied: Boolean(version),
        returned: schemas.length,
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      constraints: {
        supportedLocales: [...SUPPORTED_LOCALES],
        supportedFieldTypes: [...SUPPORTED_FIELD_TYPES],
        publishedSchemasImmutable: true,
        oneActiveSchemaPerJurisdiction: true,
      },
      items: schemas.map((schema) => this.toResponse(schema)),
    };
  }

  async create(principal: AuthPrincipal, body: Record<string, unknown>) {
    this.requireAdmin(principal);
    const jurisdiction = this.jurisdiction(body.jurisdiction);
    const rawDefinition = this.requireDefinition(body.definition);
    const validation = this.validateDefinition(rawDefinition);
    const definition = validation.definition ?? this.safeDraftDefinition(rawDefinition);
    const definitionHash = this.hash(definition);

    const created = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.clinicalProfileSchema.findFirst({
        where: { jurisdiction },
        orderBy: { version: "desc" },
        select: { id: true, version: true },
      });
      return tx.clinicalProfileSchema.create({
        data: {
          jurisdiction,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          definition: definition as unknown as Prisma.InputJsonValue,
          definitionHash,
          validationErrors: validation.errors as unknown as Prisma.InputJsonValue,
          validatedAt: validation.errors.length === 0 ? new Date() : null,
          supersedesSchemaId: latest?.id ?? null,
          createdByAccountId: principal.accountId,
          updatedByAccountId: principal.accountId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_CLINICAL_PROFILE_SCHEMA_CREATED",
      objectType: "CLINICAL_PROFILE_SCHEMA",
      objectId: created.id,
      purpose: "CLINICAL_CONFIGURATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        jurisdiction,
        version: created.version,
        validationErrorCount: validation.errors.length,
        definitionHash,
      },
    });

    return this.toResponse(created);
  }

  async mutate(principal: AuthPrincipal, body: Record<string, unknown>) {
    this.requireAdmin(principal);
    const schemaId = this.identifier(body.schemaId, "schemaId");
    const action = this.action(body.action);
    const existing = await this.prisma.clinicalProfileSchema.findUnique({ where: { id: schemaId } });
    if (!existing) throw new NotFoundException("Clinical profile schema was not found.");

    if (action === "UPDATE_DRAFT") {
      if (existing.status !== "DRAFT") {
        throw new ConflictException("Published or retired clinical profile schemas are immutable. Create a new version instead.");
      }
      const rawDefinition = this.requireDefinition(body.definition);
      const validation = this.validateDefinition(rawDefinition);
      const definition = validation.definition ?? this.safeDraftDefinition(rawDefinition);
      const definitionHash = this.hash(definition);
      const updated = await this.prisma.clinicalProfileSchema.update({
        where: { id: existing.id },
        data: {
          definition: definition as unknown as Prisma.InputJsonValue,
          definitionHash,
          validationErrors: validation.errors as unknown as Prisma.InputJsonValue,
          validatedAt: validation.errors.length === 0 ? new Date() : null,
          updatedByAccountId: principal.accountId,
        },
      });
      await this.auditMutation(principal, updated.id, "UPDATED", updated.jurisdiction, updated.version, {
        validationErrorCount: validation.errors.length,
        definitionHash,
      });
      return this.toResponse(updated);
    }

    const validation = this.validateDefinition(existing.definition);
    if (action === "VALIDATE") {
      const updated = await this.prisma.clinicalProfileSchema.update({
        where: { id: existing.id },
        data: {
          validationErrors: validation.errors as unknown as Prisma.InputJsonValue,
          validatedAt: validation.errors.length === 0 ? new Date() : null,
          updatedByAccountId: principal.accountId,
        },
      });
      await this.auditMutation(principal, updated.id, "VALIDATED", updated.jurisdiction, updated.version, {
        validationErrorCount: validation.errors.length,
      });
      return this.toResponse(updated);
    }

    if (action === "PUBLISH") {
      if (existing.status === "ACTIVE") return this.toResponse(existing);
      if (existing.status !== "DRAFT") {
        throw new ConflictException("A retired schema cannot be republished. Create a new draft version instead.");
      }
      if (validation.errors.length > 0) {
        throw new BadRequestException({
          message: "The clinical profile schema cannot be published until validation errors are resolved.",
          validationErrors: validation.errors,
        });
      }

      const now = new Date();
      const published = await this.prisma.$transaction(async (tx) => {
        await tx.clinicalProfileSchema.updateMany({
          where: { jurisdiction: existing.jurisdiction, status: "ACTIVE", id: { not: existing.id } },
          data: {
            status: "RETIRED",
            retiredAt: now,
            updatedByAccountId: principal.accountId,
          },
        });
        return tx.clinicalProfileSchema.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            validationErrors: [] as unknown as Prisma.InputJsonValue,
            validatedAt: now,
            publishedAt: now,
            retiredAt: null,
            updatedByAccountId: principal.accountId,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      await this.auditMutation(principal, published.id, "PUBLISHED", published.jurisdiction, published.version, {
        definitionHash: published.definitionHash,
      });
      return this.toResponse(published);
    }

    if (existing.status === "RETIRED") return this.toResponse(existing);
    if (existing.status === "DRAFT") {
      throw new ConflictException("Draft schemas are not retired. Leave the draft unpublished or replace it with a new draft version.");
    }
    const retired = await this.prisma.clinicalProfileSchema.update({
      where: { id: existing.id },
      data: {
        status: "RETIRED",
        retiredAt: new Date(),
        updatedByAccountId: principal.accountId,
      },
    });
    await this.auditMutation(principal, retired.id, "RETIRED", retired.jurisdiction, retired.version, {});
    return this.toResponse(retired);
  }

  private async auditMutation(
    principal: AuthPrincipal,
    schemaId: string,
    verb: string,
    jurisdiction: string,
    version: number,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.write({
      actorId: principal.accountId,
      action: `ADMIN_CLINICAL_PROFILE_SCHEMA_${verb}`,
      objectType: "CLINICAL_PROFILE_SCHEMA",
      objectId: schemaId,
      purpose: "CLINICAL_CONFIGURATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { jurisdiction, version, ...metadata },
    });
  }

  private toResponse(schema: {
    id: string;
    jurisdiction: string;
    version: number;
    status: ClinicalProfileSchemaStatus;
    definition: Prisma.JsonValue;
    definitionHash: string;
    validationErrors: Prisma.JsonValue | null;
    validatedAt: Date | null;
    publishedAt: Date | null;
    retiredAt: Date | null;
    supersedesSchemaId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      schemaId: schema.id,
      jurisdiction: schema.jurisdiction,
      version: schema.version,
      status: schema.status,
      immutable: schema.status !== "DRAFT",
      definition: schema.definition,
      definitionHash: schema.definitionHash,
      validationErrors: Array.isArray(schema.validationErrors) ? schema.validationErrors : [],
      validatedAt: schema.validatedAt?.toISOString() ?? null,
      publishedAt: schema.publishedAt?.toISOString() ?? null,
      retiredAt: schema.retiredAt?.toISOString() ?? null,
      supersedesSchemaId: schema.supersedesSchemaId,
      createdAt: schema.createdAt.toISOString(),
      updatedAt: schema.updatedAt.toISOString(),
    };
  }

  private validateDefinition(value: unknown): SchemaValidation {
    const errors: string[] = [];
    if (!this.isObject(value)) return { definition: null, errors: ["definition must be an object."] };
    const encoded = JSON.stringify(value);
    if (encoded.length > MAX_SCHEMA_BYTES) return { definition: null, errors: [`definition exceeds ${MAX_SCHEMA_BYTES} bytes.`] };
    if (!Array.isArray(value.sections)) return { definition: null, errors: ["definition.sections must be an array."] };
    if (value.sections.length === 0) errors.push("At least one section is required.");
    if (value.sections.length > MAX_SECTIONS) errors.push(`No more than ${MAX_SECTIONS} sections are allowed.`);

    const sections: ClinicalProfileSection[] = [];
    const sectionKeys = new Set<string>();
    value.sections.slice(0, MAX_SECTIONS).forEach((rawSection, sectionIndex) => {
      const prefix = `sections[${sectionIndex}]`;
      if (!this.isObject(rawSection)) {
        errors.push(`${prefix} must be an object.`);
        return;
      }
      const key = this.safeKey(rawSection.key, `${prefix}.key`, errors);
      if (key && sectionKeys.has(key)) errors.push(`${prefix}.key duplicates section key '${key}'.`);
      if (key) sectionKeys.add(key);
      const labels = this.labels(rawSection.labels, `${prefix}.labels`, errors);
      const enabled = this.boolean(rawSection.enabled, true, `${prefix}.enabled`, errors);
      const order = this.number(rawSection.order, sectionIndex + 1, `${prefix}.order`, errors, 0, 10_000);
      const rawFields = Array.isArray(rawSection.fields) ? rawSection.fields : [];
      if (!Array.isArray(rawSection.fields)) errors.push(`${prefix}.fields must be an array.`);
      if (rawFields.length === 0) errors.push(`${prefix}.fields must contain at least one field.`);
      if (rawFields.length > MAX_FIELDS_PER_SECTION) errors.push(`${prefix}.fields exceeds ${MAX_FIELDS_PER_SECTION} fields.`);
      const fieldKeys = new Set<string>();
      const fields: ClinicalProfileField[] = [];
      rawFields.slice(0, MAX_FIELDS_PER_SECTION).forEach((rawField, fieldIndex) => {
        const fieldPrefix = `${prefix}.fields[${fieldIndex}]`;
        if (!this.isObject(rawField)) {
          errors.push(`${fieldPrefix} must be an object.`);
          return;
        }
        const fieldKey = this.safeKey(rawField.key, `${fieldPrefix}.key`, errors);
        if (fieldKey && fieldKeys.has(fieldKey)) errors.push(`${fieldPrefix}.key duplicates field key '${fieldKey}'.`);
        if (fieldKey) fieldKeys.add(fieldKey);
        const fieldLabels = this.labels(rawField.labels, `${fieldPrefix}.labels`, errors);
        const type = this.fieldType(rawField.type, `${fieldPrefix}.type`, errors);
        const required = this.boolean(rawField.required, false, `${fieldPrefix}.required`, errors);
        const fieldEnabled = this.boolean(rawField.enabled, true, `${fieldPrefix}.enabled`, errors);
        const unit = this.optionalText(rawField.unit, `${fieldPrefix}.unit`, errors, 40);
        const min = this.optionalNumber(rawField.min, `${fieldPrefix}.min`, errors);
        const max = this.optionalNumber(rawField.max, `${fieldPrefix}.max`, errors);
        if (min !== undefined && max !== undefined && min > max) errors.push(`${fieldPrefix}.min cannot exceed max.`);

        let options: ClinicalProfileOption[] | undefined;
        if (type === "SINGLE_SELECT" || type === "MULTI_SELECT") {
          if (!Array.isArray(rawField.options) || rawField.options.length === 0) {
            errors.push(`${fieldPrefix}.options must contain at least one option for ${type}.`);
            options = [];
          } else {
            if (rawField.options.length > MAX_OPTIONS_PER_FIELD) errors.push(`${fieldPrefix}.options exceeds ${MAX_OPTIONS_PER_FIELD} options.`);
            const optionValues = new Set<string>();
            options = rawField.options.slice(0, MAX_OPTIONS_PER_FIELD).flatMap((rawOption, optionIndex) => {
              const optionPrefix = `${fieldPrefix}.options[${optionIndex}]`;
              if (!this.isObject(rawOption)) {
                errors.push(`${optionPrefix} must be an object.`);
                return [];
              }
              const optionValue = this.safeKey(rawOption.value, `${optionPrefix}.value`, errors);
              if (optionValue && optionValues.has(optionValue)) errors.push(`${optionPrefix}.value duplicates '${optionValue}'.`);
              if (optionValue) optionValues.add(optionValue);
              const optionLabels = this.labels(rawOption.labels, `${optionPrefix}.labels`, errors);
              return optionValue && optionLabels ? [{ value: optionValue, labels: optionLabels }] : [];
            });
          }
        } else if (rawField.options !== undefined) {
          errors.push(`${fieldPrefix}.options is only supported for SINGLE_SELECT or MULTI_SELECT fields.`);
        }

        if (fieldKey && fieldLabels && type) {
          fields.push({
            key: fieldKey,
            labels: fieldLabels,
            type,
            required,
            enabled: fieldEnabled,
            ...(unit ? { unit } : {}),
            ...(min !== undefined ? { min } : {}),
            ...(max !== undefined ? { max } : {}),
            ...(options ? { options } : {}),
          });
        }
      });
      if (key && labels) sections.push({ key, labels, enabled, order, fields });
    });

    const orderedSections = sections.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    return { definition: { sections: orderedSections }, errors };
  }

  private labels(value: unknown, path: string, errors: string[]): Labels | null {
    if (!this.isObject(value)) {
      errors.push(`${path} must contain en, ar, fr and es labels.`);
      return null;
    }
    const result = {} as Labels;
    let valid = true;
    for (const locale of SUPPORTED_LOCALES) {
      const label = this.text(value[locale], `${path}.${locale}`, errors, 160);
      if (!label) valid = false;
      else result[locale] = label;
    }
    return valid ? result : null;
  }

  private fieldType(value: unknown, path: string, errors: string[]): FieldType | null {
    if (typeof value !== "string" || !SUPPORTED_FIELD_TYPES.includes(value as FieldType)) {
      errors.push(`${path} must be one of ${SUPPORTED_FIELD_TYPES.join(", ")}.`);
      return null;
    }
    return value as FieldType;
  }

  private safeKey(value: unknown, path: string, errors: string[]): string | null {
    if (typeof value !== "string") {
      errors.push(`${path} must be text.`);
      return null;
    }
    const normalized = value.trim();
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(normalized)) {
      errors.push(`${path} must match ^[a-z][a-z0-9_]{1,63}$.`);
      return null;
    }
    return normalized;
  }

  private text(value: unknown, path: string, errors: string[], max: number): string | null {
    if (typeof value !== "string") {
      errors.push(`${path} must be text.`);
      return null;
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
      errors.push(`${path} must be non-empty text with at most ${max} characters.`);
      return null;
    }
    return normalized;
  }

  private optionalText(value: unknown, path: string, errors: string[], max: number): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    return this.text(value, path, errors, max) ?? undefined;
  }

  private boolean(value: unknown, fallback: boolean, path: string, errors: string[]): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
      errors.push(`${path} must be boolean.`);
      return fallback;
    }
    return value;
  }

  private number(value: unknown, fallback: number, path: string, errors: string[], min: number, max: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      errors.push(`${path} must be a number between ${min} and ${max}.`);
      return fallback;
    }
    return value;
  }

  private optionalNumber(value: unknown, path: string, errors: string[]): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
      errors.push(`${path} must be a finite number.`);
      return undefined;
    }
    return value;
  }

  private requireDefinition(value: unknown): unknown {
    if (value === undefined || value === null) throw new BadRequestException("definition is required.");
    const encoded = JSON.stringify(value);
    if (!encoded || encoded.length > MAX_SCHEMA_BYTES) throw new BadRequestException(`definition must be valid JSON under ${MAX_SCHEMA_BYTES} bytes.`);
    return value;
  }

  private safeDraftDefinition(value: unknown): ClinicalProfileDefinition {
    if (this.isObject(value) && Array.isArray(value.sections)) return { sections: [] };
    return { sections: [] };
  }

  private jurisdiction(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("jurisdiction is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(normalized)) {
      throw new BadRequestException("jurisdiction must be 2-32 uppercase letters, digits, '-' or '_'.");
    }
    return normalized;
  }

  private status(value: unknown): ClinicalProfileSchemaStatus {
    if (typeof value !== "string") throw new BadRequestException("status must be text.");
    const normalized = value.trim().toUpperCase();
    if (!Object.values(ClinicalProfileSchemaStatus).includes(normalized as ClinicalProfileSchemaStatus)) {
      throw new BadRequestException("status must be DRAFT, ACTIVE or RETIRED.");
    }
    return normalized as ClinicalProfileSchemaStatus;
  }

  private integer(value: unknown, field: string, min: number, max: number): number {
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw new BadRequestException(`${field} must be an integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException(`${field} must be between ${min} and ${max}.`);
    return parsed;
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > 160 || /\p{Cc}/u.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private action(value: unknown): "UPDATE_DRAFT" | "VALIDATE" | "PUBLISH" | "RETIRE" {
    if (typeof value !== "string") throw new BadRequestException("action is required.");
    const normalized = value.trim().toUpperCase();
    if (!["UPDATE_DRAFT", "VALIDATE", "PUBLISH", "RETIRE"].includes(normalized)) {
      throw new BadRequestException("action must be UPDATE_DRAFT, VALIDATE, PUBLISH or RETIRE.");
    }
    return normalized as "UPDATE_DRAFT" | "VALIDATE" | "PUBLISH" | "RETIRE";
  }

  private hash(definition: ClinicalProfileDefinition): string {
    return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Clinical profile schema governance requires the ADMIN role.");
  }
}

@RequirePermissions("DATA_GOVERNANCE_MANAGE")
@Controller("admin/clinical/profile-schema")
class AdminClinicalProfileSchemaController {
  constructor(private readonly schemas: AdminClinicalProfileSchemaService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: ListQuery) {
    return this.schemas.list(principal, query);
  }

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.schemas.create(principal, body);
  }

  @Patch()
  mutate(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.schemas.mutate(principal, body);
  }
}

@Module({
  controllers: [AdminClinicalProfileSchemaController],
  providers: [AdminClinicalProfileSchemaService],
})
export class AdminClinicalProfileSchemaModule {}
