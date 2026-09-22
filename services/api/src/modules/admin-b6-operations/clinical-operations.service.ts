import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

type OrphanTaskRow = {
  id: string;
  carePlanId: string;
  ownerProviderId: string;
  dueAt: Date | null;
};

@Injectable()
export class ClinicalOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(limitInput?: string) {
    const limit = this.limit(limitInput);
    const now = new Date();
    const questionnaireCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      activePatients,
      activeQuestionnaires,
      recentRespondents,
      plansWithoutReview,
      openAlerts,
      pendingResults,
      orphanTasks,
      plansWithoutReviewCount,
      openAlertsCount,
      pendingResultsCount,
      orphanTaskCountRows,
    ] = await Promise.all([
      this.prisma.patientProfile.count({ where: { user: { status: "ACTIVE" } } }),
      this.prisma.questionnaireDefinition.count({ where: { active: true } }),
      this.prisma.questionnaireResponse.groupBy({
        by: ["patientId"],
        where: {
          questionnaire: { active: true },
          completedAt: { gte: questionnaireCutoff },
        },
        _count: { _all: true },
      }),
      this.prisma.carePlan.findMany({
        where: { status: "ACTIVE", reviewAt: { lt: now } },
        select: { id: true, patientId: true, ownerProviderId: true, reviewAt: true },
        orderBy: [{ reviewAt: "asc" }, { id: "asc" }],
        take: limit,
      }),
      this.prisma.clinicalAlert.findMany({
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        select: { id: true, patientId: true, ownerProviderId: true, severity: true, status: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
      }),
      this.prisma.clinicalOrder.findMany({
        where: {
          type: "LABORATORY",
          status: "SIGNED",
          OR: [
            { labResult: null },
            { labResult: { status: { not: "RELEASED" } } },
          ],
        },
        select: {
          id: true,
          patientId: true,
          providerId: true,
          signedAt: true,
          labResult: { select: { id: true, status: true, updatedAt: true } },
        },
        orderBy: [{ signedAt: "asc" }, { id: "asc" }],
        take: limit,
      }),
      this.prisma.$queryRaw<OrphanTaskRow[]>(Prisma.sql\`
        SELECT t.id, t."carePlanId", t."ownerProviderId", t."dueAt"
        FROM "CareTask" t
        LEFT JOIN "CarePlan" cp ON cp.id = t."carePlanId"
        LEFT JOIN "Provider" p ON p.id = t."ownerProviderId"
        WHERE t.status = 'ACTIVE'
          AND (cp.id IS NULL OR cp.status <> 'ACTIVE' OR p.id IS NULL OR p.status <> 'ACTIVE')
        ORDER BY t."dueAt" ASC NULLS LAST, t.id ASC
        LIMIT \${limit}
      \`),
      this.prisma.carePlan.count({ where: { status: "ACTIVE", reviewAt: { lt: now } } }),
      this.prisma.clinicalAlert.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
      this.prisma.clinicalOrder.count({
        where: {
          type: "LABORATORY",
          status: "SIGNED",
          OR: [{ labResult: null }, { labResult: { status: { not: "RELEASED" } } }],
        },
      }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql\`
        SELECT count(*)::bigint AS count
        FROM "CareTask" t
        LEFT JOIN "CarePlan" cp ON cp.id = t."carePlanId"
        LEFT JOIN "Provider" p ON p.id = t."ownerProviderId"
        WHERE t.status = 'ACTIVE'
          AND (cp.id IS NULL OR cp.status <> 'ACTIVE' OR p.id IS NULL OR p.status <> 'ACTIVE')
      \`),
    ]);

    const recentPatientIds = new Set(recentRespondents.map((row) => row.patientId));
    const questionnairesOverdue = activeQuestionnaires === 0
      ? 0
      : Math.max(0, activePatients - recentPatientIds.size);

    return {
      generatedAt: now.toISOString(),
      methodology: {
        questionnaireOverdue: "ACTIVE_PATIENT_WITHOUT_ACTIVE_QUESTIONNAIRE_RESPONSE_IN_LAST_30_DAYS",
        carePlanReview: "ACTIVE_PLAN_REVIEW_AT_BEFORE_SNAPSHOT",
        rpmAlert: "OPEN_OR_ACKNOWLEDGED",
        pendingResult: "SIGNED_LAB_ORDER_WITHOUT_RELEASED_RESULT",
        orphanTask: "ACTIVE_TASK_WITH_INACTIVE_OR_MISSING_PLAN_OR_OWNER_PROVIDER",
      },
      kpis: {
        questionnairesOverdue,
        plansWithoutReview: plansWithoutReviewCount,
        rpmAlertsOpen: openAlertsCount,
        pendingResults: pendingResultsCount,
        orphanTasks: Number(orphanTaskCountRows[0]?.count ?? 0n),
      },
      drillDown: {
        plansWithoutReview,
        rpmAlerts: openAlerts,
        pendingResults,
        orphanTasks,
      },
      limit,
    };
  }

  private limit(raw?: string): number {
    if (!raw) return 50;
    if (!/^\d{1,3}$/.test(raw.trim())) throw new BadRequestException("limit is invalid.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
      throw new BadRequestException("limit must be between 1 and 200.");
    }
    return value;
  }
}
