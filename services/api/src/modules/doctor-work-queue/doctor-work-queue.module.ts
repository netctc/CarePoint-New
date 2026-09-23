import { Controller, ForbiddenException, Get, Header, Injectable, Module } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  evaluateQuestionnaireActivation,
  normalizeActivationRules,
} from "../questionnaire/questionnaire.engine";

const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;
const QUESTIONNAIRE_SCOPE = "QUESTIONNAIRE_READ";
const QUESTIONNAIRE_CONSENT_VERSION = "questionnaire-read-v1";
const CRITERIA_VERSION = "doctor-follow-up-v1" as const;

type CriterionCounts = {
  pendingQuestionnaireCount: number;
  openAlertCount: number;
  newResultCount: number;
  overdueFollowUpCount: number;
};

type PatientQueueState = CriterionCounts & {
  patientId: string;
  patientDisplayName: string;
  lastCompletedAt: Date | null;
  latestSignalAt: Date | null;
};

@Injectable()
export class DoctorWorkQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async queue(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR") {
      throw new ForbiddenException("Doctor work queue requires DOCTOR role.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, class: true, status: true },
    });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active Doctor provider profile is required.");
    }

    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);
    const rosterAppointments = await this.prisma.appointment.findMany({
      where: {
        providerId: provider.id,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        patientId: true,
        status: true,
        startsAt: true,
        patient: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startsAt: "desc" },
      take: 1000,
    });

    const patientIds = [...new Set(rosterAppointments.map((item) => item.patientId))];
    if (patientIds.length === 0) {
      const empty = this.empty(provider.id, now);
      await this.writeAudit(principal, provider.id, empty.counts, 0);
      return empty;
    }

    const patientNames = new Map<string, string>();
    for (const item of rosterAppointments) {
      if (!patientNames.has(item.patientId)) {
        patientNames.set(item.patientId, `${item.patient.firstName} ${item.patient.lastName}`.trim());
      }
    }

    const [
      completedAppointments,
      questionnaireConsents,
      activeQuestionnaires,
      alerts,
      releasedOrders,
      followUps,
    ] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          providerId: provider.id,
          patientId: { in: patientIds },
          status: "COMPLETED",
        },
        select: { patientId: true, startsAt: true },
        orderBy: { startsAt: "desc" },
        take: 3000,
      }),
      this.prisma.consent.findMany({
        where: {
          patientId: { in: patientIds },
          providerId: provider.id,
          scope: QUESTIONNAIRE_SCOPE,
          version: QUESTIONNAIRE_CONSENT_VERSION,
          purpose: "TREATMENT",
          state: "GRANTED",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { patientId: true },
      }),
      this.prisma.questionnaireVersion.findMany({
        where: { status: "ACTIVE", questionnaire: { active: true } },
        select: { questionnaireId: true, activationRules: true },
      }),
      this.prisma.clinicalAlert.findMany({
        where: {
          ownerProviderId: provider.id,
          patientId: { in: patientIds },
          status: { not: "RESOLVED" },
        },
        select: { patientId: true, createdAt: true },
        take: 2000,
      }),
      this.prisma.clinicalOrder.findMany({
        where: {
          providerId: provider.id,
          patientId: { in: patientIds },
          type: "LABORATORY",
          labResult: { is: { status: "RELEASED", releasedAt: { not: null } } },
        },
        select: {
          patientId: true,
          labResult: { select: { releasedAt: true } },
        },
        take: 2000,
      }),
      this.prisma.providerFollowUpRecommendation.findMany({
        where: {
          providerId: provider.id,
          patientId: { in: patientIds },
          recommendedFor: { lt: now },
        },
        select: {
          patientId: true,
          recommendedFor: true,
        },
        take: 2000,
      }),
    ]);

    const latestCompleted = new Map<string, Date>();
    const completedByPatient = new Map<string, Date[]>();
    for (const item of completedAppointments) {
      if (!latestCompleted.has(item.patientId)) latestCompleted.set(item.patientId, item.startsAt);
      const values = completedByPatient.get(item.patientId) ?? [];
      values.push(item.startsAt);
      completedByPatient.set(item.patientId, values);
    }

    const allowedQuestionnairePatients = new Set(questionnaireConsents.map((item) => item.patientId));
    const questionnaireIds = [...new Set(activeQuestionnaires.map((item) => item.questionnaireId))];
    const questionnaireResponses = questionnaireIds.length === 0
      ? []
      : await this.prisma.questionnaireResponse.findMany({
          where: {
            patientId: { in: patientIds },
            questionnaireId: { in: questionnaireIds },
          },
          select: { patientId: true, questionnaireId: true, completedAt: true },
          orderBy: { completedAt: "desc" },
          take: 5000,
        });
    const latestResponse = new Map<string, Date>();
    for (const response of questionnaireResponses) {
      const key = `${response.patientId}:${response.questionnaireId}`;
      if (!latestResponse.has(key)) latestResponse.set(key, response.completedAt);
    }

    const state = new Map<string, PatientQueueState>();
    for (const patientId of patientIds) {
      state.set(patientId, {
        patientId,
        patientDisplayName: patientNames.get(patientId) ?? "",
        lastCompletedAt: latestCompleted.get(patientId) ?? null,
        latestSignalAt: null,
        pendingQuestionnaireCount: 0,
        openAlertCount: 0,
        newResultCount: 0,
        overdueFollowUpCount: 0,
      });
    }

    for (const patientId of patientIds) {
      if (!allowedQuestionnairePatients.has(patientId)) continue;
      const item = state.get(patientId)!;
      for (const questionnaire of activeQuestionnaires) {
        const last = latestResponse.get(`${patientId}:${questionnaire.questionnaireId}`) ?? null;
        const activation = evaluateQuestionnaireActivation(
          normalizeActivationRules(questionnaire.activationRules),
          last,
          now,
        );
        if (activation.due) item.pendingQuestionnaireCount += 1;
      }
    }

    for (const alert of alerts) {
      const item = state.get(alert.patientId);
      if (!item) continue;
      item.openAlertCount += 1;
      item.latestSignalAt = this.latest(item.latestSignalAt, alert.createdAt);
    }

    for (const order of releasedOrders) {
      const releasedAt = order.labResult?.releasedAt ?? null;
      const item = state.get(order.patientId);
      if (!item || !releasedAt || !item.lastCompletedAt || releasedAt <= item.lastCompletedAt) continue;
      item.newResultCount += 1;
      item.latestSignalAt = this.latest(item.latestSignalAt, releasedAt);
    }

    for (const recommendation of followUps) {
      const dueAt = recommendation.recommendedFor;
      const item = state.get(recommendation.patientId);
      if (!item || !dueAt) continue;
      const completedAfterDue = (completedByPatient.get(recommendation.patientId) ?? [])
        .some((completedAt) => completedAt >= dueAt);
      if (completedAfterDue) continue;
      item.overdueFollowUpCount += 1;
      item.latestSignalAt = this.latest(item.latestSignalAt, dueAt);
    }

    const items = [...state.values()]
      .filter((item) => this.total(item) > 0)
      .sort((left, right) =>
        this.total(right) - this.total(left) ||
        (right.latestSignalAt?.getTime() ?? 0) - (left.latestSignalAt?.getTime() ?? 0) ||
        left.patientDisplayName.localeCompare(right.patientDisplayName),
      )
      .map((item) => ({
        patientId: item.patientId,
        patientDisplayName: item.patientDisplayName,
        lastCompletedAt: item.lastCompletedAt?.toISOString() ?? null,
        latestSignalAt: item.latestSignalAt?.toISOString() ?? null,
        criteria: {
          pendingQuestionnaireCount: item.pendingQuestionnaireCount,
          openAlertCount: item.openAlertCount,
          newResultCount: item.newResultCount,
          overdueFollowUpCount: item.overdueFollowUpCount,
        },
      }));

    const counts = {
      PENDING_QUESTIONNAIRE: items.filter((item) => item.criteria.pendingQuestionnaireCount > 0).length,
      OPEN_ALERT: items.filter((item) => item.criteria.openAlertCount > 0).length,
      NEW_RESULT: items.filter((item) => item.criteria.newResultCount > 0).length,
      OVERDUE_FOLLOW_UP: items.filter((item) => item.criteria.overdueFollowUpCount > 0).length,
    };

    await this.writeAudit(principal, provider.id, counts, patientIds.length);
    return {
      providerId: provider.id,
      generatedAt: now.toISOString(),
      criteriaVersion: CRITERIA_VERSION,
      rosterPatientCount: patientIds.length,
      counts,
      items,
      policy: {
        rosterOnly: true,
        questionnaireConsentRequired: true,
        newResultDefinition: "RELEASED_AFTER_LAST_COMPLETED_CONSULT",
        overdueFollowUpDefinition: "RECOMMENDED_FOR_PASSED_WITHOUT_COMPLETED_CONSULT_AT_OR_AFTER_DUE_DATE",
        autonomousClinicalDecision: false,
      },
    };
  }

  private empty(providerId: string, now: Date) {
    return {
      providerId,
      generatedAt: now.toISOString(),
      criteriaVersion: CRITERIA_VERSION,
      rosterPatientCount: 0,
      counts: {
        PENDING_QUESTIONNAIRE: 0,
        OPEN_ALERT: 0,
        NEW_RESULT: 0,
        OVERDUE_FOLLOW_UP: 0,
      },
      items: [],
      policy: {
        rosterOnly: true,
        questionnaireConsentRequired: true,
        newResultDefinition: "RELEASED_AFTER_LAST_COMPLETED_CONSULT",
        overdueFollowUpDefinition: "RECOMMENDED_FOR_PASSED_WITHOUT_COMPLETED_CONSULT_AT_OR_AFTER_DUE_DATE",
        autonomousClinicalDecision: false,
      },
    };
  }

  private total(item: CriterionCounts) {
    return item.pendingQuestionnaireCount + item.openAlertCount + item.newResultCount + item.overdueFollowUpCount;
  }

  private latest(current: Date | null, candidate: Date) {
    return !current || candidate > current ? candidate : current;
  }

  private writeAudit(
    principal: AuthPrincipal,
    providerId: string,
    counts: Record<string, number>,
    rosterPatientCount: number,
  ) {
    return this.audit.writeClinical({
      actorId: principal.accountId,
      action: "DOCTOR_WORK_QUEUE_READ",
      objectType: "PROVIDER",
      objectId: providerId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "DOCTOR_WORK_QUEUE",
        providerId,
        criteriaVersion: CRITERIA_VERSION,
        rosterPatientCount,
        counts,
        autonomousClinicalDecision: false,
        decision: "ALLOW",
      },
    });
  }
}

@Controller("provider/work-queue")
class DoctorWorkQueueController {
  constructor(private readonly queue: DoctorWorkQueueService) {}

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Get()
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.queue.queue(principal);
  }
}

@Module({
  controllers: [DoctorWorkQueueController],
  providers: [DoctorWorkQueueService],
})
export class DoctorWorkQueueModule {}
