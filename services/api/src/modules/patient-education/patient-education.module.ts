import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header,
  Injectable, Module, NotFoundException, Param, Post, Query,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";

const REQUIRED_LOCALES = ["en","ar","fr","es"] as const;
const CONTEXT_KINDS = new Set(["CARE_PLAN","CONDITION"]);

export interface CreateEducationContentInput { code: string; }
export interface CreateEducationContentVersionInput {
  labels: unknown; bodyLabels: unknown; sourceName: string; sourceUrl?: string | null;
}
export interface AssignEducationInput {
  appointmentId: string; contentVersionId: string; idempotencyKey: string;
  contextKind?: "CARE_PLAN" | "CONDITION" | null; contextId?: string | null;
}

@Injectable()
class PatientEducationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async adminList() {
    const rows = await this.prisma.educationContent.findMany({
      include: { versions: { orderBy: { version: "desc" } } }, orderBy: { code: "asc" },
    });
    return { items: rows.map((row) => ({
      id: row.id, code: row.code, active: row.active,
      versions: row.versions.map((version) => this.presentVersion(version)),
    })) };
  }

  async createDefinition(principal: AuthPrincipal, input: CreateEducationContentInput) {
    const code = this.code(input?.code);
    if (await this.prisma.educationContent.findUnique({ where: { code } })) {
      throw new ConflictException("Education content code already exists.");
    }
    const row = await this.prisma.educationContent.create({ data: { code } });
    await this.audit.write({
      actorId: principal.accountId, action: "EDUCATION_CONTENT_CREATED",
      objectType: "EDUCATION_CONTENT", objectId: row.id, purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS", metadata: { code, patientSpecificContent: false },
    });
    return row;
  }

  async createVersion(principal: AuthPrincipal, contentIdRaw: string, input: CreateEducationContentVersionInput) {
    const contentId = this.id(contentIdRaw, "contentId");
    const content = await this.prisma.educationContent.findUnique({ where: { id: contentId } });
    if (!content) throw new NotFoundException("Education content not found.");
    const labels = this.localized(input?.labels, "labels", 160);
    const bodyLabels = this.localized(input?.bodyLabels, "bodyLabels", 8000);
    const sourceName = this.text(input?.sourceName, "sourceName", 240);
    const sourceUrl = this.sourceUrl(input?.sourceUrl);
    const max = await this.prisma.educationContentVersion.aggregate({
      where: { contentId }, _max: { version: true },
    });
    const row = await this.prisma.educationContentVersion.create({
      data: {
        contentId, version: (max._max.version ?? 0) + 1, status: "DRAFT",
        labels: labels as Prisma.InputJsonValue, bodyLabels: bodyLabels as Prisma.InputJsonValue,
        sourceName, sourceUrl, createdByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId, action: "EDUCATION_CONTENT_VERSION_CREATED",
      objectType: "EDUCATION_CONTENT_VERSION", objectId: row.id, purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS", metadata: {
        contentId, resourceVersion: row.version, sourceAttributionPresent: true, patientSpecificContent: false,
      },
    });
    return this.presentVersion(row);
  }

  async publish(principal: AuthPrincipal, contentIdRaw: string, versionRaw: string) {
    const contentId = this.id(contentIdRaw, "contentId");
    const version = this.positiveInteger(versionRaw, "version");
    const row = await this.prisma.educationContentVersion.findUnique({
      where: { contentId_version: { contentId, version } }, include: { content: true },
    });
    if (!row || !row.content.active) throw new NotFoundException("Education content version not found.");
    if (row.status === "PUBLISHED") return this.presentVersion(row);
    if (row.status !== "DRAFT") throw new ConflictException("Only DRAFT education versions can be published.");
    const now = new Date();
    const published = await this.prisma.$transaction(async (tx) => {
      await tx.educationContentVersion.updateMany({
        where: { contentId, status: "PUBLISHED" }, data: { status: "RETIRED", retiredAt: now },
      });
      return tx.educationContentVersion.update({
        where: { id: row.id }, data: { status: "PUBLISHED", publishedAt: now, retiredAt: null },
      });
    });
    await this.audit.write({
      actorId: principal.accountId, action: "EDUCATION_CONTENT_VERSION_PUBLISHED",
      objectType: "EDUCATION_CONTENT_VERSION", objectId: published.id, purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS", metadata: { contentId, resourceVersion: version, sourceAttributionPresent: true },
    });
    return this.presentVersion(published);
  }

  async doctorCatalog(principal: AuthPrincipal, appointmentIdRaw: string) {
    const provider = await this.requireDoctor(principal);
    const appointment = await this.doctorAppointment(provider.id, appointmentIdRaw);
    const rows = await this.prisma.educationContent.findMany({
      where: { active: true },
      include: { versions: { where: { status: "PUBLISHED" }, orderBy: { version: "desc" }, take: 1 } },
      orderBy: { code: "asc" },
    });
    return {
      appointmentId: appointment.id, patientId: appointment.patientId,
      items: rows.flatMap((row) => row.versions[0] ? [{
        contentId: row.id, code: row.code, ...this.presentVersion(row.versions[0]),
      }] : []),
      automatedClinicalInference: false,
    };
  }

  async doctorAssignments(principal: AuthPrincipal, patientIdRaw: string) {
    const provider = await this.requireDoctor(principal);
    const patientId = this.id(patientIdRaw, "patientId");
    await this.requireTreatmentRelationship(provider.id, patientId);
    const rows = await this.prisma.patientEducationAssignment.findMany({
      where: { providerId: provider.id, patientId },
      include: { contentVersion: { include: { content: true } } },
      orderBy: { assignedAt: "desc" }, take: 250,
    });
    return { patientId, items: rows.map((row) => this.presentAssignment(row)) };
  }

  async assign(principal: AuthPrincipal, patientIdRaw: string, input: AssignEducationInput) {
    const provider = await this.requireDoctor(principal);
    const patientId = this.id(patientIdRaw, "patientId");
    const appointmentId = this.id(input?.appointmentId, "appointmentId");
    const contentVersionId = this.id(input?.contentVersionId, "contentVersionId");
    const idempotencyKey = this.idempotency(input?.idempotencyKey);
    const appointment = await this.doctorAppointment(provider.id, appointmentId);
    if (appointment.patientId !== patientId) throw new ForbiddenException("Education assignment patient does not match appointment.");

    const version = await this.prisma.educationContentVersion.findUnique({
      where: { id: contentVersionId }, include: { content: true },
    });
    if (!version || version.status !== "PUBLISHED" || !version.content.active) {
      throw new BadRequestException("A PUBLISHED active education content version is required.");
    }
    const context = await this.validateContext(patientId, input?.contextKind, input?.contextId);
    const existing = await this.prisma.patientEducationAssignment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.patientId !== patientId || existing.providerId !== provider.id ||
        existing.appointmentId !== appointment.id || existing.contentVersionId !== version.id ||
        existing.contextKind !== context.contextKind || existing.contextId !== context.contextId
      ) throw new ConflictException("idempotencyKey is bound to another education assignment.");
      const current = await this.prisma.patientEducationAssignment.findUniqueOrThrow({
        where: { id: existing.id }, include: { contentVersion: { include: { content: true } } },
      });
      return this.presentAssignment(current);
    }

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId }, select: { userId: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");
    const assignment = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      const created = await tx.patientEducationAssignment.create({
        data: {
          idempotencyKey, patientId, providerId: provider.id, appointmentId: appointment.id,
          contentVersionId: version.id, contextKind: context.contextKind, contextId: context.contextId,
          status: "ASSIGNED", assignedByActorId: principal.accountId,
        },
        include: { contentVersion: { include: { content: true } } },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId, action: "PATIENT_EDUCATION_ASSIGNED",
        objectType: "PATIENT_EDUCATION_ASSIGNMENT", objectId: created.id,
        purpose: "TREATMENT", result: "SUCCESS", metadata: {
          domain: "PATIENT_EDUCATION", patientId, providerId: provider.id,
          appointmentId: appointment.id, resourceId: created.id, resourceVersion: version.version,
          contextKind: context.contextKind ?? undefined, decision: "ALLOW",
        },
      });
      await this.notifications.enqueueAccountInTransaction(tx, {
        accountId: patient.userId, dedupeKey: `patient-education:${created.id}`,
        type: "CARE_COORDINATION", entityType: "PATIENT_EDUCATION_ASSIGNMENT", entityId: created.id,
        safeTitleKey: "patient.education.assigned.title", safeBodyKey: "patient.education.assigned.body",
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.notifications.wakeOutbox();
    return this.presentAssignment(assignment);
  }

  async revoke(principal: AuthPrincipal, assignmentIdRaw: string) {
    const provider = await this.requireDoctor(principal);
    const assignmentId = this.id(assignmentIdRaw, "assignmentId");
    const row = await this.prisma.patientEducationAssignment.findUnique({
      where: { id: assignmentId }, include: { contentVersion: { include: { content: true } } },
    });
    if (!row || row.providerId !== provider.id) throw new NotFoundException("Education assignment not found.");
    if (row.status === "REVOKED") return this.presentAssignment(row);
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: row.patientId }, select: { userId: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      const changed = await tx.patientEducationAssignment.update({
        where: { id: row.id },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByActorId: principal.accountId },
        include: { contentVersion: { include: { content: true } } },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId, action: "PATIENT_EDUCATION_REVOKED",
        objectType: "PATIENT_EDUCATION_ASSIGNMENT", objectId: changed.id,
        purpose: "TREATMENT", result: "SUCCESS", metadata: {
          domain: "PATIENT_EDUCATION", patientId: changed.patientId,
          providerId: provider.id, resourceId: changed.id,
          resourceVersion: changed.contentVersion.version, decision: "ALLOW",
        },
      });
      await this.notifications.enqueueAccountInTransaction(tx, {
        accountId: patient.userId, dedupeKey: `patient-education:${changed.id}:revoked`,
        type: "CARE_COORDINATION", entityType: "PATIENT_EDUCATION_ASSIGNMENT", entityId: changed.id,
        safeTitleKey: "patient.education.revoked.title", safeBodyKey: "patient.education.revoked.body",
      });
      return changed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.notifications.wakeOutbox();
    return this.presentAssignment(updated);
  }

  async patientList(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient education access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId }, select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    const rows = await this.prisma.patientEducationAssignment.findMany({
      where: { patientId: patient.id, status: "ASSIGNED" },
      include: { contentVersion: { include: { content: true } } },
      orderBy: { assignedAt: "desc" }, take: 250,
    });
    await this.audit.writeClinical({
      actorId: principal.accountId, action: "PATIENT_EDUCATION_READ",
      objectType: "PATIENT", objectId: patient.id, purpose: "PATIENT_ACCESS",
      result: "SUCCESS", metadata: {
        domain: "PATIENT_EDUCATION", patientId: patient.id,
        assignmentCount: rows.length, decision: "ALLOW",
      },
    });
    return {
      patientId: patient.id, items: rows.map((row) => this.presentAssignment(row)),
      automatedClinicalInference: false, contentIsClinicianAssigned: true,
    };
  }

  private async requireDoctor(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Patient education assignment requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId }, select: { id: true, class: true, status: true },
    });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active Doctor provider profile is required.");
    }
    return provider;
  }

  private async doctorAppointment(providerId: string, appointmentIdRaw: string) {
    const appointmentId = this.id(appointmentIdRaw, "appointmentId");
    const row = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, providerId, status: { in: ["CONFIRMED","COMPLETED"] } },
      select: { id: true, patientId: true },
    });
    if (!row) throw new ForbiddenException("Assigned clinical appointment is required.");
    return row;
  }

  private async requireTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - 365 * 86400000);
    const to = new Date(now.getTime() + 30 * 86400000);
    const row = await this.prisma.appointment.findFirst({
      where: {
        providerId, patientId, status: { in: ["CONFIRMED","COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!row) throw new ForbiddenException("Current treatment relationship is required.");
  }

  private async validateContext(patientId: string, kindRaw?: string | null, idRaw?: string | null) {
    if (kindRaw == null && idRaw == null) return { contextKind: null, contextId: null };
    const kind = String(kindRaw ?? "").trim().toUpperCase();
    if (!CONTEXT_KINDS.has(kind)) throw new BadRequestException("contextKind must be CARE_PLAN or CONDITION.");
    const contextId = this.id(idRaw, "contextId");
    if (kind === "CARE_PLAN") {
      const plan = await this.prisma.carePlan.findFirst({
        where: { id: contextId, patientId, status: { in: ["ACTIVE","PAUSED"] } }, select: { id: true },
      });
      if (!plan) throw new BadRequestException("Care Plan context is not available for this patient.");
    } else {
      const condition = await this.prisma.clinicalProfileEntry.findFirst({
        where: { id: contextId, patientId, kind: "CONDITION" }, select: { id: true },
      });
      if (!condition) throw new BadRequestException("Condition context is not available for this patient.");
    }
    return { contextKind: kind, contextId };
  }

  private presentAssignment(row: any) {
    return {
      id: row.id, patientId: row.patientId, providerId: row.providerId,
      appointmentId: row.appointmentId, status: row.status,
      contextKind: row.contextKind, contextId: row.contextId,
      assignedAt: row.assignedAt, revokedAt: row.revokedAt,
      content: {
        contentId: row.contentVersion.content.id,
        contentVersionId: row.contentVersion.id,
        code: row.contentVersion.content.code,
        version: row.contentVersion.version,
        labels: row.contentVersion.labels,
        bodyLabels: row.contentVersion.bodyLabels,
        sourceName: row.contentVersion.sourceName,
        sourceUrl: row.contentVersion.sourceUrl,
      },
      sourceVisible: true, clinicianAssigned: true, automatedClinicalInference: false,
    };
  }

  private presentVersion(row: any) {
    return {
      id: row.id, contentId: row.contentId, version: row.version, status: row.status,
      labels: row.labels, bodyLabels: row.bodyLabels, sourceName: row.sourceName,
      sourceUrl: row.sourceUrl, publishedAt: row.publishedAt, retiredAt: row.retiredAt,
      createdAt: row.createdAt, sourceVisible: true, patientSpecificContent: false,
    };
  }

  private localized(raw: unknown, field: string, max: number) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException(`${field} must be localized.`);
    const value = raw as Record<string,unknown>;
    const result: Record<string,string> = {};
    for (const locale of REQUIRED_LOCALES) result[locale] = this.text(value[locale], `${field}.${locale}`, max);
    return result;
  }

  private sourceUrl(raw: unknown) {
    if (raw == null || raw === "") return null;
    const value = this.text(raw, "sourceUrl", 1000);
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new BadRequestException("sourceUrl must be a valid URL."); }
    if (parsed.protocol !== "https:") throw new BadRequestException("sourceUrl must use HTTPS.");
    if (parsed.username || parsed.password) throw new BadRequestException("sourceUrl must not include credentials.");
    return parsed.toString();
  }

  private code(raw: unknown) {
    if (typeof raw !== "string") throw new BadRequestException("code is required.");
    const value = raw.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_:-]{2,79}$/.test(value)) throw new BadRequestException("code is invalid.");
    return value;
  }
  private id(raw: unknown, field: string) {
    if (typeof raw !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(raw.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return raw.trim();
  }
  private idempotency(raw: unknown) {
    if (typeof raw !== "string") throw new BadRequestException("idempotencyKey is required.");
    const value = raw.trim();
    if (value.length < 8 || value.length > 128 || /\p{Cc}/u.test(value)) throw new BadRequestException("idempotencyKey is invalid.");
    return value;
  }
  private text(raw: unknown, field: string, max: number) {
    if (typeof raw !== "string") throw new BadRequestException(`${field} is required.`);
    const value = raw.trim();
    if (!value || value.length > max || /\p{Cc}/u.test(value)) throw new BadRequestException(`${field} is invalid.`);
    return value;
  }
  private positiveInteger(raw: unknown, field: string) {
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }
}

@Controller("admin/education-content")
class AdminEducationContentController {
  constructor(private readonly education: PatientEducationService) {}
  @RequirePermissions("CATALOG_MANAGE") @Get() @Header("Cache-Control","no-store")
  list() { return this.education.adminList(); }
  @RequirePermissions("CATALOG_MANAGE") @Post() @Header("Cache-Control","no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateEducationContentInput) {
    return this.education.createDefinition(principal, body);
  }
  @RequirePermissions("CATALOG_MANAGE") @Post(":contentId/versions") @Header("Cache-Control","no-store")
  version(@CurrentPrincipal() principal: AuthPrincipal, @Param("contentId") contentId: string, @Body() body: CreateEducationContentVersionInput) {
    return this.education.createVersion(principal, contentId, body);
  }
  @RequirePermissions("CATALOG_MANAGE") @Post(":contentId/versions/:version/publish") @Header("Cache-Control","no-store")
  publish(@CurrentPrincipal() principal: AuthPrincipal, @Param("contentId") contentId: string, @Param("version") version: string) {
    return this.education.publish(principal, contentId, version);
  }
}

@Controller("provider")
class ProviderEducationController {
  constructor(private readonly education: PatientEducationService) {}
  @RequirePermissions("CARE_COORDINATION_MANAGE") @Get("education-content") @Header("Cache-Control","no-store")
  catalog(@CurrentPrincipal() principal: AuthPrincipal, @Query("appointmentId") appointmentId: string) {
    return this.education.doctorCatalog(principal, appointmentId);
  }
  @RequirePermissions("CARE_COORDINATION_MANAGE") @Get("patients/:patientId/education") @Header("Cache-Control","no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.education.doctorAssignments(principal, patientId);
  }
  @RequirePermissions("CARE_COORDINATION_MANAGE") @Post("patients/:patientId/education") @Header("Cache-Control","no-store")
  assign(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string, @Body() body: AssignEducationInput) {
    return this.education.assign(principal, patientId, body);
  }
  @RequirePermissions("CARE_COORDINATION_MANAGE") @Post("education-assignments/:assignmentId/revoke") @Header("Cache-Control","no-store")
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("assignmentId") assignmentId: string) {
    return this.education.revoke(principal, assignmentId);
  }
}

@Controller("patient/education")
class PatientEducationController {
  constructor(private readonly education: PatientEducationService) {}
  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD") @Get() @Header("Cache-Control","no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) { return this.education.patientList(principal); }
}

@Module({
  imports: [CommunicationsModule],
  controllers: [AdminEducationContentController, ProviderEducationController, PatientEducationController],
  providers: [PatientEducationService],
})
export class PatientEducationModule {}
