import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const SOURCE_TYPES = new Set(["HOME_VISIT", "MEDICAL_TRANSPORT"]);
const SIGNAL_EVENTS = new Set(["ACKNOWLEDGED", "ARRIVAL_CONFIRMED"]);
const CHECKLIST_STATES = new Set(["DONE", "NOT_DONE", "NOT_APPLICABLE"]);
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const ACTIVE_TRANSPORT = new Set(["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"]);

type SourceType = "HOME_VISIT" | "MEDICAL_TRANSPORT";
type FieldJobSource = {
  sourceType: SourceType;
  sourceId: string;
  providerId: string;
  patientId: string;
  status: string;
  scheduledAt: Date;
  endsAt: Date | null;
  completedAt: Date | null;
  transportMode: string | null;
};
type ChecklistItem = { code: string; state: "DONE" | "NOT_DONE" | "NOT_APPLICABLE" };
type ChecklistBody = { items?: unknown; idempotencyKey?: string };
type EventBody = { eventType?: string; idempotencyKey?: string };
type CompletionBody = { idempotencyKey?: string };

@Injectable()
class ProviderFieldJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async list(principal: AuthPrincipal) {
    const provider = await this.requireProvider(principal);
    const [appointments, transports] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          providerId: provider.id,
          modality: "HOME_VISIT",
          status: { in: ["CONFIRMED", "COMPLETED"] },
        },
        orderBy: { startsAt: "desc" },
        take: 100,
      }),
      this.prisma.medicalTransportRequest.findMany({
        where: {
          assignedProviderId: provider.id,
          status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING", "COMPLETED"] },
        },
        orderBy: { scheduledFor: "desc" },
        take: 100,
      }),
    ]);

    const jobs = [
      ...appointments.map((row) => this.presentSource({
        sourceType: "HOME_VISIT",
        sourceId: row.id,
        providerId: row.providerId,
        patientId: row.patientId,
        status: row.status,
        scheduledAt: row.startsAt,
        endsAt: row.endsAt,
        completedAt: row.status === "COMPLETED" ? row.updatedAt : null,
        transportMode: null,
      })),
      ...transports.map((row) => this.presentSource({
        sourceType: "MEDICAL_TRANSPORT",
        sourceId: row.id,
        providerId: row.assignedProviderId!,
        patientId: row.patientId,
        status: row.status,
        scheduledAt: row.scheduledFor,
        endsAt: null,
        completedAt: row.completedAt,
        transportMode: row.mode,
      })),
    ].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));

    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_FIELD_JOBS_READ",
      objectType: "PROVIDER",
      objectId: provider.id,
      purpose: "FIELD_SERVICE_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        jobCount: jobs.length,
        homeVisitCount: appointments.length,
        transportCount: transports.length,
        slaPolicy: "SCHEDULE_START_SLA_V1",
      },
    });
    return {
      items: jobs,
      sourceOfTruth: {
        HOME_VISIT: "Appointment",
        MEDICAL_TRANSPORT: "MedicalTransportRequest",
      },
      duplicatedJobState: false,
      slaPolicy: "SCHEDULE_START_SLA_V1",
    };
  }

  async detail(principal: AuthPrincipal, jobIdRaw: string) {
    const provider = await this.requireProvider(principal);
    const source = await this.resolveJob(provider.id, jobIdRaw);
    const [events, checklist, completion, transportEvents] = await Promise.all([
      this.prisma.providerFieldJobEvent.findMany({
        where: { sourceType: source.sourceType, sourceId: source.sourceId, providerId: provider.id },
        orderBy: { sequence: "asc" },
        take: 200,
      }),
      this.prisma.providerFieldJobChecklistRevision.findFirst({
        where: { sourceType: source.sourceType, sourceId: source.sourceId, providerId: provider.id },
        orderBy: { revision: "desc" },
      }),
      this.prisma.providerFieldServiceCompletion.findUnique({
        where: { sourceType_sourceId: { sourceType: source.sourceType, sourceId: source.sourceId } },
      }),
      source.sourceType === "MEDICAL_TRANSPORT"
        ? this.prisma.medicalTransportEvent.findMany({
            where: { transportRequestId: source.sourceId },
            orderBy: { occurredAt: "asc" },
            take: 200,
          })
        : Promise.resolve([]),
    ]);

    const timeline = [
      ...transportEvents.map((event) => ({
        type: "SOURCE_STATUS",
        occurredAt: event.occurredAt,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        eventId: event.id,
      })),
      ...events.map((event) => ({
        type: event.eventType,
        occurredAt: event.occurredAt,
        sourceStatus: event.sourceStatus,
        eventId: event.id,
        sequence: event.sequence,
      })),
    ].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_FIELD_JOB_TIMELINE_READ",
      objectType: "PROVIDER_FIELD_JOB",
      objectId: this.jobId(source),
      purpose: "FIELD_SERVICE_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        sourceType: source.sourceType,
        eventCount: timeline.length,
        checklistRevision: checklist?.revision ?? null,
        completionRecorded: Boolean(completion),
      },
    });

    return {
      ...this.presentSource(source),
      timeline,
      latestChecklist: checklist
        ? {
            id: checklist.id,
            revision: checklist.revision,
            items: checklist.items,
            recordedAt: checklist.recordedAt,
          }
        : null,
      serviceCompletion: completion
        ? {
            id: completion.id,
            completionCode: completion.completionCode,
            sourceStatus: completion.sourceStatus,
            completedAt: completion.completedAt,
          }
        : null,
    };
  }


  async financialSummary(principal: AuthPrincipal, jobIdRaw: string) {
    const provider = await this.requireProvider(principal);
    const source = await this.resolveJob(provider.id, jobIdRaw);

    if (source.sourceType === "MEDICAL_TRANSPORT") {
      const response = {
        job: this.presentSource(source),
        state: "NOT_BILLED" as const,
        billingLinkState: "NO_CANONICAL_BILLING_LINK" as const,
        invoice: null,
        ledgerEntries: [],
        payouts: [],
        ledgerNetMinorByCurrency: {},
      };
      await this.audit.write({
        actorId: principal.accountId,
        action: "PROVIDER_FIELD_JOB_FINANCE_READ",
        objectType: "PROVIDER_FIELD_JOB",
        objectId: this.jobId(source),
        purpose: "PROVIDER_FINANCE",
        result: "SUCCESS",
        metadata: {
          sourceType: source.sourceType,
          financeState: response.state,
          billingLinkState: response.billingLinkState,
          invoicePresent: false,
          ledgerEntryCount: 0,
          payoutCount: 0,
        },
      });
      return response;
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { appointmentId: source.sourceId },
    });
    if (!invoice || invoice.providerId !== provider.id) {
      const response = {
        job: this.presentSource(source),
        state: "NOT_BILLED" as const,
        billingLinkState: "NO_INVOICE" as const,
        invoice: null,
        ledgerEntries: [],
        payouts: [],
        ledgerNetMinorByCurrency: {},
      };
      await this.audit.write({
        actorId: principal.accountId,
        action: "PROVIDER_FIELD_JOB_FINANCE_READ",
        objectType: "PROVIDER_FIELD_JOB",
        objectId: this.jobId(source),
        purpose: "PROVIDER_FINANCE",
        result: "SUCCESS",
        metadata: {
          sourceType: source.sourceType,
          financeState: response.state,
          billingLinkState: response.billingLinkState,
          invoicePresent: false,
          ledgerEntryCount: 0,
          payoutCount: 0,
        },
      });
      return response;
    }

    const ledgerEntries = await this.prisma.providerLedgerEntry.findMany({
      where: {
        providerId: provider.id,
        invoiceId: invoice.id,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
    });
    const payoutIds = [...new Set(
      ledgerEntries
        .map((entry) => entry.payoutId)
        .filter((value): value is string => Boolean(value)),
    )];
    const payouts = payoutIds.length === 0
      ? []
      : await this.prisma.providerPayout.findMany({
          where: {
            providerId: provider.id,
            id: { in: payoutIds },
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 100,
        });

    const ledgerNetMinorByCurrency: Record<string, number> = {};
    for (const entry of ledgerEntries) {
      ledgerNetMinorByCurrency[entry.currency] =
        (ledgerNetMinorByCurrency[entry.currency] ?? 0) + entry.amountMinor;
    }

    const response = {
      job: this.presentSource(source),
      state: "READY" as const,
      billingLinkState: "INVOICE_LINKED" as const,
      invoice: {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
        totalMinor: invoice.totalMinor,
        patientResponsibilityMinor: invoice.patientResponsibilityMinor,
        insurerResponsibilityMinor: invoice.insurerResponsibilityMinor,
        amountPaidMinor: invoice.amountPaidMinor,
        amountRefundedMinor: invoice.amountRefundedMinor,
        balanceDueMinor: invoice.balanceDueMinor,
        issuedAt: invoice.issuedAt,
        updatedAt: invoice.updatedAt,
      },
      ledgerEntries: ledgerEntries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        payoutId: entry.payoutId,
        createdAt: entry.createdAt,
        availableAt: entry.availableAt,
      })),
      payouts: payouts.map((payout) => ({
        id: payout.id,
        status: payout.status,
        amountMinor: payout.amountMinor,
        currency: payout.currency,
        periodStart: payout.periodStart,
        periodEnd: payout.periodEnd,
        createdAt: payout.createdAt,
        paidAt: payout.paidAt,
      })),
      ledgerNetMinorByCurrency,
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_FIELD_JOB_FINANCE_READ",
      objectType: "PROVIDER_FIELD_JOB",
      objectId: this.jobId(source),
      purpose: "PROVIDER_FINANCE",
      result: "SUCCESS",
      metadata: {
        sourceType: source.sourceType,
        financeState: response.state,
        billingLinkState: response.billingLinkState,
        invoicePresent: true,
        invoiceStatus: invoice.status,
        ledgerEntryCount: ledgerEntries.length,
        payoutCount: payouts.length,
        currencies: Object.keys(ledgerNetMinorByCurrency).sort(),
      },
    });
    return response;
  }

  async recordSignal(principal: AuthPrincipal, jobIdRaw: string, input: EventBody) {
    const provider = await this.requireProvider(principal);
    const source = await this.resolveJob(provider.id, jobIdRaw);
    const eventType = this.vocabulary(input.eventType, SIGNAL_EVENTS, "eventType");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    this.assertSignalAllowed(source, eventType);
    const requestDigest = this.digest({ sourceType: source.sourceType, sourceId: source.sourceId, eventType });
    await this.appendEventWithRetry(principal, source, eventType, idempotencyKey, requestDigest);
    return this.detail(principal, this.jobId(source));
  }

  async recordChecklist(principal: AuthPrincipal, jobIdRaw: string, input: ChecklistBody) {
    const provider = await this.requireProvider(principal);
    const source = await this.resolveJob(provider.id, jobIdRaw);
    if (this.isTerminal(source.status)) throw new ConflictException("Checklist cannot be changed after the source job is terminal.");
    const items = this.checklistItems(input.items);
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const requestDigest = this.digest({ sourceType: source.sourceType, sourceId: source.sourceId, items });
    const existing = await this.prisma.providerFieldJobChecklistRevision.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.sourceType !== source.sourceType || existing.sourceId !== source.sourceId || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different checklist content.");
      }
      return this.detail(principal, this.jobId(source));
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        const locked = await this.lockAndReload(tx, provider.id, source);
        if (this.isTerminal(locked.status)) throw new ConflictException("Checklist cannot be changed after the source job is terminal.");
        const prior = await tx.providerFieldJobChecklistRevision.findFirst({
          where: { sourceType: source.sourceType, sourceId: source.sourceId },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        const created = await tx.providerFieldJobChecklistRevision.create({
          data: {
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            providerId: provider.id,
            patientId: source.patientId,
            revision: (prior?.revision ?? 0) + 1,
            items,
            idempotencyKey,
            requestDigest,
            recordedByAccountId: principal.accountId,
            recordedAt: new Date(),
          },
        });
        await this.appendEventInTransaction(tx, principal, locked, "CHECKLIST_RECORDED", `${idempotencyKey}:event`, this.digest({ requestDigest, event: "CHECKLIST_RECORDED" }));
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "PROVIDER_FIELD_JOB_CHECKLIST_RECORDED",
          objectType: "PROVIDER_FIELD_JOB",
          objectId: this.jobId(source),
          purpose: "FIELD_SERVICE_OPERATIONS",
          result: "SUCCESS",
          metadata: {
            sourceType: source.sourceType,
            revision: created.revision,
            itemCount: items.length,
            doneCount: items.filter((item) => item.state === "DONE").length,
            notDoneCount: items.filter((item) => item.state === "NOT_DONE").length,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.providerFieldJobChecklistRevision.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.requestDigest !== requestDigest || raced.sourceId !== source.sourceId || raced.sourceType !== source.sourceType) {
        throw new ConflictException("Field-job checklist changed concurrently. Refresh and retry.");
      }
    }
    return this.detail(principal, this.jobId(source));
  }

  async complete(principal: AuthPrincipal, jobIdRaw: string, input: CompletionBody) {
    const provider = await this.requireProvider(principal);
    const source = await this.resolveJob(provider.id, jobIdRaw);
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const requestDigest = this.digest({ sourceType: source.sourceType, sourceId: source.sourceId, completionCode: "SERVICE_DELIVERED" });
    const existing = await this.prisma.providerFieldServiceCompletion.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.sourceType !== source.sourceType || existing.sourceId !== source.sourceId || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different completion content.");
      }
      return this.detail(principal, this.jobId(source));
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        const locked = await this.lockAndReload(tx, provider.id, source);
        const latestChecklist = await tx.providerFieldJobChecklistRevision.findFirst({
          where: { sourceType: locked.sourceType, sourceId: locked.sourceId },
          orderBy: { revision: "desc" },
        });
        if (latestChecklist) {
          const items = this.checklistItems(latestChecklist.items);
          if (items.some((item) => item.state === "NOT_DONE")) {
            throw new ConflictException("The latest checklist contains incomplete required items.");
          }
        }

        if (locked.sourceType === "HOME_VISIT") {
          if (locked.status !== "CONFIRMED" && locked.status !== "COMPLETED") {
            throw new ConflictException("Home-visit service completion requires a confirmed appointment.");
          }
          if (locked.status === "CONFIRMED") {
            const changed = await tx.appointment.updateMany({
              where: { id: locked.sourceId, providerId: provider.id, modality: "HOME_VISIT", status: "CONFIRMED" },
              data: { status: "COMPLETED" },
            });
            if (changed.count !== 1) throw new ConflictException("Home-visit job changed concurrently. Refresh and retry.");
          }
        } else {
          if (locked.status !== "TRANSPORTING" && locked.status !== "COMPLETED") {
            throw new ConflictException("Medical transport completion requires TRANSPORTING state.");
          }
          if (locked.status === "TRANSPORTING") {
            const completedAt = new Date();
            const changed = await tx.medicalTransportRequest.updateMany({
              where: { id: locked.sourceId, assignedProviderId: provider.id, status: "TRANSPORTING" },
              data: { status: "COMPLETED", completedAt },
            });
            if (changed.count !== 1) throw new ConflictException("Medical transport job changed concurrently. Refresh and retry.");
            await tx.medicalTransportEvent.create({
              data: {
                transportRequestId: locked.sourceId,
                actorAccountId: principal.accountId,
                fromStatus: "TRANSPORTING",
                toStatus: "COMPLETED",
                providerId: provider.id,
              },
            });
          }
        }

        const completedAt = new Date();
        await tx.providerFieldServiceCompletion.create({
          data: {
            sourceType: locked.sourceType,
            sourceId: locked.sourceId,
            providerId: provider.id,
            patientId: locked.patientId,
            completionCode: "SERVICE_DELIVERED",
            sourceStatus: "COMPLETED",
            idempotencyKey,
            requestDigest,
            completedByAccountId: principal.accountId,
            completedAt,
          },
        });
        await this.appendEventInTransaction(tx, principal, { ...locked, status: "COMPLETED", completedAt }, "SERVICE_COMPLETED", `${idempotencyKey}:event`, this.digest({ requestDigest, event: "SERVICE_COMPLETED" }));
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "PROVIDER_FIELD_JOB_SERVICE_COMPLETED",
          objectType: "PROVIDER_FIELD_JOB",
          objectId: this.jobId(locked),
          purpose: "FIELD_SERVICE_OPERATIONS",
          result: "SUCCESS",
          metadata: { sourceType: locked.sourceType, completionCode: "SERVICE_DELIVERED" },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.providerFieldServiceCompletion.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.requestDigest !== requestDigest || raced.sourceId !== source.sourceId || raced.sourceType !== source.sourceType) {
        throw new ConflictException("Field-job completion changed concurrently. Refresh and retry.");
      }
    }
    return this.detail(principal, this.jobId(source));
  }

  private async appendEventWithRetry(
    principal: AuthPrincipal,
    source: FieldJobSource,
    eventType: string,
    idempotencyKey: string,
    requestDigest: string,
  ) {
    const existing = await this.prisma.providerFieldJobEvent.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.sourceType !== source.sourceType || existing.sourceId !== source.sourceId || existing.eventType !== eventType || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different field-job event content.");
      }
      return;
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        const locked = await this.lockAndReload(tx, source.providerId, source);
        this.assertSignalAllowed(locked, eventType);
        await this.appendEventInTransaction(tx, principal, locked, eventType, idempotencyKey, requestDigest);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.providerFieldJobEvent.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.requestDigest !== requestDigest || raced.eventType !== eventType || raced.sourceId !== source.sourceId) {
        throw new ConflictException("Field-job event changed concurrently. Refresh and retry.");
      }
    }
  }

  private async appendEventInTransaction(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    source: FieldJobSource,
    eventType: string,
    idempotencyKey: string,
    requestDigest: string,
  ) {
    const prior = await tx.providerFieldJobEvent.findFirst({
      where: { sourceType: source.sourceType, sourceId: source.sourceId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const created = await tx.providerFieldJobEvent.create({
      data: {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        providerId: source.providerId,
        patientId: source.patientId,
        sequence: (prior?.sequence ?? 0) + 1,
        eventType,
        sourceStatus: source.status,
        idempotencyKey,
        requestDigest,
        actorAccountId: principal.accountId,
        occurredAt: new Date(),
      },
    });
    await this.audit.writeInTransaction(tx, {
      actorId: principal.accountId,
      action: "PROVIDER_FIELD_JOB_EVENT_RECORDED",
      objectType: "PROVIDER_FIELD_JOB",
      objectId: this.jobId(source),
      purpose: "FIELD_SERVICE_OPERATIONS",
      result: "SUCCESS",
      metadata: { sourceType: source.sourceType, eventType, sequence: created.sequence, sourceStatus: source.status },
    });
  }

  private async lockAndReload(tx: Prisma.TransactionClient, providerId: string, source: FieldJobSource): Promise<FieldJobSource> {
    if (source.sourceType === "HOME_VISIT") {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Appointment" WHERE id = ${source.sourceId} FOR UPDATE`);
      const row = await tx.appointment.findFirst({ where: { id: source.sourceId, providerId, modality: "HOME_VISIT" } });
      if (!row) throw new NotFoundException("Assigned field job not found.");
      return {
        sourceType: "HOME_VISIT",
        sourceId: row.id,
        providerId: row.providerId,
        patientId: row.patientId,
        status: row.status,
        scheduledAt: row.startsAt,
        endsAt: row.endsAt,
        completedAt: row.status === "COMPLETED" ? row.updatedAt : null,
        transportMode: null,
      };
    }
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${source.sourceId} FOR UPDATE`);
    const row = await tx.medicalTransportRequest.findFirst({ where: { id: source.sourceId, assignedProviderId: providerId } });
    if (!row) throw new NotFoundException("Assigned field job not found.");
    return {
      sourceType: "MEDICAL_TRANSPORT",
      sourceId: row.id,
      providerId,
      patientId: row.patientId,
      status: row.status,
      scheduledAt: row.scheduledFor,
      endsAt: null,
      completedAt: row.completedAt,
      transportMode: row.mode,
    };
  }

  private async resolveJob(providerId: string, jobIdRaw: string): Promise<FieldJobSource> {
    const { sourceType, sourceId } = this.parseJobId(jobIdRaw);
    if (sourceType === "HOME_VISIT") {
      const row = await this.prisma.appointment.findFirst({ where: { id: sourceId, providerId, modality: "HOME_VISIT" } });
      if (!row) throw new NotFoundException("Assigned field job not found.");
      return {
        sourceType,
        sourceId: row.id,
        providerId: row.providerId,
        patientId: row.patientId,
        status: row.status,
        scheduledAt: row.startsAt,
        endsAt: row.endsAt,
        completedAt: row.status === "COMPLETED" ? row.updatedAt : null,
        transportMode: null,
      };
    }
    const row = await this.prisma.medicalTransportRequest.findFirst({ where: { id: sourceId, assignedProviderId: providerId } });
    if (!row) throw new NotFoundException("Assigned field job not found.");
    return {
      sourceType,
      sourceId: row.id,
      providerId,
      patientId: row.patientId,
      status: row.status,
      scheduledAt: row.scheduledFor,
      endsAt: null,
      completedAt: row.completedAt,
      transportMode: row.mode,
    };
  }

  private presentSource(source: FieldJobSource) {
    return {
      id: this.jobId(source),
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      patientId: source.patientId,
      providerId: source.providerId,
      sourceStatus: source.status,
      scheduledAt: source.scheduledAt.toISOString(),
      endsAt: source.endsAt?.toISOString() ?? null,
      transportMode: source.transportMode,
      normalizedState: this.normalizedState(source),
      sla: this.sla(source),
      allowedActions: this.allowedActions(source),
    };
  }

  private normalizedState(source: FieldJobSource): string {
    if (source.status === "COMPLETED") return "COMPLETED";
    if (source.status === "CANCELLED" || source.status === "NO_SHOW") return "CANCELLED";
    if (source.sourceType === "MEDICAL_TRANSPORT") {
      if (source.status === "EN_ROUTE") return "EN_ROUTE";
      if (source.status === "ARRIVED") return "ARRIVED";
      if (source.status === "TRANSPORTING") return "IN_PROGRESS";
    }
    return "READY";
  }

  private sla(source: FieldJobSource) {
    const completed = source.status === "COMPLETED";
    const terminalWithoutCompletion = source.status === "CANCELLED" || source.status === "NO_SHOW";
    const now = Date.now();
    const target = source.scheduledAt.getTime();
    const state = terminalWithoutCompletion ? "NOT_APPLICABLE" : completed ? "COMPLETED" : now > target ? "BREACHED" : "PENDING";
    return {
      policy: "SCHEDULE_START_SLA_V1",
      targetAt: source.scheduledAt.toISOString(),
      state,
      minutesToTarget: Math.round((target - now) / 60_000),
    };
  }

  private allowedActions(source: FieldJobSource): string[] {
    if (this.isTerminal(source.status)) return [];
    const actions = ["ACKNOWLEDGED", "CHECKLIST"];
    if (source.sourceType === "HOME_VISIT") {
      if (source.status === "CONFIRMED") actions.push("ARRIVAL_CONFIRMED", "COMPLETE");
    } else {
      if (source.status === "ARRIVED") actions.push("ARRIVAL_CONFIRMED");
      if (source.status === "TRANSPORTING") actions.push("COMPLETE");
    }
    return actions;
  }

  private assertSignalAllowed(source: FieldJobSource, eventType: string) {
    if (this.isTerminal(source.status)) throw new ConflictException("Field-job events cannot be added after the source job is terminal.");
    if (eventType === "ARRIVAL_CONFIRMED") {
      if (source.sourceType === "HOME_VISIT" && source.status !== "CONFIRMED") {
        throw new ConflictException("Home-visit arrival can be confirmed only for a confirmed appointment.");
      }
      if (source.sourceType === "MEDICAL_TRANSPORT" && source.status !== "ARRIVED") {
        throw new ConflictException("Transport arrival evidence requires ARRIVED source status.");
      }
    }
  }

  private isTerminal(status: string) {
    return status === "COMPLETED" || status === "CANCELLED" || status === "NO_SHOW";
  }

  private checklistItems(value: unknown): ChecklistItem[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
      throw new BadRequestException("items must contain between 1 and 50 checklist items.");
    }
    const items = value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new BadRequestException("Each checklist item must be an object.");
      const raw = item as Record<string, unknown>;
      const code = this.vocabulary(raw.code, null, "checklist code");
      if (!SAFE_CODE.test(code)) throw new BadRequestException("checklist code is invalid.");
      const state = this.vocabulary(raw.state, CHECKLIST_STATES, "checklist state") as ChecklistItem["state"];
      const unexpected = Object.keys(raw).filter((key) => key !== "code" && key !== "state");
      if (unexpected.length) throw new BadRequestException("Checklist items accept only code and state.");
      return { code, state };
    }).sort((a, b) => a.code.localeCompare(b.code));
    if (new Set(items.map((item) => item.code)).size !== items.length) throw new BadRequestException("Checklist codes must be unique.");
    return items;
  }

  private async requireProvider(principal: AuthPrincipal) {
    if (principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("Unified field jobs require an Other Provider account.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    if (!provider || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE" || !provider.otherProviderProfile?.category.active) {
      throw new ForbiddenException("An active Other Provider profile is required.");
    }
    return provider;
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

  private jobId(source: Pick<FieldJobSource, "sourceType" | "sourceId">) {
    return `${source.sourceType}:${source.sourceId}`;
  }

  private vocabulary(value: unknown, allowed: Set<string> | null, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!normalized || (allowed && !allowed.has(normalized))) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }

  private digest(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private uniqueConflict(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@Controller("provider/jobs")
class ProviderFieldJobsController {
  constructor(private readonly jobs: ProviderFieldJobsService) {}

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.jobs.list(principal);
  }

  @RequirePermissions("PROVIDER_READ_FINANCIALS")
  @Get(":jobId/financial-summary")
  @Header("Cache-Control", "no-store")
  financialSummary(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string) {
    return this.jobs.financialSummary(principal, jobId);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get(":jobId")
  @Header("Cache-Control", "no-store")
  detail(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string) {
    return this.jobs.detail(principal, jobId);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post(":jobId/events")
  @Header("Cache-Control", "no-store")
  event(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string, @Body() body: EventBody) {
    return this.jobs.recordSignal(principal, jobId, body ?? {});
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post(":jobId/checklist")
  @Header("Cache-Control", "no-store")
  checklist(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string, @Body() body: ChecklistBody) {
    return this.jobs.recordChecklist(principal, jobId, body ?? {});
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post(":jobId/complete")
  @Header("Cache-Control", "no-store")
  complete(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string, @Body() body: CompletionBody) {
    return this.jobs.complete(principal, jobId, body ?? {});
  }
}

@Module({
  controllers: [ProviderFieldJobsController],
  providers: [ProviderFieldJobsService],
})
export class ProviderFieldJobsModule {}
