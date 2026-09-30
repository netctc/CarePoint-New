import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import {
  SpecimenConditionCodes,
  SpecimenCustodyEventTypes,
  specimenCustodyEventHash,
  verifySpecimenCustodyChain,
  type SpecimenConditionCode,
  type SpecimenCustodyEventType,
} from "./specimen-custody.engine";

const ORDER_CONSENT_SCOPE = "CLINICAL_ORDER_READ";
const ORDER_CONSENT_VERSION = "clinical-orders-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const COLLECTION_BACKDATE_DAYS = 30;
const TOKEN = /^[A-Z][A-Z0-9_]{1,79}$/;
const BARCODE = /^[A-Za-z0-9._:-]{3,120}$/;

@Injectable()
export class SpecimensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async collect(principal: AuthPrincipal, input: Record<string, unknown>) {
    const context = await this.requireCollectionCapability(principal);
    const orderId = this.requiredId(input.orderId, "orderId");
    const order = await this.requireLaboratoryOrderAccess(
      context.providerId,
      orderId,
      true,
    );
    const specimenTypeCode = this.code(input.specimenTypeCode, "specimenTypeCode");
    const conditionCode = this.condition(input.conditionCode ?? "ACCEPTABLE");
    const collectedAt = this.collectionDate(input.collectedAt);
    const collectionLocation = this.optionalText(input.collectionLocation, 160, "collectionLocation");
    const specimenIdentifier = this.newIdentifier();
    const barcode = this.barcode(input.barcode, specimenIdentifier);

    const existing = await this.prisma.specimen.findUnique({ where: { barcode } });
    if (existing) {
      if (
        existing.orderId === order.id &&
        existing.patientId === order.patientId &&
        existing.collectedByProviderId === context.providerId
      ) {
        return this.presentSpecimen(existing);
      }
      throw new ConflictException("Specimen barcode is already assigned.");
    }

    const specimen = await this.prisma.$transaction(async (tx) => {
      const created = await tx.specimen.create({
        data: {
          specimenIdentifier,
          barcode,
          orderId: order.id,
          patientId: order.patientId,
          collectedByProviderId: context.providerId,
          specimenTypeCode,
          conditionCode,
          collectionLocation,
          collectedAt,
          status: conditionCode === "REJECTED" ? "REJECTED" : "COLLECTED",
        },
      });
      const eventInput = {
        specimenId: created.id,
        sequence: 1,
        eventType: "COLLECTED" as const,
        actorProviderId: context.providerId,
        receiverRef: null,
        occurredAt: collectedAt,
        location: collectionLocation,
        conditionCode,
        previousHash: null,
      };
      await tx.specimenCustodyEvent.create({
        data: {
          ...eventInput,
          eventHash: specimenCustodyEventHash(eventInput),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "SPECIMEN_COLLECTED",
        objectType: "SPECIMEN",
        objectId: created.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "SPECIMEN_CUSTODY",
          providerId: context.providerId,
          patientId: order.patientId,
          resourceId: created.id,
          resourceVersion: 1,
          decision: "ALLOW",
        },
      });
      return created;
    });

    return this.presentSpecimen(specimen);
  }

  async listForOrder(principal: AuthPrincipal, orderId: string) {
    const context = await this.requireCollectionCapability(principal);
    const order = await this.requireLaboratoryOrderAccess(
      context.providerId,
      this.requiredId(orderId, "orderId"),
      false,
    );
    const rows = await this.prisma.specimen.findMany({
      where: { orderId: order.id },
      include: {
        custodyEvents: {
          orderBy: { sequence: "desc" },
          take: 1,
        },
      },
      orderBy: { collectedAt: "desc" },
      take: 100,
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "SPECIMEN_ORDER_LIST_READ",
      objectType: "CLINICAL_ORDER",
      objectId: order.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "SPECIMEN_CUSTODY",
        providerId: context.providerId,
        patientId: order.patientId,
        itemCount: rows.length,
        decision: "ALLOW",
      },
    });
    return {
      orderId: order.id,
      patientId: order.patientId,
      items: rows.map((row) => ({
        ...this.presentSpecimen(row),
        latestCustodyEvent: row.custodyEvents[0]
          ? this.presentCustodyEvent(row.custodyEvents[0])
          : null,
      })),
    };
  }

  async appendCustody(
    principal: AuthPrincipal,
    specimenId: string,
    input: Record<string, unknown>,
  ) {
    const context = await this.requireCollectionCapability(principal);
    const id = this.requiredId(specimenId, "specimenId");
    const eventType = this.custodyEventType(input.eventType, false);
    const conditionCode = this.condition(input.conditionCode ?? "ACCEPTABLE");
    const receiverRef = this.optionalText(input.receiverRef, 160, "receiverRef");
    const location = this.optionalText(input.location, 160, "location");
    const occurredAt = this.eventDate(input.occurredAt);
    if (
      (eventType === "TRANSFERRED" || eventType === "RECEIVED") &&
      !receiverRef
    ) {
      throw new BadRequestException(
        "receiverRef is required for custody transfer and receipt events.",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Specimen" WHERE "id" = ${id} FOR UPDATE
      `;
      if (!locked[0]) throw new NotFoundException("Specimen not found.");
      const specimen = await tx.specimen.findUnique({ where: { id } });
      if (!specimen) throw new NotFoundException("Specimen not found.");
      await this.assertPatientOrderAccess(
        context.providerId,
        specimen.orderId,
        specimen.patientId,
        false,
        tx,
      );
      if (specimen.status === "DISPOSED") {
        throw new ConflictException("Disposed specimens cannot receive new custody events.");
      }
      const last = await tx.specimenCustodyEvent.findFirst({
        where: { specimenId: id },
        orderBy: { sequence: "desc" },
      });
      if (!last) throw new ConflictException("Specimen custody history is missing its collection event.");
      if (occurredAt.getTime() < last.occurredAt.getTime()) {
        throw new ConflictException(
          "Custody event timestamp cannot precede the previous custody event.",
        );
      }
      const sequence = last.sequence + 1;
      const eventInput = {
        specimenId: id,
        sequence,
        eventType,
        actorProviderId: context.providerId,
        receiverRef,
        occurredAt,
        location,
        conditionCode,
        previousHash: last.eventHash,
      };
      const event = await tx.specimenCustodyEvent.create({
        data: {
          ...eventInput,
          eventHash: specimenCustodyEventHash(eventInput),
        },
      });
      await tx.specimen.update({
        where: { id },
        data: {
          status: this.specimenStatus(eventType, conditionCode),
          conditionCode,
          ...(location !== null ? { collectionLocation: location } : {}),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "SPECIMEN_CUSTODY_EVENT_APPENDED",
        objectType: "SPECIMEN",
        objectId: id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "SPECIMEN_CUSTODY",
          providerId: context.providerId,
          patientId: specimen.patientId,
          resourceId: id,
          resourceVersion: sequence,
          decision: "ALLOW",
        },
      });
      return this.presentCustodyEvent(event);
    });
  }

  async custodyHistory(principal: AuthPrincipal, specimenId: string) {
    const context = await this.requireCollectionCapability(principal);
    const id = this.requiredId(specimenId, "specimenId");
    const specimen = await this.prisma.specimen.findUnique({ where: { id } });
    if (!specimen) throw new NotFoundException("Specimen not found.");
    await this.assertPatientOrderAccess(
      context.providerId,
      specimen.orderId,
      specimen.patientId,
      false,
      this.prisma,
    );
    const events = await this.prisma.specimenCustodyEvent.findMany({
      where: { specimenId: id },
      orderBy: { sequence: "asc" },
      take: 500,
    });
    const integrity = verifySpecimenCustodyChain(
      events.map((event) => ({
        specimenId: event.specimenId,
        sequence: event.sequence,
        eventType: this.custodyEventType(event.eventType, true),
        actorProviderId: event.actorProviderId,
        receiverRef: event.receiverRef,
        occurredAt: event.occurredAt,
        location: event.location,
        conditionCode: this.condition(event.conditionCode),
        previousHash: event.previousHash,
        eventHash: event.eventHash,
      })),
    );
    if (!integrity.verified) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "SPECIMEN_CUSTODY_INTEGRITY_FAILED",
        objectType: "SPECIMEN",
        objectId: id,
        purpose: "TREATMENT",
        result: "FAILED",
        metadata: {
          domain: "SPECIMEN_CUSTODY",
          providerId: context.providerId,
          patientId: specimen.patientId,
          resourceId: id,
          resourceVersion: integrity.failedSequence,
          decision: "DENY",
        },
      });
      throw new ConflictException("Specimen custody integrity verification failed.");
    }
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "SPECIMEN_CUSTODY_HISTORY_READ",
      objectType: "SPECIMEN",
      objectId: id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "SPECIMEN_CUSTODY",
        providerId: context.providerId,
        patientId: specimen.patientId,
        resourceId: id,
        itemCount: events.length,
        decision: "ALLOW",
      },
    });
    return {
      specimen: this.presentSpecimen(specimen),
      integrity,
      events: events.map((event) => this.presentCustodyEvent(event)),
    };
  }

  private async requireCollectionCapability(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.clinicalOrderCapabilities.has("SPECIMEN_COLLECTION")) {
      throw new ForbiddenException(
        "Other Provider category is not authorized for SPECIMEN_COLLECTION.",
      );
    }
    return context;
  }

  private async requireLaboratoryOrderAccess(
    providerId: string,
    orderId: string,
    requireSigned: boolean,
  ) {
    const order = await this.prisma.clinicalOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        type: true,
        status: true,
        patientId: true,
        providerId: true,
      },
    });
    if (!order) throw new NotFoundException("Clinical order not found.");
    if (order.type !== "LABORATORY") {
      throw new BadRequestException("Specimens require a laboratory order.");
    }
    if (requireSigned && order.status !== "SIGNED") {
      throw new ConflictException("Specimen collection requires a signed laboratory order.");
    }
    await this.assertPatientOrderAccess(
      providerId,
      order.id,
      order.patientId,
      order.providerId === providerId,
      this.prisma,
    );
    return order;
  }

  private async assertPatientOrderAccess(
    providerId: string,
    orderId: string,
    patientId: string,
    ownOrder: boolean,
    db: Pick<PrismaService, "appointment" | "consent" | "clinicalOrder">,
  ) {
    if (ownOrder) return;
    const order = await db.clinicalOrder.findUnique({
      where: { id: orderId },
      select: { providerId: true },
    });
    if (order?.providerId === providerId) return;
    const now = new Date();
    const from = new Date(
      now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const to = new Date(
      now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
    );
    const [relationship, consent] = await Promise.all([
      db.appointment.findFirst({
        where: {
          providerId,
          patientId,
          status: { in: ["CONFIRMED", "COMPLETED"] },
          startsAt: { gte: from, lte: to },
        },
        select: { id: true },
      }),
      db.consent.findFirst({
        where: {
          patientId,
          scope: ORDER_CONSENT_SCOPE,
          version: ORDER_CONSENT_VERSION,
          state: "GRANTED",
          AND: [
            { OR: [{ providerId }, { providerId: null }] },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
        },
        select: { id: true },
        orderBy: { grantedAt: "desc" },
      }),
    ]);
    if (!relationship && !consent) {
      throw new ForbiddenException(
        "Current treatment relationship or patient consent is required for this laboratory order.",
      );
    }
  }

  private presentSpecimen(specimen: {
    id: string;
    specimenIdentifier: string;
    barcode: string;
    orderId: string;
    patientId: string;
    collectedByProviderId: string;
    specimenTypeCode: string;
    conditionCode: string;
    collectionLocation: string | null;
    collectedAt: Date;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: specimen.id,
      specimenIdentifier: specimen.specimenIdentifier,
      barcode: specimen.barcode,
      orderId: specimen.orderId,
      patientId: specimen.patientId,
      collectedByProviderId: specimen.collectedByProviderId,
      specimenTypeCode: specimen.specimenTypeCode,
      conditionCode: specimen.conditionCode,
      collectionLocation: specimen.collectionLocation,
      collectedAt: specimen.collectedAt,
      status: specimen.status,
      createdAt: specimen.createdAt,
      updatedAt: specimen.updatedAt,
    };
  }

  private presentCustodyEvent(event: {
    id: string;
    specimenId: string;
    sequence: number;
    eventType: string;
    actorProviderId: string;
    receiverRef: string | null;
    occurredAt: Date;
    location: string | null;
    conditionCode: string;
    createdAt: Date;
  }) {
    return {
      id: event.id,
      specimenId: event.specimenId,
      sequence: event.sequence,
      eventType: event.eventType,
      actorProviderId: event.actorProviderId,
      receiverRef: event.receiverRef,
      occurredAt: event.occurredAt,
      location: event.location,
      conditionCode: event.conditionCode,
      createdAt: event.createdAt,
    };
  }

  private specimenStatus(
    eventType: SpecimenCustodyEventType,
    conditionCode: SpecimenConditionCode,
  ) {
    if (conditionCode === "REJECTED") return "REJECTED";
    return eventType;
  }

  private custodyEventType(
    value: unknown,
    allowCollected: boolean,
  ): SpecimenCustodyEventType {
    if (typeof value !== "string") {
      throw new BadRequestException("eventType is required.");
    }
    const normalized = value.trim().toUpperCase();
    if (
      !(SpecimenCustodyEventTypes as readonly string[]).includes(normalized) ||
      (!allowCollected && normalized === "COLLECTED")
    ) {
      throw new BadRequestException(
        `eventType must be one of: ${SpecimenCustodyEventTypes.filter((item) => allowCollected || item !== "COLLECTED").join(", ")}.`,
      );
    }
    return normalized as SpecimenCustodyEventType;
  }

  private condition(value: unknown): SpecimenConditionCode {
    if (typeof value !== "string") {
      throw new BadRequestException("conditionCode is required.");
    }
    const normalized = value.trim().toUpperCase();
    if (!(SpecimenConditionCodes as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `conditionCode must be one of: ${SpecimenConditionCodes.join(", ")}.`,
      );
    }
    return normalized as SpecimenConditionCode;
  }

  private code(value: unknown, field: string) {
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} is required.`);
    }
    const normalized = value.trim().toUpperCase();
    if (!TOKEN.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private barcode(value: unknown, fallback: string) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string") throw new BadRequestException("barcode must be text.");
    const normalized = value.trim();
    if (!BARCODE.test(normalized)) throw new BadRequestException("barcode is invalid.");
    return normalized;
  }

  private collectionDate(value: unknown) {
    const date = this.date(value, "collectedAt");
    const now = Date.now();
    if (date.getTime() > now + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException("collectedAt cannot be in the future.");
    }
    if (date.getTime() < now - COLLECTION_BACKDATE_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(
        `collectedAt cannot be more than ${COLLECTION_BACKDATE_DAYS} days old.`,
      );
    }
    return date;
  }

  private eventDate(value: unknown) {
    const date = this.date(value, "occurredAt");
    if (date.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException("occurredAt cannot be in the future.");
    }
    return date;
  }

  private date(value: unknown, field: string) {
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be an ISO date-time.`);
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new BadRequestException(`${field} must be an ISO date-time.`);
    }
    return date;
  }

  private optionalText(value: unknown, max: number, field: string) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be text.`);
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > max) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} is required.`);
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > 180) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private newIdentifier() {
    const stamp = Date.now().toString(36).toUpperCase();
    const entropy = randomBytes(6).toString("hex").toUpperCase();
    return `SPC-${stamp}-${entropy}`;
  }
}
