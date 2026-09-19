import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import {
  ClinicalProfileService,
  type CreateClinicalProfileEntryInput,
  type UpdateClinicalProfileEntryInput,
} from "./clinical-profile.service";
import type { ClinicalProfilePayload } from "./clinical-profile.engine";

const REASONS = new Set(["CONFIRMED", "CORRECTED", "PATIENT_CLARIFIED", "DUPLICATE", "OTHER"] as const);
type AllergyReason = "CONFIRMED" | "CORRECTED" | "PATIENT_CLARIFIED" | "DUPLICATE" | "OTHER";

type StoredEntry = {
  schemaVersion: 1;
  payload: ClinicalProfilePayload;
};

export interface CreateAllergyInput {
  status?: string;
  data: unknown;
  reasonCode?: AllergyReason | string | null;
}

export interface UpdateAllergyInput {
  expectedVersion: number;
  status?: string;
  data: unknown;
  reasonCode?: AllergyReason | string | null;
}

export interface VerifyAllergyInput {
  expectedVersion: number;
  decision: "VERIFIED" | "REJECTED";
  reasonCode?: AllergyReason | string | null;
}

@Injectable()
export class AllergyReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly profile: ClinicalProfileService,
  ) {}

  async listForDoctor(principal: AuthPrincipal, patientId: string) {
    const current = await this.profile.listForDoctor(principal, patientId, "ALLERGY");
    const ids = current.items.map((item) => item.id);
    const [revisions, annotations] = await Promise.all([
      ids.length === 0
        ? Promise.resolve([])
        : this.prisma.clinicalProfileEntryRevision.findMany({
            where: { entryId: { in: ids } },
            orderBy: [{ entryId: "asc" }, { version: "desc" }],
          }),
      ids.length === 0
        ? Promise.resolve([])
        : this.prisma.clinicalProfileRevisionAnnotation.findMany({
            where: { entryId: { in: ids }, domain: "ALLERGY_RECONCILIATION" },
            orderBy: { createdAt: "desc" },
          }),
    ]);

    const annotationByVersion = new Map(
      annotations.map((annotation) => [`${annotation.entryId}:${annotation.entryVersion}`, annotation]),
    );
    const historyByEntry = new Map<string, Array<Record<string, unknown>>>();
    for (const revision of revisions) {
      const stored = await this.decryptRevision(revision);
      const annotation = annotationByVersion.get(`${revision.entryId}:${revision.version}`) ?? null;
      const history = historyByEntry.get(revision.entryId) ?? [];
      history.push({
        revisionId: revision.id,
        version: revision.version,
        changedFields: this.stringArray(revision.changedFields),
        verificationStatus: revision.verificationStatus,
        provenance: {
          sourceType: revision.sourceType,
          sourceActorId: revision.sourceActorId,
          recordedAt: revision.createdAt,
        },
        reasonCode: annotation?.reasonCode ?? null,
        data: this.presentAllergyData(stored.payload),
      });
      historyByEntry.set(revision.entryId, history);
    }

    const items = current.items
      .map((item) => ({
        ...item,
        data: this.presentAllergyData(item.data as ClinicalProfilePayload),
        history: historyByEntry.get(item.id) ?? [],
      }))
      .sort((left, right) => {
        const statusRank = (value: string) => value === "ACTIVE" ? 0 : value === "RESOLVED" ? 1 : 2;
        const classificationRank = (value: unknown) => value === "ALLERGY" ? 0 : 1;
        const status = statusRank(left.status) - statusRank(right.status);
        if (status !== 0) return status;
        const classification = classificationRank(left.data.classification) - classificationRank(right.data.classification);
        if (classification !== 0) return classification;
        return new Date(right.provenance.updatedAt).getTime() - new Date(left.provenance.updatedAt).getTime();
      });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "ALLERGY_RECONCILIATION_LIST_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "ALLERGY_RECONCILIATION",
        patientId,
        itemCount: items.length,
        historyCount: revisions.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      accessBasis: current.accessBasis,
      items,
    };
  }

  async createForDoctor(principal: AuthPrincipal, patientId: string, input: CreateAllergyInput) {
    const reasonCode = this.reason(input?.reasonCode);
    const created = await this.profile.createForDoctor(principal, patientId, {
      kind: "ALLERGY",
      status: input?.status,
      data: input?.data,
    } satisfies CreateClinicalProfileEntryInput);
    await this.annotate(created.id, created.version, reasonCode, principal.accountId);
    return { ...created, data: this.presentAllergyData(created.data as ClinicalProfilePayload), reasonCode };
  }

  async updateForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    entryId: string,
    input: UpdateAllergyInput,
  ) {
    await this.requireAllergy(patientId, entryId);
    const reasonCode = this.reason(input?.reasonCode);
    const updated = await this.profile.updateForDoctor(principal, patientId, entryId, {
      expectedVersion: input?.expectedVersion,
      status: input?.status,
      data: input?.data,
    } satisfies UpdateClinicalProfileEntryInput);
    await this.annotate(updated.id, updated.version, reasonCode, principal.accountId);
    return { ...updated, data: this.presentAllergyData(updated.data as ClinicalProfilePayload), reasonCode };
  }

  async verifyForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    entryId: string,
    input: VerifyAllergyInput,
  ) {
    await this.requireAllergy(patientId, entryId);
    const reasonCode = this.reason(input?.reasonCode ?? "CONFIRMED");
    const updated = await this.profile.verifyForDoctor(principal, patientId, entryId, {
      expectedVersion: input?.expectedVersion,
      decision: input?.decision,
    });
    await this.annotate(updated.id, updated.version, reasonCode, principal.accountId);
    return { ...updated, data: this.presentAllergyData(updated.data as ClinicalProfilePayload), reasonCode };
  }

  private async requireAllergy(patientId: string, entryId: string) {
    const row = await this.prisma.clinicalProfileEntry.findUnique({
      where: { id: entryId },
      select: { id: true, patientId: true, kind: true },
    });
    if (!row || row.patientId !== patientId || row.kind !== "ALLERGY") {
      throw new NotFoundException("Allergy entry not found.");
    }
    return row;
  }

  private async annotate(entryId: string, entryVersion: number, reasonCode: AllergyReason | null, actorId: string) {
    if (!reasonCode) return;
    await this.prisma.clinicalProfileRevisionAnnotation.create({
      data: {
        entryId,
        entryVersion,
        domain: "ALLERGY_RECONCILIATION",
        reasonCode,
        createdByActorId: actorId,
      },
    });
  }

  private async decryptRevision(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }): Promise<StoredEntry> {
    return this.envelope.decryptRecord<StoredEntry>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private presentAllergyData(payload: ClinicalProfilePayload) {
    if (!payload || payload.kind !== "ALLERGY") throw new BadRequestException("Stored allergy payload is invalid.");
    return {
      ...payload,
      classification: payload.classification ?? "ALLERGY",
    };
  }

  private reason(value: unknown): AllergyReason | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("reasonCode is invalid.");
    const normalized = value.trim().toUpperCase() as AllergyReason;
    if (!REASONS.has(normalized)) throw new BadRequestException("reasonCode is invalid.");
    return normalized;
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }
}
