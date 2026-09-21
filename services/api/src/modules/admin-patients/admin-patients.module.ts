import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma, type AccountStatus, type ClinicalProfileSchema } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const ACTIVE_EMERGENCY_STATUSES = ["REQUESTED", "DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] as const;
const ACTIVE_TRANSPORT_STATUSES = ["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] as const;
const ACCOUNT_STATUSES = new Set<AccountStatus>(["ACTIVE", "SUSPENDED", "ARCHIVED"]);
const FIELD_TYPES = new Set(["TEXT", "TEXTAREA", "BOOLEAN", "DATE", "NUMBER", "SELECT", "MULTI_SELECT"]);
const REQUIRED_LOCALES = ["en", "ar", "fr", "es"] as const;
const MAX_PATIENTS = 100;

type JsonObject = Record<string, unknown>;
type SchemaAction = "PUBLISH" | "RETIRE";

@Injectable()
class AdminPatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async list(principal: AuthPrincipal, input: { q?: string | undefined; status?: string | undefined; limit?: string | undefined }) {
    const q = this.optionalQuery(input.q);
    const status = this.optionalAccountStatus(input.status);
    const limit = this.limit(input.limit);
    const now = new Date();
    const patients = await this.prisma.patientProfile.findMany({
      where: {
        ...(q ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
          ],
        } : {}),
        ...(status ? { user: { status } } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            lockedUntil: true,
            mfaEnrollment: { select: { enabledAt: true } },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit,
    });
    const patientIds = patients.map((item) => item.id);
    const [consents, coverages, dependents, emergencies, transports] = patientIds.length === 0
      ? [[], [], [], [], []]
      : await Promise.all([
          this.prisma.consent.groupBy({
            by: ["patientId"],
            where: { patientId: { in: patientIds }, state: "GRANTED", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            _count: { _all: true },
          }),
          this.prisma.insuranceCoverage.groupBy({
            by: ["patientId"],
            where: { patientId: { in: patientIds }, status: "ACTIVE", OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] },
            _count: { _all: true },
          }),
          this.prisma.dependentRelation.groupBy({
            by: ["dependentPatientId"],
            where: { dependentPatientId: { in: patientIds }, status: { not: "REVOKED" }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
            _count: { _all: true },
          }),
          this.prisma.emergencyAmbulanceRequest.groupBy({
            by: ["patientId"],
            where: { patientId: { in: patientIds }, status: { in: [...ACTIVE_EMERGENCY_STATUSES] } },
            _count: { _all: true },
          }),
          this.prisma.medicalTransportRequest.groupBy({
            by: ["patientId"],
            where: { patientId: { in: patientIds }, status: { in: [...ACTIVE_TRANSPORT_STATUSES] } },
            _count: { _all: true },
          }),
        ]);
    const consentCounts = new Map(consents.map((row) => [row.patientId, row._count._all]));
    const coverageCounts = new Map(coverages.map((row) => [row.patientId, row._count._all]));
    const dependentCounts = new Map(dependents.map((row) => [row.dependentPatientId, row._count._all]));
    const emergencyCounts = new Map(emergencies.map((row) => [row.patientId, row._count._all]));
    const transportCounts = new Map(transports.map((row) => [row.patientId, row._count._all]));
    const items = patients.map((patient) => ({
      id: patient.id,
      displayName: this.displayName(patient.firstName, patient.lastName),
      accountStatus: patient.user.status,
      identity: {
        emailMasked: this.maskEmail(patient.user.email),
      },
      verification: {
        mfaEnabled: patient.user.mfaEnrollment?.enabledAt != null,
      },
      operationalFlags: {
        temporarilyLocked: patient.user.lockedUntil != null && patient.user.lockedUntil.getTime() > now.getTime(),
        hasActiveConsent: (consentCounts.get(patient.id) ?? 0) > 0,
        hasActiveCoverage: (coverageCounts.get(patient.id) ?? 0) > 0,
        dependentRelationshipCount: dependentCounts.get(patient.id) ?? 0,
        activeEmergencyCount: emergencyCounts.get(patient.id) ?? 0,
        activeTransportCount: transportCounts.get(patient.id) ?? 0,
      },
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    }));
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PATIENT_DIRECTORY_READ",
      objectType: "PATIENT_DIRECTORY",
      objectId: null,
      purpose: "ADMINISTRATION",
      result: "SUCCESS",
      metadata: { itemCount: items.length, filtered: Boolean(q || status), limit },
    });
    return {
      privacyBoundary: "ADMINISTRATIVE_ONLY" as const,
      clinicalDataIncluded: false,
      itemCount: items.length,
      items,
    };
  }

  async detail(principal: AuthPrincipal, patientIdRaw: string) {
    const patientId = this.identifier(patientIdRaw, "patientId");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            failedLoginCount: true,
            lockedUntil: true,
            createdAt: true,
            updatedAt: true,
            mfaEnrollment: { select: { enabledAt: true } },
          },
        },
      },
    });
    if (!patient) throw new NotFoundException("Patient not found.");
    const now = new Date();
    const [consents, coverages, asDependent, asGuardian, emergencyCount, transportCount, deniedEvents] = await Promise.all([
      this.prisma.consent.findMany({
        where: { patientId },
        select: { id: true, providerId: true, scope: true, version: true, purpose: true, state: true, grantedAt: true, revokedAt: true, expiresAt: true },
        orderBy: { grantedAt: "desc" },
        take: 100,
      }),
      this.prisma.insuranceCoverage.findMany({
        where: { patientId },
        select: { id: true, payerCode: true, payerName: true, displayLabel: true, status: true, effectiveFrom: true, effectiveUntil: true, createdAt: true, updatedAt: true },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: 50,
      }),
      this.prisma.dependentRelation.findMany({
        where: { dependentPatientId: patientId },
        select: { id: true, relationshipType: true, status: true, validFrom: true, validUntil: true, verifiedAt: true, revokedAt: true, reasonCode: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      this.prisma.dependentRelation.findMany({
        where: { guardianAccountId: patient.user.id },
        select: { id: true, dependentPatientId: true, relationshipType: true, status: true, validFrom: true, validUntil: true, verifiedAt: true, revokedAt: true, reasonCode: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      this.prisma.emergencyAmbulanceRequest.count({ where: { patientId, status: { in: [...ACTIVE_EMERGENCY_STATUSES] } } }),
      this.prisma.medicalTransportRequest.count({ where: { patientId, status: { in: [...ACTIVE_TRANSPORT_STATUSES] } } }),
      this.prisma.auditEvent.findMany({
        where: {
          result: "DENIED",
          objectId: { in: [patient.id, patient.user.id] },
          occurredAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { action: true, objectType: true, result: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
        take: 20,
      }),
    ]);
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PATIENT_DETAIL_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "ADMINISTRATION",
      result: "SUCCESS",
      metadata: {
        consentCount: consents.length,
        coverageCount: coverages.length,
        dependentRelationCount: asDependent.length + asGuardian.length,
      },
    });
    return {
      privacyBoundary: "ADMINISTRATIVE_ONLY" as const,
      clinicalDataIncluded: false,
      patient: {
        id: patient.id,
        displayName: this.displayName(patient.firstName, patient.lastName),
        firstName: patient.firstName,
        lastName: patient.lastName,
        contact: {
          email: patient.user.email,
          phone: patient.phone,
        },
        account: {
          id: patient.user.id,
          status: patient.user.status,
          mfaEnabled: patient.user.mfaEnrollment?.enabledAt != null,
          temporarilyLocked: patient.user.lockedUntil != null && patient.user.lockedUntil.getTime() > now.getTime(),
          failedLoginCount: patient.user.failedLoginCount,
          createdAt: patient.user.createdAt,
          updatedAt: patient.user.updatedAt,
        },
        createdAt: patient.createdAt,
        updatedAt: patient.updatedAt,
      },
      dependents: {
        asDependent,
        asGuardian,
      },
      consents: consents.map((row) => ({
        ...row,
        effectiveState: row.state === "GRANTED" && row.expiresAt && row.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : row.state,
      })),
      insurance: coverages,
      incidents: {
        activeEmergencyCount: emergencyCount,
        activeTransportCount: transportCount,
        deniedSecurityEventsLast30Days: deniedEvents,
      },
    };
  }

  private optionalQuery(value?: string): string | null {
    if (!value) return null;
    const q = value.trim();
    if (!q) return null;
    if (q.length > 120) throw new BadRequestException("q exceeds 120 characters.");
    return q;
  }

  private optionalAccountStatus(value?: string): AccountStatus | null {
    if (!value) return null;
    const normalized = value.trim().toUpperCase() as AccountStatus;
    if (!ACCOUNT_STATUSES.has(normalized)) throw new BadRequestException("status is invalid.");
    return normalized;
  }

  private limit(value?: string): number {
    if (!value) return 50;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PATIENTS) throw new BadRequestException(`limit must be between 1 and ${MAX_PATIENTS}.`);
    return parsed;
  }

  private identifier(value: string, field: string): string {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private displayName(firstName: string, lastName: string): string {
    return `${firstName.trim()} ${lastName.trim()}`.trim();
  }

  private maskEmail(email: string): string {
    const [local = "", domain = ""] = email.split("@");
    if (!domain) return "***";
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
  }
}

@Injectable()
class ClinicalProfileSchemaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async list(principal: AuthPrincipal, rawJurisdiction?: string) {
    const jurisdiction = rawJurisdiction ? this.jurisdiction(rawJurisdiction) : null;
    const rows = await this.prisma.clinicalProfileSchema.findMany({
      where: jurisdiction ? { jurisdiction } : {},
      orderBy: [{ jurisdiction: "asc" }, { version: "desc" }],
      take: 250,
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_PROFILE_SCHEMA_LIST_READ",
      objectType: "CLINICAL_PROFILE_SCHEMA",
      objectId: null,
      purpose: "CLINICAL_GOVERNANCE",
      result: "SUCCESS",
      metadata: { itemCount: rows.length, jurisdictionFiltered: Boolean(jurisdiction) },
    });
    return {
      invariants: {
        publishedVersionsImmutable: true,
        historicalVersionsRetained: true,
        onlyValidatedDraftsPublishable: true,
      },
      items: rows.map((row) => this.present(row)),
    };
  }

  async create(principal: AuthPrincipal, input: JsonObject) {
    const jurisdiction = this.jurisdiction(input.jurisdiction);
    const definition = this.definition(input.definition);
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`carepoint-profile-schema:${jurisdiction}`}))`);
      const latest = await tx.clinicalProfileSchema.findFirst({
        where: { jurisdiction },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      return tx.clinicalProfileSchema.create({
        data: {
          jurisdiction,
          version: (latest?.version ?? 0) + 1,
          definition: definition as Prisma.InputJsonValue,
          createdByActorId: principal.accountId,
        },
      });
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_PROFILE_SCHEMA_DRAFT_CREATED",
      objectType: "CLINICAL_PROFILE_SCHEMA",
      objectId: created.id,
      purpose: "CLINICAL_GOVERNANCE",
      result: "SUCCESS",
      metadata: { jurisdiction, version: created.version, revision: created.revision },
    });
    return this.present(created);
  }

  async patch(principal: AuthPrincipal, schemaIdRaw: string, input: JsonObject) {
    const schemaId = this.identifier(schemaIdRaw, "schemaId");
    const action = this.optionalAction(input.action);
    if (action) return this.transition(principal, schemaId, action, input);
    const expectedRevision = this.expectedRevision(input.expectedRevision);
    const definition = this.definition(input.definition);
    const current = await this.prisma.clinicalProfileSchema.findUnique({ where: { id: schemaId } });
    if (!current) throw new NotFoundException("Clinical profile schema not found.");
    if (current.status !== "DRAFT") throw new ConflictException("Only a draft clinical profile schema may be edited.");
    const updated = await this.prisma.clinicalProfileSchema.updateMany({
      where: { id: schemaId, status: "DRAFT", revision: expectedRevision },
      data: { definition: definition as Prisma.InputJsonValue, revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ConflictException("Clinical profile schema changed. Reload before editing again.");
    const row = await this.prisma.clinicalProfileSchema.findUniqueOrThrow({ where: { id: schemaId } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_PROFILE_SCHEMA_DRAFT_UPDATED",
      objectType: "CLINICAL_PROFILE_SCHEMA",
      objectId: schemaId,
      purpose: "CLINICAL_GOVERNANCE",
      result: "SUCCESS",
      metadata: { jurisdiction: row.jurisdiction, version: row.version, revision: row.revision },
    });
    return this.present(row);
  }

  private async transition(principal: AuthPrincipal, schemaId: string, action: SchemaAction, input: JsonObject) {
    const expectedRevision = this.expectedRevision(input.expectedRevision);
    const row = await this.prisma.clinicalProfileSchema.findUnique({ where: { id: schemaId } });
    if (!row) throw new NotFoundException("Clinical profile schema not found.");
    if (row.revision !== expectedRevision) throw new ConflictException("Clinical profile schema changed. Reload before changing state.");
    if (action === "PUBLISH") {
      if (row.status !== "DRAFT") throw new ConflictException("Only a draft schema can be published.");
      this.definition(row.definition);
      const now = new Date();
      const published = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`carepoint-profile-schema:${row.jurisdiction}`}))`);
        const current = await tx.clinicalProfileSchema.findUnique({ where: { id: row.id } });
        if (!current || current.status !== "DRAFT" || current.revision !== expectedRevision) {
          throw new ConflictException("Clinical profile schema changed before publication.");
        }
        await tx.clinicalProfileSchema.updateMany({
          where: { jurisdiction: row.jurisdiction, status: "PUBLISHED" },
          data: { status: "RETIRED", retiredAt: now, retiredByActorId: principal.accountId },
        });
        return tx.clinicalProfileSchema.update({
          where: { id: row.id },
          data: { status: "PUBLISHED", publishedAt: now, publishedByActorId: principal.accountId },
        });
      });
      await this.audit.write({
        actorId: principal.accountId,
        action: "CLINICAL_PROFILE_SCHEMA_PUBLISHED",
        objectType: "CLINICAL_PROFILE_SCHEMA",
        objectId: published.id,
        purpose: "CLINICAL_GOVERNANCE",
        result: "SUCCESS",
        metadata: { jurisdiction: published.jurisdiction, version: published.version },
      });
      return this.present(published);
    }

    if (row.status !== "PUBLISHED") throw new ConflictException("Only a published schema can be retired.");
    const retired = await this.prisma.clinicalProfileSchema.update({
      where: { id: row.id },
      data: { status: "RETIRED", retiredAt: new Date(), retiredByActorId: principal.accountId },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_PROFILE_SCHEMA_RETIRED",
      objectType: "CLINICAL_PROFILE_SCHEMA",
      objectId: retired.id,
      purpose: "CLINICAL_GOVERNANCE",
      result: "SUCCESS",
      metadata: { jurisdiction: retired.jurisdiction, version: retired.version },
    });
    return this.present(retired);
  }

  private definition(value: unknown): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("definition must be an object.");
    const definition = value as JsonObject;
    const serialized = JSON.stringify(definition);
    if (Buffer.byteLength(serialized, "utf8") > 128 * 1024) throw new BadRequestException("definition exceeds 128 KiB.");
    const allowedRoot = new Set(["schemaKey", "labels", "sections"]);
    for (const key of Object.keys(definition)) if (!allowedRoot.has(key)) throw new BadRequestException(`Unsupported definition field '${key}'.`);
    const schemaKey = this.key(definition.schemaKey, "definition.schemaKey");
    const labels = this.labels(definition.labels, "definition.labels");
    if (!Array.isArray(definition.sections) || definition.sections.length < 1 || definition.sections.length > 20) {
      throw new BadRequestException("definition.sections must contain between 1 and 20 sections.");
    }
    const sectionKeys = new Set<string>();
    let fieldCount = 0;
    const sections = definition.sections.map((rawSection, sectionIndex) => {
      if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) throw new BadRequestException(`section ${sectionIndex + 1} must be an object.`);
      const section = rawSection as JsonObject;
      const allowedSection = new Set(["key", "labels", "fields"]);
      for (const key of Object.keys(section)) if (!allowedSection.has(key)) throw new BadRequestException(`Unsupported section field '${key}'.`);
      const key = this.key(section.key, `section ${sectionIndex + 1}.key`);
      if (sectionKeys.has(key)) throw new BadRequestException(`Duplicate section key '${key}'.`);
      sectionKeys.add(key);
      if (!Array.isArray(section.fields) || section.fields.length < 1 || section.fields.length > 40) throw new BadRequestException(`section '${key}' must contain between 1 and 40 fields.`);
      const fieldKeys = new Set<string>();
      const fields = section.fields.map((rawField, fieldIndex) => {
        fieldCount += 1;
        if (fieldCount > 100) throw new BadRequestException("A clinical profile schema may contain at most 100 fields.");
        if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) throw new BadRequestException(`field ${fieldIndex + 1} in '${key}' must be an object.`);
        const field = rawField as JsonObject;
        const allowedField = new Set(["key", "type", "required", "labels", "options", "unit"]);
        for (const fieldKey of Object.keys(field)) if (!allowedField.has(fieldKey)) throw new BadRequestException(`Unsupported profile field property '${fieldKey}'.`);
        const fieldKey = this.key(field.key, `field ${fieldIndex + 1}.key`);
        if (fieldKeys.has(fieldKey)) throw new BadRequestException(`Duplicate field key '${fieldKey}' in section '${key}'.`);
        fieldKeys.add(fieldKey);
        if (typeof field.type !== "string" || !FIELD_TYPES.has(field.type.trim().toUpperCase())) throw new BadRequestException(`Field '${fieldKey}' has an unsupported type.`);
        const type = field.type.trim().toUpperCase();
        if (field.required !== undefined && typeof field.required !== "boolean") throw new BadRequestException(`Field '${fieldKey}'.required must be boolean.`);
        const optionsRequired = type === "SELECT" || type === "MULTI_SELECT";
        let options: string[] | undefined;
        if (field.options !== undefined) {
          if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 50 || field.options.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 80)) {
            throw new BadRequestException(`Field '${fieldKey}'.options is invalid.`);
          }
          options = [...new Set(field.options.map((item) => String(item).trim()))];
        }
        if (optionsRequired && !options) throw new BadRequestException(`Field '${fieldKey}' requires options.`);
        if (!optionsRequired && options) throw new BadRequestException(`Field '${fieldKey}' does not accept options.`);
        const unit = field.unit === undefined || field.unit === null || field.unit === "" ? undefined : this.shortText(field.unit, `Field '${fieldKey}'.unit`, 40);
        return {
          key: fieldKey,
          type,
          required: field.required === true,
          labels: this.labels(field.labels, `Field '${fieldKey}'.labels`),
          ...(options ? { options } : {}),
          ...(unit ? { unit } : {}),
        };
      });
      return { key, labels: this.labels(section.labels, `Section '${key}'.labels`), fields };
    });
    return { schemaKey, labels, sections };
  }

  private labels(value: unknown, field: string): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${field} must be an object.`);
    const raw = value as JsonObject;
    const extra = Object.keys(raw).filter((key) => !REQUIRED_LOCALES.includes(key as (typeof REQUIRED_LOCALES)[number]));
    if (extra.length) throw new BadRequestException(`${field} contains unsupported locale '${extra[0]}'.`);
    const result: Record<string, string> = {};
    for (const locale of REQUIRED_LOCALES) result[locale] = this.shortText(raw[locale], `${field}.${locale}`, 160);
    return result;
  }

  private key(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const key = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(key)) throw new BadRequestException(`${field} is invalid.`);
    return key;
  }

  private jurisdiction(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("jurisdiction is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(normalized)) throw new BadRequestException("jurisdiction is invalid.");
    return normalized;
  }

  private shortText(value: unknown, field: string, max: number): string {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new BadRequestException(`${field} must contain between 1 and ${max} characters.`);
    return value.trim();
  }

  private expectedRevision(value: unknown): number {
    const revision = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(revision) || revision < 1) throw new BadRequestException("expectedRevision must be a positive integer.");
    return revision;
  }

  private optionalAction(value: unknown): SchemaAction | null {
    if (value === undefined || value === null || value === "") return null;
    if (value === "PUBLISH" || value === "RETIRE") return value;
    throw new BadRequestException("action must be PUBLISH or RETIRE.");
  }

  private identifier(value: string, field: string): string {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private present(row: ClinicalProfileSchema) {
    return {
      id: row.id,
      jurisdiction: row.jurisdiction,
      version: row.version,
      revision: row.revision,
      status: row.status,
      definition: row.definition,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      publishedAt: row.publishedAt,
      retiredAt: row.retiredAt,
      mutable: row.status === "DRAFT",
    };
  }
}

@RequirePermissions("IAM_MANAGE_ACCOUNTS")
@Controller("admin/patients")
class AdminPatientsController {
  constructor(private readonly patients: AdminPatientsService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.patients.list(principal, { q, status, limit });
  }

  @Get(":patientId")
  detail(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.patients.detail(principal, patientId);
  }
}

@RequirePermissions("DATA_GOVERNANCE_MANAGE")
@Controller("admin/clinical/profile-schema")
class ClinicalProfileSchemaController {
  constructor(private readonly schemas: ClinicalProfileSchemaService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("jurisdiction") jurisdiction?: string) {
    return this.schemas.list(principal, jurisdiction);
  }

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: JsonObject) {
    return this.schemas.create(principal, body ?? {});
  }

  @Patch(":schemaId")
  patch(@CurrentPrincipal() principal: AuthPrincipal, @Param("schemaId") schemaId: string, @Body() body: JsonObject) {
    return this.schemas.patch(principal, schemaId, body ?? {});
  }
}

@Module({
  controllers: [AdminPatientsController, ClinicalProfileSchemaController],
  providers: [AdminPatientsService, ClinicalProfileSchemaService],
})
export class AdminPatientsModule {}
