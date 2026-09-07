import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, type ClinicalOrder, type LaboratoryResult } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { OrdersAttestationService } from "./orders-attestation.service";
import { OrdersEnvelopeService } from "./orders-envelope.service";

type OrderType = "PRESCRIPTION" | "LABORATORY";
type JsonObject = Record<string, unknown>;
type OrderRow = ClinicalOrder & { labResult: LaboratoryResult | null };

export interface OrdersSystemExportView {
  id: string;
  type: string;
  status: string;
  patientId: string;
  providerId: string;
  encounterRef: string;
  signedAt: Date;
  cancelledAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  data: JsonObject;
  labResult: null | {
    id: string;
    status: string;
    released: true;
    validatedAt: Date | null;
    releasedAt: Date | null;
    updatedAt: Date;
    data: JsonObject;
  };
}

@Injectable()
export class OrdersSystemExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: OrdersEnvelopeService,
    private readonly attestation: OrdersAttestationService,
  ) {}

  async orders(args: {
    type: OrderType;
    since: Date | null;
    transactionTime: Date;
    maxResources: number;
    actorId: string;
    clientId: string;
  }): Promise<OrdersSystemExportView[]> {
    const { type, since, transactionTime, maxResources, actorId, clientId } = args;
    const rows = await this.prisma.$transaction((tx) => tx.clinicalOrder.findMany({
      where: {
        type,
        updatedAt: { ...(since ? { gt: since } : {}), lte: transactionTime },
      },
      include: { labResult: true },
      orderBy: { id: "asc" },
      take: maxResources + 1,
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    this.assertLimit(type === "PRESCRIPTION" ? "MedicationRequest" : "ServiceRequest", rows.length, maxResources);
    const result = await Promise.all(rows.map((row) => this.presentOrder(row, false)));
    await this.auditSnapshot(actorId, clientId, type, result.length, since, transactionTime, false);
    return result;
  }

  async releasedLaboratoryOrders(args: {
    since: Date | null;
    transactionTime: Date;
    maxResources: number;
    actorId: string;
    clientId: string;
  }): Promise<OrdersSystemExportView[]> {
    const { since, transactionTime, maxResources, actorId, clientId } = args;
    const rows = await this.prisma.$transaction((tx) => tx.clinicalOrder.findMany({
      where: {
        type: "LABORATORY",
        updatedAt: { lte: transactionTime },
        labResult: { is: { status: "RELEASED", updatedAt: { lte: transactionTime } } },
        ...(since
          ? {
              OR: [
                { updatedAt: { gt: since } },
                { labResult: { is: { status: "RELEASED", updatedAt: { gt: since, lte: transactionTime } } } },
              ],
            }
          : {}),
      },
      include: { labResult: true },
      orderBy: { id: "asc" },
      take: maxResources + 1,
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    this.assertLimit("released laboratory Observation source", rows.length, maxResources);
    const result = await Promise.all(rows.map((row) => this.presentOrder(row, true)));
    await this.auditSnapshot(actorId, clientId, "LABORATORY", result.length, since, transactionTime, true);
    return result;
  }

  private async presentOrder(order: OrderRow, includeReleasedResult: boolean): Promise<OrdersSystemExportView> {
    const encrypted = this.orderEnvelope(order);
    const material = this.orderAttestationMaterial(order.type as OrderType, order.patientId, order.providerId, order.encounterRef, encrypted);
    if (!this.attestation.verify(material, { payloadDigest: order.payloadDigest, signature: order.signature, signedAt: order.signedAt })) {
      throw new ConflictException("Clinical order attestation verification failed.");
    }
    const data = await this.envelope.decrypt<JsonObject>(encrypted);
    let labResult: OrdersSystemExportView["labResult"] = null;
    if (includeReleasedResult) {
      if (!order.labResult || order.labResult.status !== "RELEASED") {
        throw new ConflictException("Released laboratory export source is inconsistent.");
      }
      await this.assertValidatedResultIntegrity(order.labResult, order.id);
      labResult = {
        id: order.labResult.id,
        status: order.labResult.status,
        released: true,
        validatedAt: order.labResult.validatedAt,
        releasedAt: order.labResult.releasedAt,
        updatedAt: order.labResult.updatedAt,
        data: await this.envelope.decrypt<JsonObject>(this.resultEnvelope(order.labResult)),
      };
    }
    return {
      id: order.id,
      type: order.type,
      status: order.status,
      patientId: order.patientId,
      providerId: order.providerId,
      encounterRef: order.encounterRef,
      signedAt: order.signedAt,
      cancelledAt: order.cancelledAt,
      completedAt: order.completedAt,
      updatedAt: order.updatedAt,
      data,
      labResult,
    };
  }

  private orderEnvelope(order: ClinicalOrder): EncryptedEnvelope {
    if (order.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported clinical order encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: order.keyId, wrappedKey: order.wrappedKey, iv: order.iv, ciphertext: order.ciphertext };
  }

  private resultEnvelope(result: LaboratoryResult): EncryptedEnvelope {
    if (result.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported laboratory result encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: result.keyId, wrappedKey: result.wrappedKey, iv: result.iv, ciphertext: result.ciphertext };
  }

  private orderAttestationMaterial(type: OrderType, patientId: string, providerId: string, encounterRef: string, envelope: EncryptedEnvelope) {
    return { type, patientId, providerId, encounterRef, envelope };
  }

  private resultAttestationMaterial(orderId: string, envelope: EncryptedEnvelope) {
    return { orderId, envelope };
  }

  private async assertValidatedResultIntegrity(result: LaboratoryResult, orderId: string): Promise<void> {
    if (!result.validationDigest || !result.validationSignature || !result.validatedAt) {
      throw new ConflictException("Validated laboratory result is missing its clinical attestation.");
    }
    const material = this.resultAttestationMaterial(orderId, this.resultEnvelope(result));
    if (!this.attestation.verify(material, { payloadDigest: result.validationDigest, signature: result.validationSignature, signedAt: result.validatedAt })) {
      throw new ConflictException("Laboratory result clinical attestation verification failed.");
    }
  }

  private assertLimit(label: string, count: number, maxResources: number): void {
    if (!Number.isInteger(maxResources) || maxResources < 1) throw new ConflictException("Clinical order bulk export resource limit is invalid.");
    if (count > maxResources) throw new ConflictException(`FHIR bulk export for ${label} exceeded the current safety limit of ${maxResources} resources.`);
  }

  private async auditSnapshot(
    actorId: string,
    clientId: string,
    type: string,
    count: number,
    since: Date | null,
    transactionTime: Date,
    releasedOnly: boolean,
  ): Promise<void> {
    await this.audit.write({
      actorId,
      action: "CLINICAL_ORDER_SYSTEM_EXPORT_SNAPSHOT",
      objectType: "SMART_CLIENT",
      objectId: clientId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: {
        type,
        count,
        since: since?.toISOString() ?? null,
        transactionTime: transactionTime.toISOString(),
        releasedOnly,
      },
    });
  }
}
