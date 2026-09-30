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

type StoredEntry = {
  schemaVersion: 1;
  payload: ClinicalProfilePayload;
};

export interface CreateProblemInput {
  status?: string;
  data: unknown;
}

export interface UpdateProblemInput {
  expectedVersion: number;
  status?: string;
  data: unknown;
}

@Injectable()
export class ProblemListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly profile: ClinicalProfileService,
  ) {}

  async listForDoctor(principal: AuthPrincipal, patientId: string) {
    const current = await this.profile.listForDoctor(principal, patientId, "CONDITION");
    const ids = current.items.map((item) => item.id);
    const revisions = ids.length === 0
      ? []
      : await this.prisma.clinicalProfileEntryRevision.findMany({
          where: { entryId: { in: ids } },
          orderBy: [{ entryId: "asc" }, { version: "desc" }],
        });

    const historyByEntry = new Map<string, Array<Record<string, unknown>>>();
    for (const revision of revisions) {
      const stored = await this.decryptRevision(revision);
      const data = this.condition(stored.payload);
      const history = historyByEntry.get(revision.entryId) ?? [];
      history.push({
        revisionId: revision.id,
        version: revision.version,
        changedFields: this.stringArray(revision.changedFields),
        verificationStatus: revision.verificationStatus,
        state: data.clinicalStatus ?? "UNKNOWN",
        effectiveDate: data.onsetDate ?? null,
        provenance: {
          sourceType: revision.sourceType,
          sourceActorId: revision.sourceActorId,
          recordedAt: revision.createdAt,
        },
        data,
      });
      historyByEntry.set(revision.entryId, history);
    }

    const items = current.items
      .map((item) => {
        const data = this.condition(item.data as ClinicalProfilePayload);
        return {
          ...item,
          data,
          state: item.status,
          effectiveDate: data.onsetDate ?? null,
          lastUpdatedAt: item.provenance.updatedAt,
          history: historyByEntry.get(item.id) ?? [],
        };
      })
      .sort((left, right) => {
        const rank = (status: string) => status === "ACTIVE" ? 0 : status === "RESOLVED" ? 1 : 2;
        const status = rank(left.status) - rank(right.status);
        if (status !== 0) return status;
        return new Date(right.lastUpdatedAt).getTime() - new Date(left.lastUpdatedAt).getTime();
      });

    const active = items.filter((item) => item.status === "ACTIVE");
    const resolved = items.filter((item) => item.status === "RESOLVED");
    const inactive = items.filter((item) => item.status === "INACTIVE");

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROBLEM_LIST_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "PROBLEM_LIST",
        patientId,
        activeCount: active.length,
        resolvedCount: resolved.length,
        inactiveCount: inactive.length,
        historyCount: revisions.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      accessBasis: current.accessBasis,
      groups: { active, resolved, inactive },
      items,
    };
  }

  async createForDoctor(principal: AuthPrincipal, patientId: string, input: CreateProblemInput) {
    await this.profile.listForDoctor(principal, patientId, "CONDITION");
    const data = this.withState(input?.data, input?.status);
    await this.validateLinks(patientId, data);
    const createInput: CreateClinicalProfileEntryInput = {
      kind: "CONDITION",
      data,
      ...(input?.status !== undefined ? { status: input.status } : {}),
    };
    const created = await this.profile.createForDoctor(principal, patientId, createInput);
    return this.present(created);
  }

  async updateForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    entryId: string,
    input: UpdateProblemInput,
  ) {
    const current = await this.profile.listForDoctor(principal, patientId, "CONDITION");
    if (!current.items.some((item) => item.id === entryId)) throw new NotFoundException("Problem entry not found.");
    const data = this.withState(input?.data, input?.status);
    await this.validateLinks(patientId, data);
    const updateInput: UpdateClinicalProfileEntryInput = {
      expectedVersion: input.expectedVersion,
      data,
      ...(input?.status !== undefined ? { status: input.status } : {}),
    };
    const updated = await this.profile.updateForDoctor(principal, patientId, entryId, updateInput);
    return this.present(updated);
  }

  private async validateLinks(patientId: string, data: Record<string, unknown>) {
    const encounterId = this.optionalIdentifier(data.encounterId, "encounterId");
    const documentIds = this.identifierArray(data.documentIds, "documentIds");
    const carePlanIds = this.identifierArray(data.carePlanIds, "carePlanIds");

    if (encounterId) {
      const encounter = await this.prisma.clinicalRecord.findFirst({
        where: { id: encounterId, patientId },
        select: { id: true },
      });
      if (!encounter) throw new BadRequestException("encounterId must reference this patient's clinical record.");
    }
    if (documentIds) {
      const documents = await this.prisma.clinicalDocument.findMany({
        where: { id: { in: documentIds }, patientId },
        select: { id: true },
      });
      if (documents.length !== documentIds.length) {
        throw new BadRequestException("Every documentIds item must reference this patient's clinical document.");
      }
    }
    if (carePlanIds) {
      const carePlans = await this.prisma.carePlan.findMany({
        where: { id: { in: carePlanIds }, patientId },
        select: { id: true },
      });
      if (carePlans.length !== carePlanIds.length) {
        throw new BadRequestException("Every carePlanIds item must reference this patient's care plan.");
      }
    }
  }

  private withState(value: unknown, status: string | undefined): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("problem data must be an object.");
    }
    const data = { ...(value as Record<string, unknown>) };
    if (status !== undefined && data.clinicalStatus === undefined) {
      const normalized = status.trim().toUpperCase();
      if (normalized === "ACTIVE" || normalized === "RESOLVED" || normalized === "INACTIVE") {
        data.clinicalStatus = normalized;
      }
    }
    return data;
  }

  private present<T extends { data: unknown; status: string; provenance: { updatedAt: Date } }>(item: T) {
    const data = this.condition(item.data as ClinicalProfilePayload);
    return {
      ...item,
      data,
      state: item.status,
      effectiveDate: data.onsetDate ?? null,
      lastUpdatedAt: item.provenance.updatedAt,
    };
  }

  private condition(payload: ClinicalProfilePayload) {
    if (!payload || payload.kind !== "CONDITION") throw new BadRequestException("Stored condition payload is invalid.");
    return payload;
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

  private optionalIdentifier(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} is invalid.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private identifierArray(value: unknown, field: string): string[] | null {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || value.length > 20) throw new BadRequestException(`${field} is invalid.`);
    const items = value.map((item, index) => this.optionalIdentifier(item, `${field}[${index}]`));
    if (items.some((item) => item === null)) throw new BadRequestException(`${field} is invalid.`);
    return [...new Set(items as string[])];
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }
}
