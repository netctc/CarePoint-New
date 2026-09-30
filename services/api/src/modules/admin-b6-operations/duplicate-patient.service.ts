import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

type DuplicateRow = {
  leftId: string;
  rightId: string;
  leftFirstName: string;
  leftLastName: string;
  rightFirstName: string;
  rightLastName: string;
  emailExact: boolean;
  phoneExact: boolean;
  nameExact: boolean;
};

@Injectable()
export class DuplicatePatientService {
  constructor(private readonly prisma: PrismaService) {}

  async candidates(limitInput?: string) {
    const limit = this.limit(limitInput);
    const rows = await this.prisma.$queryRaw<DuplicateRow[]>(Prisma.sql`
      SELECT
        p1.id AS "leftId",
        p2.id AS "rightId",
        p1."firstName" AS "leftFirstName",
        p1."lastName" AS "leftLastName",
        p2."firstName" AS "rightFirstName",
        p2."lastName" AS "rightLastName",
        (
          lower(btrim(u1.email)) <> ''
          AND lower(btrim(u1.email)) = lower(btrim(u2.email))
        ) AS "emailExact",
        (
          regexp_replace(COALESCE(p1.phone, ''), '[^0-9]+', '', 'g') <> ''
          AND regexp_replace(COALESCE(p1.phone, ''), '[^0-9]+', '', 'g')
              = regexp_replace(COALESCE(p2.phone, ''), '[^0-9]+', '', 'g')
        ) AS "phoneExact",
        (
          lower(regexp_replace(btrim(p1."firstName" || ' ' || p1."lastName"), '\\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(p2."firstName" || ' ' || p2."lastName"), '\\s+', ' ', 'g'))
        ) AS "nameExact"
      FROM "PatientProfile" p1
      JOIN "User" u1 ON u1.id = p1."userId"
      JOIN "PatientProfile" p2 ON p1.id < p2.id
      JOIN "User" u2 ON u2.id = p2."userId"
      WHERE u1.status <> 'ARCHIVED'
        AND u2.status <> 'ARCHIVED'
        AND (
          (
            lower(btrim(u1.email)) <> ''
            AND lower(btrim(u1.email)) = lower(btrim(u2.email))
          )
          OR (
            regexp_replace(COALESCE(p1.phone, ''), '[^0-9]+', '', 'g') <> ''
            AND regexp_replace(COALESCE(p1.phone, ''), '[^0-9]+', '', 'g')
                = regexp_replace(COALESCE(p2.phone, ''), '[^0-9]+', '', 'g')
          )
        )
      ORDER BY
        (
          CASE WHEN lower(btrim(u1.email)) = lower(btrim(u2.email)) THEN 70 ELSE 0 END
          + CASE WHEN regexp_replace(COALESCE(p1.phone, ''), '[^0-9]+', '', 'g')
                    = regexp_replace(COALESCE(p2.phone, ''), '[^0-9]+', '', 'g')
                    AND regexp_replace(COALESCE(p1.phone, ''), '[^0-9]+', '', 'g') <> ''
                 THEN 25 ELSE 0 END
          + CASE WHEN lower(regexp_replace(btrim(p1."firstName" || ' ' || p1."lastName"), '\\s+', ' ', 'g'))
                    = lower(regexp_replace(btrim(p2."firstName" || ' ' || p2."lastName"), '\\s+', ' ', 'g'))
                 THEN 5 ELSE 0 END
        ) DESC,
        p1.id ASC,
        p2.id ASC
      LIMIT ${limit}
    `);

    return {
      generatedAt: new Date().toISOString(),
      algorithm: "DETERMINISTIC_IDENTITY_MATCH_V1",
      autoMerge: false,
      minimizedEvidence: true,
      items: rows.map((row) => {
        const reasons = [
          ...(row.emailExact ? ["EMAIL_EXACT"] : []),
          ...(row.phoneExact ? ["PHONE_EXACT"] : []),
          ...(row.nameExact ? ["NAME_EXACT_SUPPORTING"] : []),
        ];
        const score = (row.emailExact ? 70 : 0) + (row.phoneExact ? 25 : 0) + (row.nameExact ? 5 : 0);
        return {
          id: this.digest([row.leftId, row.rightId, ...reasons].join("|")),
          left: {
            patientId: row.leftId,
            displayName: this.display(row.leftFirstName, row.leftLastName),
          },
          right: {
            patientId: row.rightId,
            displayName: this.display(row.rightFirstName, row.rightLastName),
          },
          score,
          reasons,
          reviewRequired: true,
          mergeEndpoint: "/api/v1/admin/patients/merge/preview",
        };
      }),
    };
  }

  private display(firstName: string, lastName: string): string {
    return (firstName + " " + lastName).trim().replace(/\s+/g, " ");
  }

  private digest(value: string): string {
    return createHash("sha256").update("carepoint-duplicate-candidate:" + value).digest("hex");
  }

  private limit(raw?: string): number {
    if (!raw) return 100;
    if (!/^\d{1,3}$/.test(raw.trim())) throw new BadRequestException("limit is invalid.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 250) {
      throw new BadRequestException("limit must be between 1 and 250.");
    }
    return value;
  }
}
