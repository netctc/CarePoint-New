import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal } from "../../security/api-security.module";

const PERIOD_DAYS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIOD_DAYS)[number];
type Period = { from: Date; to: Date };

type QuestionnairePatientGroup = {
  questionnaireId: string;
  patientId: string;
  _count: { _all: number };
  _max: { completedAt: Date | null };
};

@Injectable()
class AdminQuestionnaireComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async coverage(principal: AuthPrincipal, rawDays?: string) {
    this.requireAdmin(principal);
    const days = this.periodDays(rawDays);
    const generatedAt = new Date();
    const spanMs = days * 24 * 60 * 60 * 1000;
    const current: Period = {
      from: new Date(generatedAt.getTime() - spanMs),
      to: generatedAt,
    };
    const previous: Period = {
      from: new Date(generatedAt.getTime() - 2 * spanMs),
      to: current.from,
    };

    const [registeredPatients, definitions, currentGroups, previousGroups] =
      await Promise.all([
        this.prisma.patientProfile.count(),
        this.prisma.questionnaireDefinition.findMany({
          where: { active: true },
          select: {
            id: true,
            code: true,
            labels: true,
            versions: {
              where: { status: "ACTIVE" },
              orderBy: { version: "desc" },
              take: 1,
              select: { version: true },
            },
          },
          orderBy: { code: "asc" },
        }),
        this.responseGroups(current),
        this.responseGroups(previous),
      ]);

    const currentSnapshot = this.snapshot(
      definitions,
      currentGroups,
      registeredPatients,
    );
    const previousSnapshot = this.snapshot(
      definitions,
      previousGroups,
      registeredPatients,
    );

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_QUESTIONNAIRE_COMPLIANCE_READ",
      objectType: "QUESTIONNAIRE_COMPLIANCE",
      objectId: null,
      result: "SUCCESS",
      metadata: {
        domain: "ADMIN_ANALYTICS",
        days,
        activeQuestionnaires: definitions.length,
        registeredPatients,
        currentResponseCount: currentSnapshot.responseCount,
        currentRespondentCount: currentSnapshot.respondentCount,
        decision: "ALLOW",
      },
    });

    return {
      generatedAt: generatedAt.toISOString(),
      window: {
        days,
        current: this.presentPeriod(current),
        previous: this.presentPeriod(previous),
      },
      privacy: {
        aggregateOnly: true,
        patientIdentityExcluded: true,
        providerIdentityExcluded: true,
        clinicalAnswersExcluded: true,
        encryptedQuestionnairePayloadNotRead: true,
        freeTextExcluded: true,
      },
      denominator: {
        registeredPatients,
        description: "Registered patient profiles at generation time",
      },
      activeQuestionnaires: definitions.length,
      current: currentSnapshot,
      previous: previousSnapshot,
      trend: {
        coverageRateDelta: this.round(
          currentSnapshot.coverageRate - previousSnapshot.coverageRate,
        ),
        responseCountDelta:
          currentSnapshot.responseCount - previousSnapshot.responseCount,
      },
    };
  }

  private responseGroups(period: Period) {
    return this.prisma.questionnaireResponse.groupBy({
      by: ["questionnaireId", "patientId"],
      where: { completedAt: { gte: period.from, lt: period.to } },
      _count: { _all: true },
      _max: { completedAt: true },
    });
  }

  private snapshot(
    definitions: Array<{
      id: string;
      code: string;
      labels: unknown;
      versions: Array<{ version: number }>;
    }>,
    groups: QuestionnairePatientGroup[],
    registeredPatients: number,
  ) {
    const respondentIds = new Set<string>();
    let responseCount = 0;
    for (const group of groups) {
      respondentIds.add(group.patientId);
      responseCount += group._count._all;
    }

    const items = definitions.map((definition) => {
      const matching = groups.filter(
        (group) => group.questionnaireId === definition.id,
      );
      const responses = matching.reduce(
        (sum, group) => sum + group._count._all,
        0,
      );
      const latestCompletedAt = matching.reduce<Date | null>((latest, group) => {
        const candidate = group._max.completedAt;
        if (!candidate) return latest;
        if (!latest || candidate.getTime() > latest.getTime()) return candidate;
        return latest;
      }, null);
      const respondents = matching.length;
      return {
        code: definition.code,
        labels: definition.labels,
        activeVersion: definition.versions.at(0)?.version ?? null,
        responseCount: responses,
        respondentCount: respondents,
        coverageRate: this.rate(respondents, registeredPatients),
        gapCount: Math.max(registeredPatients - respondents, 0),
        latestCompletedAt: latestCompletedAt?.toISOString() ?? null,
      };
    });

    return {
      responseCount,
      respondentCount: respondentIds.size,
      coverageRate: this.rate(respondentIds.size, registeredPatients),
      gapCount: Math.max(registeredPatients - respondentIds.size, 0),
      questionnaires: items,
    };
  }

  private periodDays(raw?: string): PeriodDays {
    if (!raw?.trim()) return 30;
    const value = Number(raw);
    if (
      !Number.isInteger(value) ||
      !(PERIOD_DAYS as readonly number[]).includes(value)
    ) {
      throw new BadRequestException(
        `days must be one of: ${PERIOD_DAYS.join(", ")}.`,
      );
    }
    return value as PeriodDays;
  }

  private rate(numerator: number, denominator: number) {
    if (denominator <= 0) return 0;
    return this.round((numerator / denominator) * 100);
  }

  private round(value: number) {
    return Math.round(value * 10) / 10;
  }

  private presentPeriod(period: Period) {
    return { from: period.from.toISOString(), to: period.to.toISOString() };
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") {
      throw new ForbiddenException(
        "Administrator questionnaire compliance access is required.",
      );
    }
  }
}

@Controller("admin/operations/analytics/questionnaires")
class AdminQuestionnaireComplianceController {
  constructor(
    private readonly compliance: AdminQuestionnaireComplianceService,
  ) {}

  @Get("coverage")
  @Header("Cache-Control", "no-store")
  coverage(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("days") days?: string,
  ) {
    return this.compliance.coverage(principal, days);
  }
}

@Module({
  controllers: [AdminQuestionnaireComplianceController],
  providers: [AdminQuestionnaireComplianceService],
})
export class AdminQuestionnaireComplianceModule {}
