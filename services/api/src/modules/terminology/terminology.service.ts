import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

const ACTIVE = "ACTIVE";
const INACTIVE = "INACTIVE";
const STATUSES = new Set([ACTIVE, INACTIVE]);

export interface CreateCodingSystemInput {
  uri: string;
  name: string;
}

export interface CreateTerminologyConceptInput {
  system: string;
  code: string;
  display: string;
  status?: string;
  effectiveFrom?: string;
}

export interface PublishTerminologyConceptVersionInput {
  expectedVersion: number;
  display: string;
  status?: string;
  effectiveFrom?: string;
}

export interface CreateExternalMappingInput {
  sourceSystem: string;
  sourceCode: string;
  targetSystem: string;
  targetCode: string;
  status?: string;
  effectiveFrom?: string;
}

export interface TerminologySearchQuery {
  q?: string;
  system?: string;
  limit?: string | number;
}

type SearchRow = {
  id: string;
  system: string;
  code: string;
  status: string;
  currentVersion: number;
  display: string;
  effectiveFrom: Date;
  createdAt: Date;
};

@Injectable()
export class TerminologyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async search(query: TerminologySearchQuery) {
    const q = this.optionalText(query?.q, 120)?.toLowerCase() ?? null;
    const system = this.optionalSystem(query?.system) ?? null;
    const limit = this.limit(query?.limit);
    const like = q ? `%${q}%` : null;

    const rows = await this.prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.system,
        c.code,
        c.status,
        c."currentVersion",
        v.display,
        v."effectiveFrom",
        v."createdAt"
      FROM "TerminologyConcept" c
      JOIN "TerminologyConceptVersion" v
        ON v."conceptId" = c.id
       AND v.version = c."currentVersion"
      JOIN "CodingSystem" s ON s.id = c."codingSystemId"
      WHERE c.status = 'ACTIVE'
        AND s.active = true
        AND (${system}::text IS NULL OR c.system = ${system})
        AND (
          ${like}::text IS NULL
          OR lower(c.code) LIKE ${like}
          OR lower(v.display) LIKE ${like}
        )
      ORDER BY v.display ASC, c.code ASC
      LIMIT ${limit}
    `);

    return {
      items: rows.map((row) => ({
        id: row.id,
        system: row.system,
        code: row.code,
        display: row.display,
        status: row.status,
        contentVersion: row.currentVersion,
        effectiveFrom: row.effectiveFrom,
        versionRecordedAt: row.createdAt,
      })),
    };
  }

  async map(sourceSystemInput: string, sourceCodeInput: string) {
    const sourceSystem = this.system(sourceSystemInput, "sourceSystem");
    const sourceCode = this.code(sourceCodeInput, "sourceCode");
    const now = new Date();
    const mapping = await this.prisma.externalCatalogMapping.findFirst({
      where: {
        sourceSystem,
        sourceCode,
        status: ACTIVE,
        effectiveFrom: { lte: now },
        OR: [{ retiredAt: null }, { retiredAt: { gt: now } }],
      },
      orderBy: { version: "desc" },
    });
    if (!mapping) throw new NotFoundException("Terminology mapping not found.");

    const concept = await this.prisma.terminologyConcept.findUnique({ where: { id: mapping.targetConceptId } });
    if (!concept) throw new NotFoundException("Mapped terminology concept not found.");
    const version = await this.prisma.terminologyConceptVersion.findUnique({
      where: { conceptId_version: { conceptId: concept.id, version: concept.currentVersion } },
    });
    if (!version) throw new NotFoundException("Mapped terminology concept version not found.");

    return {
      source: { system: mapping.sourceSystem, code: mapping.sourceCode },
      target: {
        id: concept.id,
        system: concept.system,
        code: concept.code,
        display: version.display,
        contentVersion: concept.currentVersion,
        status: concept.status,
      },
      mappingVersion: mapping.version,
      effectiveFrom: mapping.effectiveFrom,
    };
  }

  async listSystems() {
    const rows = await this.prisma.codingSystem.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
    return { items: rows };
  }

  async createSystem(principal: AuthPrincipal, input: CreateCodingSystemInput) {
    const uri = this.system(input?.uri, "uri");
    const name = this.text(input?.name, "name", 180);
    try {
      const row = await this.prisma.codingSystem.create({ data: { uri, name } });
      await this.audit.write({
        actorId: principal.accountId,
        action: "TERMINOLOGY_CODING_SYSTEM_CREATED",
        objectType: "CODING_SYSTEM",
        objectId: row.id,
        result: "SUCCESS",
        metadata: { uri, active: true },
      });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Coding system URI already exists.");
      }
      throw error;
    }
  }

  async createConcept(principal: AuthPrincipal, input: CreateTerminologyConceptInput) {
    const system = this.system(input?.system, "system");
    const code = this.code(input?.code, "code");
    const display = this.text(input?.display, "display", 300);
    const status = this.status(input?.status);
    const effectiveFrom = this.date(input?.effectiveFrom, "effectiveFrom", new Date());
    const codingSystem = await this.prisma.codingSystem.findUnique({ where: { uri: system } });
    if (!codingSystem) throw new NotFoundException("Coding system not found.");

    try {
      const concept = await this.prisma.$transaction(async (tx) => {
        const anchor = await tx.terminologyConcept.create({
          data: { codingSystemId: codingSystem.id, system, code, status, currentVersion: 1 },
        });
        await tx.terminologyConceptVersion.create({
          data: {
            conceptId: anchor.id,
            version: 1,
            system,
            code,
            display,
            status,
            effectiveFrom,
            createdByActorId: principal.accountId,
          },
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "TERMINOLOGY_CONCEPT_CREATED",
          objectType: "TERMINOLOGY_CONCEPT",
          objectId: anchor.id,
          result: "SUCCESS",
          metadata: { system, code, version: 1, status },
        });
        return anchor;
      });
      return this.presentConcept(concept.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Terminology concept already exists for system and code.");
      }
      throw error;
    }
  }

  async publishVersion(
    principal: AuthPrincipal,
    conceptIdInput: string,
    input: PublishTerminologyConceptVersionInput,
  ) {
    const conceptId = this.identifier(conceptIdInput, "conceptId");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    const display = this.text(input?.display, "display", 300);
    const status = this.status(input?.status);
    const effectiveFrom = this.date(input?.effectiveFrom, "effectiveFrom", new Date());

    const next = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "TerminologyConcept" WHERE id = ${conceptId} FOR UPDATE`);
      const current = await tx.terminologyConcept.findUnique({ where: { id: conceptId } });
      if (!current) throw new NotFoundException("Terminology concept not found.");
      if (current.currentVersion !== expectedVersion) {
        throw new ConflictException({
          message: "Terminology concept version conflict.",
          currentVersion: current.currentVersion,
        });
      }
      const version = current.currentVersion + 1;
      await tx.terminologyConceptVersion.create({
        data: {
          conceptId,
          version,
          system: current.system,
          code: current.code,
          display,
          status,
          effectiveFrom,
          createdByActorId: principal.accountId,
        },
      });
      const updated = await tx.terminologyConcept.update({
        where: { id: conceptId },
        data: { currentVersion: version, status },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "TERMINOLOGY_CONCEPT_VERSION_PUBLISHED",
        objectType: "TERMINOLOGY_CONCEPT",
        objectId: conceptId,
        result: "SUCCESS",
        metadata: { system: current.system, code: current.code, version, status },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.presentConcept(next.id);
  }

  async createMapping(principal: AuthPrincipal, input: CreateExternalMappingInput) {
    const sourceSystem = this.system(input?.sourceSystem, "sourceSystem");
    const sourceCode = this.code(input?.sourceCode, "sourceCode");
    const targetSystem = this.system(input?.targetSystem, "targetSystem");
    const targetCode = this.code(input?.targetCode, "targetCode");
    const status = this.status(input?.status);
    const effectiveFrom = this.date(input?.effectiveFrom, "effectiveFrom", new Date());

    const target = await this.prisma.terminologyConcept.findUnique({
      where: { system_code: { system: targetSystem, code: targetCode } },
    });
    if (!target) throw new NotFoundException("Target terminology concept not found.");

    const row = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${sourceSystem}|${sourceCode}`}))`;
      const latest = await tx.externalCatalogMapping.findFirst({
        where: { sourceSystem, sourceCode },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      const created = await tx.externalCatalogMapping.create({
        data: {
          sourceSystem,
          sourceCode,
          targetConceptId: target.id,
          targetSystem,
          targetCode,
          version,
          status,
          effectiveFrom,
          createdByActorId: principal.accountId,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "TERMINOLOGY_MAPPING_PUBLISHED",
        objectType: "EXTERNAL_CATALOG_MAPPING",
        objectId: created.id,
        result: "SUCCESS",
        metadata: { sourceSystem, sourceCode, targetSystem, targetCode, version, status },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return row;
  }

  private async presentConcept(conceptId: string) {
    const concept = await this.prisma.terminologyConcept.findUnique({ where: { id: conceptId } });
    if (!concept) throw new NotFoundException("Terminology concept not found.");
    const version = await this.prisma.terminologyConceptVersion.findUnique({
      where: { conceptId_version: { conceptId, version: concept.currentVersion } },
    });
    if (!version) throw new NotFoundException("Terminology concept version not found.");
    return {
      id: concept.id,
      system: concept.system,
      code: concept.code,
      display: version.display,
      status: concept.status,
      contentVersion: concept.currentVersion,
      effectiveFrom: version.effectiveFrom,
      createdAt: concept.createdAt,
      updatedAt: concept.updatedAt,
    };
  }

  private status(value: unknown) {
    if (value === undefined || value === null || value === "") return ACTIVE;
    const normalized = String(value).trim().toUpperCase();
    if (!STATUSES.has(normalized)) throw new BadRequestException("status must be ACTIVE or INACTIVE.");
    return normalized;
  }

  private limit(value: unknown) {
    if (value === undefined || value === null || value === "") return 50;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new BadRequestException("limit must be an integer from 1 to 100.");
    }
    return parsed;
  }

  private date(value: unknown, field: string, fallback: Date) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO datetime.`);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO datetime.`);
    return parsed;
  }

  private positiveInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private optionalText(value: unknown, max: number) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("q must be text.");
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new BadRequestException(`q must be 1-${max} characters.`);
    return normalized;
  }

  private optionalSystem(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    return this.system(value, "system");
  }

  private system(value: unknown, field: string) {
    const normalized = this.text(value, field, 300);
    if (/\s/.test(normalized)) throw new BadRequestException(`${field} must not contain whitespace.`);
    return normalized;
  }

  private code(value: unknown, field: string) {
    return this.text(value, field, 160);
  }

  private identifier(value: unknown, field: string) {
    const normalized = this.text(value, field, 180);
    if (!/^[A-Za-z0-9_.:-]+$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private text(value: unknown, field: string, max: number) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new BadRequestException(`${field} must be 1-${max} characters.`);
    return normalized;
  }
}
