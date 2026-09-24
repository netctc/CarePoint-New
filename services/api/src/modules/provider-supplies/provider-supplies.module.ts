import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ProvidersModule } from "../providers/providers.module";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const SAFE_CODE = /^[A-Z][A-Z0-9_:-]{1,63}$/;
const SAFE_UNIT = /^[A-Za-z][A-Za-z0-9_.%/-]{0,31}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const SOURCE_TYPES = new Set(["HOME_VISIT", "MEDICAL_TRANSPORT"]);
const WRITABLE_TRANSPORT = new Set(["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"]);

type SourceType = "HOME_VISIT" | "MEDICAL_TRANSPORT";
type SupplySource = {
  sourceType: SourceType;
  sourceId: string;
  providerId: string;
  patientId: string;
  status: string;
};
type CreateSupplyItemInput = { code?: unknown; labels?: unknown; unitCode?: unknown };
type SupplyItemStatusInput = { active?: unknown };
type RecordSupplyUsageInput = {
  supplyItemId?: unknown;
  quantity?: unknown;
  unitCode?: unknown;
  idempotencyKey?: unknown;
};

@Injectable()
class ProviderSuppliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async adminCatalog() {
    return {
      items: await this.prisma.supplyItem.findMany({ orderBy: [{ active: "desc" }, { code: "asc" }] }),
    };
  }

  async createCatalogItem(principal: AuthPrincipal, input: CreateSupplyItemInput) {
    const code = this.code(input?.code);
    const labels = this.labels(input?.labels);
    const unitCode = this.unit(input?.unitCode);
    const existing = await this.prisma.supplyItem.findUnique({ where: { code } });
    if (existing) throw new ConflictException("Supply item code already exists.");
    const created = await this.prisma.supplyItem.create({
      data: { code, labels: labels as unknown as Prisma.InputJsonValue, unitCode },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "SUPPLY_ITEM_CREATED",
      objectType: "SUPPLY_ITEM",
      objectId: created.id,
      purpose: "FIELD_SERVICE_OPERATIONS",
      result: "SUCCESS",
      metadata: { code, unitCode, clinicalDataIncluded: false },
    });
    return created;
  }

  async setCatalogStatus(principal: AuthPrincipal, itemIdRaw: string, input: SupplyItemStatusInput) {
    const itemId = this.id(itemIdRaw, "itemId");
    if (typeof input?.active !== "boolean") throw new BadRequestException("active must be boolean.");
    const existing = await this.prisma.supplyItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new NotFoundException("Supply item not found.");
    if (existing.active === input.active) return existing;
    const updated = await this.prisma.supplyItem.update({
      where: { id: itemId },
      data: { active: input.active },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "SUPPLY_ITEM_STATUS_CHANGED",
      objectType: "SUPPLY_ITEM",
      objectId: itemId,
      purpose: "FIELD_SERVICE_OPERATIONS",
      result: "SUCCESS",
      metadata: { active: updated.active, code: updated.code, clinicalDataIncluded: false },
    });
    return updated;
  }

  async providerCatalog(principal: AuthPrincipal) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "SUPPLY_TRACKING");
    const items = await this.prisma.supplyItem.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      take: 500,
    });
    return {
      providerId: context.providerId,
      items: items.map((item) => ({
        id: item.id,
        code: item.code,
        labels: item.labels,
        unitCode: item.unitCode,
      })),
    };
  }

  async jobUsage(principal: AuthPrincipal, jobIdRaw: string) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "SUPPLY_TRACKING");
    const source = await this.resolveJob(context.providerId, jobIdRaw);
    const rows = await this.prisma.supplyUsage.findMany({
      where: {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        providerId: context.providerId,
      },
      include: { supplyItem: { select: { code: true, labels: true } } },
      orderBy: { recordedAt: "desc" },
      take: 500,
    });
    return {
      jobId: this.jobId(source),
      sourceType: source.sourceType,
      sourceStatus: source.status,
      items: rows.map((row) => ({
        id: row.id,
        supplyItemId: row.supplyItemId,
        code: row.supplyItem.code,
        labels: row.supplyItem.labels,
        quantity: Number(row.quantity.toString()),
        unitCode: row.unitCode,
        recordedAt: row.recordedAt,
      })),
    };
  }

  async recordUsage(principal: AuthPrincipal, jobIdRaw: string, input: RecordSupplyUsageInput) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "SUPPLY_TRACKING");
    const source = await this.resolveJob(context.providerId, jobIdRaw);
    this.assertWritable(source);

    const supplyItemId = this.id(input?.supplyItemId, "supplyItemId");
    const unitCode = this.unit(input?.unitCode);
    const idempotencyKey = this.idempotency(input?.idempotencyKey);
    const quantity = this.quantity(input?.quantity);
    const item = await this.prisma.supplyItem.findUnique({ where: { id: supplyItemId } });
    if (!item || !item.active) throw new BadRequestException("An active supply catalog item is required.");
    if (item.unitCode !== unitCode) {
      throw new BadRequestException("unitCode must match the supply item's canonical unit.");
    }

    const existing = await this.prisma.supplyUsage.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.providerId !== context.providerId ||
        existing.sourceType !== source.sourceType ||
        existing.sourceId !== source.sourceId ||
        existing.supplyItemId !== item.id ||
        existing.unitCode !== unitCode ||
        !existing.quantity.equals(quantity)
      ) {
        throw new ConflictException("idempotencyKey is already bound to different supply usage.");
      }
      return this.presentUsage(existing, item);
    }

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        if (source.sourceType === "HOME_VISIT") {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM "Appointment" WHERE id = ${source.sourceId} FOR UPDATE`);
        } else {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${source.sourceId} FOR UPDATE`);
        }
        const locked = await this.resolveJobInTransaction(tx, context.providerId, source);
        this.assertWritable(locked);
        const currentItem = await tx.supplyItem.findUnique({ where: { id: item.id } });
        if (!currentItem?.active) throw new ConflictException("Supply catalog item is no longer active.");
        if (currentItem.unitCode !== unitCode) throw new ConflictException("Supply catalog unit changed.");
        const usage = await tx.supplyUsage.create({
          data: {
            idempotencyKey,
            sourceType: locked.sourceType,
            sourceId: locked.sourceId,
            providerId: context.providerId,
            patientId: locked.patientId,
            supplyItemId: currentItem.id,
            quantity,
            unitCode,
            actorAccountId: principal.accountId,
          },
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "SUPPLY_USAGE_RECORDED",
          objectType: "SUPPLY_USAGE",
          objectId: usage.id,
          purpose: "FIELD_SERVICE_OPERATIONS",
          result: "SUCCESS",
          metadata: {
            providerId: context.providerId,
            jobId: this.jobId(locked),
            sourceType: locked.sourceType,
            supplyItemId: currentItem.id,
            supplyCode: currentItem.code,
            quantity: quantity.toString(),
            unitCode,
            clinicalDataIncluded: false,
          },
        });
        return usage;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.supplyUsage.findUnique({ where: { idempotencyKey } });
      if (!raced) throw error;
      if (
        raced.providerId !== context.providerId ||
        raced.sourceType !== source.sourceType ||
        raced.sourceId !== source.sourceId ||
        raced.supplyItemId !== item.id ||
        raced.unitCode !== unitCode ||
        !raced.quantity.equals(quantity)
      ) {
        throw new ConflictException("Supply usage changed concurrently.");
      }
      created = raced;
    }
    return this.presentUsage(created, item);
  }

  private presentUsage(row: {
    id: string;
    supplyItemId: string;
    quantity: Prisma.Decimal;
    unitCode: string;
    recordedAt: Date;
  }, item: { code: string; labels: Prisma.JsonValue }) {
    return {
      id: row.id,
      supplyItemId: row.supplyItemId,
      code: item.code,
      labels: item.labels,
      quantity: Number(row.quantity.toString()),
      unitCode: row.unitCode,
      recordedAt: row.recordedAt,
      patientClinicalDataIncluded: false,
    };
  }

  private async resolveJob(providerId: string, jobIdRaw: string): Promise<SupplySource> {
    const { sourceType, sourceId } = this.parseJobId(jobIdRaw);
    if (sourceType === "HOME_VISIT") {
      const row = await this.prisma.appointment.findFirst({
        where: { id: sourceId, providerId, modality: "HOME_VISIT" },
        select: { id: true, providerId: true, patientId: true, status: true },
      });
      if (!row) throw new NotFoundException("Assigned field job not found.");
      return { sourceType, sourceId: row.id, providerId: row.providerId, patientId: row.patientId, status: row.status };
    }
    const row = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: sourceId, assignedProviderId: providerId },
      select: { id: true, assignedProviderId: true, patientId: true, status: true },
    });
    if (!row?.assignedProviderId) throw new NotFoundException("Assigned field job not found.");
    return { sourceType, sourceId: row.id, providerId: row.assignedProviderId, patientId: row.patientId, status: row.status };
  }

  private async resolveJobInTransaction(
    tx: Prisma.TransactionClient,
    providerId: string,
    source: SupplySource,
  ): Promise<SupplySource> {
    if (source.sourceType === "HOME_VISIT") {
      const row = await tx.appointment.findFirst({
        where: { id: source.sourceId, providerId, modality: "HOME_VISIT" },
        select: { id: true, providerId: true, patientId: true, status: true },
      });
      if (!row) throw new NotFoundException("Assigned field job not found.");
      return { sourceType: "HOME_VISIT", sourceId: row.id, providerId: row.providerId, patientId: row.patientId, status: row.status };
    }
    const row = await tx.medicalTransportRequest.findFirst({
      where: { id: source.sourceId, assignedProviderId: providerId },
      select: { id: true, assignedProviderId: true, patientId: true, status: true },
    });
    if (!row?.assignedProviderId) throw new NotFoundException("Assigned field job not found.");
    return { sourceType: "MEDICAL_TRANSPORT", sourceId: row.id, providerId: row.assignedProviderId, patientId: row.patientId, status: row.status };
  }

  private assertWritable(source: SupplySource) {
    if (source.sourceType === "HOME_VISIT") {
      if (source.status !== "CONFIRMED") throw new ConflictException("Supplies can be recorded only for an active confirmed home visit.");
      return;
    }
    if (!WRITABLE_TRANSPORT.has(source.status)) {
      throw new ConflictException("Supplies can be recorded only while transport work is active.");
    }
  }

  private parseJobId(value: unknown): { sourceType: SourceType; sourceId: string } {
    if (typeof value !== "string") throw new BadRequestException("jobId is invalid.");
    const split = value.indexOf(":");
    if (split <= 0) throw new BadRequestException("jobId is invalid.");
    const sourceType = value.slice(0, split).trim().toUpperCase();
    const sourceId = value.slice(split + 1).trim();
    if (!SOURCE_TYPES.has(sourceType) || !SAFE_ID.test(sourceId)) throw new BadRequestException("jobId is invalid.");
    return { sourceType: sourceType as SourceType, sourceId };
  }

  private jobId(source: Pick<SupplySource, "sourceType" | "sourceId">) {
    return `${source.sourceType}:${source.sourceId}`;
  }

  private code(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("code is required.");
    const normalized = value.trim().toUpperCase();
    if (!SAFE_CODE.test(normalized)) throw new BadRequestException("code is invalid.");
    return normalized;
  }

  private labels(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("labels must be an object.");
    const raw = value as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const locale of ["en", "ar", "fr", "es"] as const) {
      if (typeof raw[locale] !== "string") throw new BadRequestException(`labels.${locale} is required.`);
      const text = raw[locale].trim();
      if (!text || text.length > 160 || /\p{Cc}/u.test(text)) throw new BadRequestException(`labels.${locale} is invalid.`);
      output[locale] = text;
    }
    return output;
  }

  private unit(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("unitCode is required.");
    const normalized = value.trim();
    if (!SAFE_UNIT.test(normalized)) throw new BadRequestException("unitCode is invalid.");
    return normalized;
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private idempotency(value: unknown) {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }

  private quantity(value: unknown) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 1_000_000) {
      throw new BadRequestException("quantity must be greater than zero and not exceed 1000000.");
    }
    const rounded = Math.round(numeric * 1000) / 1000;
    if (Math.abs(rounded - numeric) > 1e-9) {
      throw new BadRequestException("quantity supports at most three decimal places.");
    }
    return new Prisma.Decimal(rounded.toFixed(3));
  }

  private uniqueConflict(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@Controller("admin/supplies/catalog")
class AdminSupplyCatalogController {
  constructor(private readonly supplies: ProviderSuppliesService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get()
  @Header("Cache-Control", "no-store")
  list() { return this.supplies.adminCatalog(); }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateSupplyItemInput) {
    return this.supplies.createCatalogItem(principal, body ?? {});
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Patch(":itemId/status")
  @Header("Cache-Control", "no-store")
  status(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("itemId") itemId: string,
    @Body() body: SupplyItemStatusInput,
  ) {
    return this.supplies.setCatalogStatus(principal, itemId, body ?? {});
  }
}

@Controller("provider")
class ProviderSuppliesController {
  constructor(private readonly supplies: ProviderSuppliesService) {}

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get("supplies/catalog")
  @Header("Cache-Control", "no-store")
  catalog(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.supplies.providerCatalog(principal);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get("jobs/:jobId/supplies")
  @Header("Cache-Control", "no-store")
  usage(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string) {
    return this.supplies.jobUsage(principal, jobId);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("jobs/:jobId/supplies")
  @Header("Cache-Control", "no-store")
  record(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
    @Body() body: RecordSupplyUsageInput,
  ) {
    return this.supplies.recordUsage(principal, jobId, body ?? {});
  }
}

@Module({
  imports: [ProvidersModule],
  controllers: [AdminSupplyCatalogController, ProviderSuppliesController],
  providers: [ProviderSuppliesService],
})
export class ProviderSuppliesModule {}
