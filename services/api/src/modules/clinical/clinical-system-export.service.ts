import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, type ClinicalRecord } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ClinicalEnvelopeService } from "./clinical-envelope.service";

type StoredClinicalPayload = Record<string, unknown> & {
  schemaVersion: 1;
  revision: number;
  authoredAt: string;
};

export interface ClinicalSystemEncounterView {
  patientId: string;
  appointment: {
    id: string;
    modality: string;
    status: string;
    startsAt: Date;
    endsAt: Date;
    updatedAt: Date;
    provider: { id: string; class: string; displayName: string };
    service: { id: string; name: string; labels: unknown };
  };
  latestRecord: {
    id: string;
    createdAt: Date;
    revision: number;
    data: StoredClinicalPayload;
  };
  finalized: boolean;
}

@Injectable()
export class ClinicalSystemExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async documentedEncounters(args: {
    transactionTime: Date;
    maxResources: number;
    actorId: string;
    clientId: string;
  }): Promise<ClinicalSystemEncounterView[]> {
    const { transactionTime, maxResources, actorId, clientId } = args;
    if (!Number.isInteger(maxResources) || maxResources < 1) throw new ConflictException("Clinical bulk export resource limit is invalid.");

    const snapshot = await this.prisma.$transaction(async (tx) => {
      const records = await tx.clinicalRecord.findMany({
        where: { encounterRef: { not: null }, createdAt: { lte: transactionTime } },
        orderBy: [{ encounterRef: "asc" }, { createdAt: "desc" }],
        distinct: ["encounterRef"],
        take: maxResources + 1,
      });
      if (records.length > maxResources) {
        throw new ConflictException(`FHIR bulk export for documented encounters exceeded the current safety limit of ${maxResources} resources.`);
      }
      const encounterIds = records
        .map((record) => record.encounterRef)
        .filter((value): value is string => Boolean(value));
      const appointments = encounterIds.length === 0
        ? []
        : await tx.appointment.findMany({
            where: { id: { in: encounterIds } },
            include: {
              provider: { select: { id: true, class: true, displayName: true } },
              service: { select: { id: true, name: true, labels: true } },
            },
            orderBy: { id: "asc" },
          });
      return { records, appointments };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const recordsByEncounter = new Map<string, ClinicalRecord>();
    for (const record of snapshot.records) {
      if (record.encounterRef) recordsByEncounter.set(record.encounterRef, record);
    }
    if (snapshot.appointments.length !== recordsByEncounter.size) {
      throw new ConflictException("Clinical bulk export detected an orphaned documented encounter.");
    }

    const result: ClinicalSystemEncounterView[] = [];
    for (const appointment of snapshot.appointments) {
      const record = recordsByEncounter.get(appointment.id);
      if (!record || record.patientId !== appointment.patientId || record.providerId !== appointment.providerId) {
        throw new ConflictException("Clinical bulk export encounter ownership validation failed.");
      }
      const data = await this.envelope.decryptRecord<StoredClinicalPayload>(this.asEnvelope(record));
      result.push({
        patientId: appointment.patientId,
        appointment: {
          id: appointment.id,
          modality: appointment.modality,
          status: appointment.status,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          updatedAt: appointment.updatedAt,
          provider: appointment.provider,
          service: appointment.service,
        },
        latestRecord: { id: record.id, createdAt: record.createdAt, revision: data.revision, data },
        finalized: appointment.status === "COMPLETED",
      });
    }

    await this.audit.write({
      actorId,
      action: "CLINICAL_SYSTEM_EXPORT_SNAPSHOT",
      objectType: "SMART_CLIENT",
      objectId: clientId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { transactionTime: transactionTime.toISOString(), documentedEncounterCount: result.length },
    });
    return result;
  }

  private asEnvelope(record: ClinicalRecord): EncryptedEnvelope {
    if (record.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported clinical record encryption algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: record.keyId,
      wrappedKey: record.wrappedKey,
      iv: record.iv,
      ciphertext: record.ciphertext,
    };
  }
}
