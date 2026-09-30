import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  principalHasAnyPermission,
  type AuthPrincipal,
  type Permission,
} from "@carepoint/identity";
import { defer, from, interval, type Observable, throwError } from "rxjs";
import { catchError, concatMap, finalize, mergeMap, startWith, switchMap } from "rxjs/operators";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

export const REALTIME_TOPICS = [
  "CLINICAL_ALERTS",
  "QUESTIONNAIRE_COMPLETIONS",
  "OBSERVATIONS",
  "PROVIDER_JOB_STATUS",
] as const;

export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export interface RealtimeStreamQuery {
  topic?: string;
  patientId?: string;
  after?: string;
}

export interface RealtimeMessage {
  id: string;
  type: string;
  data: {
    topic: RealtimeTopic;
    eventType: "ALERT_RAISED" | "QUESTIONNAIRE_COMPLETED" | "OBSERVATION_RECORDED" | "JOB_STATUS_CHANGED";
    entityType: "CLINICAL_ALERT" | "QUESTIONNAIRE_RESPONSE" | "OBSERVATION" | "PROVIDER_WORKFLOW_EVENT";
    entityId: string;
    occurredAt: string;
  };
}

type Cursor = { at: Date; id: string };
type SubscriptionContext = {
  id: string;
  topic: RealtimeTopic;
  scopeKey: string;
  subjectType: "PATIENT" | "PROVIDER";
  subjectId: string;
  principal: AuthPrincipal;
  cursor: Cursor;
  lastEvidenceTouchAt: number;
};

const TOPIC_PROVIDER_SCOPE: Record<Exclude<RealtimeTopic, "PROVIDER_JOB_STATUS">, Permission> = {
  CLINICAL_ALERTS: "CLINICAL_RECORD_READ",
  QUESTIONNAIRE_COMPLETIONS: "CLINICAL_QUESTIONNAIRE_READ",
  OBSERVATIONS: "CLINICAL_OBSERVATION_READ",
};

const TOPIC_PATIENT_SCOPE: Record<Exclude<RealtimeTopic, "PROVIDER_JOB_STATUS">, Permission> = {
  CLINICAL_ALERTS: "PATIENT_READ_CLINICAL_RECORD",
  QUESTIONNAIRE_COMPLETIONS: "PATIENT_MANAGE_QUESTIONNAIRE",
  OBSERVATIONS: "PATIENT_MANAGE_OBSERVATIONS",
};

const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;
const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const POLL_MS = 3_000;
const EVIDENCE_TOUCH_MS = 30_000;

@Injectable()
export class RealtimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  stream(principal: AuthPrincipal, query: RealtimeStreamQuery): Observable<RealtimeMessage> {
    const normalized = this.normalize(query);
    return defer(() => from(this.createSubscription(principal, normalized))).pipe(
      switchMap((context) => interval(POLL_MS).pipe(
        startWith(0),
        concatMap(() => from(this.poll(context))),
        mergeMap((events) => from(events)),
        finalize(() => void this.closeSubscription(context.id, "CLIENT_DISCONNECTED")),
      )),
      catchError((error) => throwError(() => error)),
    );
  }

  private async createSubscription(
    principal: AuthPrincipal,
    query: { topic: RealtimeTopic; patientId: string | null; after: Date },
  ): Promise<SubscriptionContext> {
    const authorization = await this.authorize(principal, query.topic, query.patientId);
    const row = await this.prisma.realtimeSubscription.create({
      data: {
        actorId: principal.accountId,
        sessionId: principal.sessionId,
        topic: query.topic,
        scopeKey: authorization.scopeKey,
        subjectType: authorization.subjectType,
        subjectId: authorization.subjectId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "REALTIME_SUBSCRIPTION_OPENED",
      objectType: "REALTIME_SUBSCRIPTION",
      objectId: row.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        topic: query.topic,
        scopeKey: authorization.scopeKey,
        subjectType: authorization.subjectType,
      },
    });
    return {
      id: row.id,
      topic: query.topic,
      scopeKey: authorization.scopeKey,
      subjectType: authorization.subjectType,
      subjectId: authorization.subjectId,
      principal,
      cursor: { at: query.after, id: "" },
      lastEvidenceTouchAt: Date.now(),
    };
  }

  private async poll(context: SubscriptionContext): Promise<RealtimeMessage[]> {
    try {
      const authorization = await this.authorize(
        context.principal,
        context.topic,
        context.subjectType === "PATIENT" ? context.subjectId : null,
      );
      if (
        authorization.scopeKey !== context.scopeKey
        || authorization.subjectType !== context.subjectType
        || authorization.subjectId !== context.subjectId
      ) {
        throw new ForbiddenException("Realtime subscription scope changed.");
      }
      if (Date.now() - context.lastEvidenceTouchAt >= EVIDENCE_TOUCH_MS) {
        await this.prisma.realtimeSubscription.update({
          where: { id: context.id },
          data: { lastAuthorizedAt: new Date() },
        });
        context.lastEvidenceTouchAt = Date.now();
      }
      const events = await this.readTopic(context);
      if (events.length > 0) {
        const last = events.at(-1)!;
        context.cursor = { at: new Date(last.data.occurredAt), id: last.id };
      }
      return events;
    } catch (error) {
      await this.closeSubscription(
        context.id,
        error instanceof UnauthorizedException ? "SESSION_REVOKED_OR_EXPIRED" : "AUTHORIZATION_REVOKED",
      );
      throw error;
    }
  }

  private async authorize(principal: AuthPrincipal, topic: RealtimeTopic, patientIdInput: string | null) {
    await this.assertLiveSession(principal);

    if (topic === "PROVIDER_JOB_STATUS") {
      if (principal.role !== "OTHER_PROVIDER" || !principalHasAnyPermission(principal, ["OTHER_PROVIDER_WORKFLOW_EXECUTE"])) {
        throw new ForbiddenException("Provider job realtime access denied.");
      }
      const provider = await this.prisma.provider.findUnique({
        where: { userId: principal.accountId },
        select: { id: true, status: true },
      });
      if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("Active provider profile required.");
      return {
        scopeKey: "OTHER_PROVIDER_WORKFLOW_EXECUTE",
        subjectType: "PROVIDER" as const,
        subjectId: provider.id,
      };
    }

    if (principal.role === "PATIENT") {
      const patient = await this.prisma.patientProfile.findUnique({
        where: { userId: principal.accountId },
        select: { id: true },
      });
      if (!patient) throw new ForbiddenException("Patient profile required.");
      const requestedPatientId = patientIdInput ? this.identifier(patientIdInput, "patientId") : patient.id;
      if (requestedPatientId !== patient.id) throw new ForbiddenException("Realtime patient scope mismatch.");
      const scopeKey = TOPIC_PATIENT_SCOPE[topic];
      if (!principalHasAnyPermission(principal, [scopeKey])) throw new ForbiddenException("Realtime topic permission denied.");
      return { scopeKey, subjectType: "PATIENT" as const, subjectId: patient.id };
    }

    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Realtime clinical topics are not available to this role.");
    }
    const patientId = this.identifier(patientIdInput, "patientId");
    const scopeKey = TOPIC_PROVIDER_SCOPE[topic];
    if (!principalHasAnyPermission(principal, [scopeKey])) throw new ForbiddenException("Realtime topic permission denied.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("Active provider profile required.");
    const now = new Date();
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        patientId,
        providerId: provider.id,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: {
          gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000),
          lte: new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000),
        },
      },
      select: { id: true },
    });
    if (!relationship) throw new ForbiddenException("Current treatment relationship required for realtime clinical data.");
    return { scopeKey, subjectType: "PATIENT" as const, subjectId: patientId };
  }

  private async assertLiveSession(principal: AuthPrincipal): Promise<void> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: principal.sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (
      !session
      || session.userId !== principal.accountId
      || session.revokedAt
      || session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Realtime session expired or revoked.");
    }
  }

  private async readTopic(context: SubscriptionContext): Promise<RealtimeMessage[]> {
    if (context.topic === "CLINICAL_ALERTS") {
      const rows = await this.prisma.clinicalAlert.findMany({
        where: { patientId: context.subjectId, createdAt: { gte: context.cursor.at } },
        select: { id: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
      });
      return this.afterCursor(rows, context.cursor).map((row) => this.message(
        context.topic,
        row.id,
        row.createdAt,
        "ALERT_RAISED",
        "CLINICAL_ALERT",
      ));
    }
    if (context.topic === "QUESTIONNAIRE_COMPLETIONS") {
      const rows = await this.prisma.questionnaireResponse.findMany({
        where: { patientId: context.subjectId, completedAt: { gte: context.cursor.at } },
        select: { id: true, completedAt: true },
        orderBy: [{ completedAt: "asc" }, { id: "asc" }],
        take: 100,
      });
      return this.afterCursor(rows.map((row) => ({ id: row.id, createdAt: row.completedAt })), context.cursor).map((row) => this.message(
        context.topic,
        row.id,
        row.createdAt,
        "QUESTIONNAIRE_COMPLETED",
        "QUESTIONNAIRE_RESPONSE",
      ));
    }
    if (context.topic === "OBSERVATIONS") {
      const rows = await this.prisma.observation.findMany({
        where: { patientId: context.subjectId, createdAt: { gte: context.cursor.at } },
        select: { id: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
      });
      return this.afterCursor(rows, context.cursor).map((row) => this.message(
        context.topic,
        row.id,
        row.createdAt,
        "OBSERVATION_RECORDED",
        "OBSERVATION",
      ));
    }
    const rows = await this.prisma.providerWorkflowEvent.findMany({
      where: { providerId: context.subjectId, occurredAt: { gte: context.cursor.at } },
      select: { id: true, occurredAt: true },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    return this.afterCursor(rows.map((row) => ({ id: row.id, createdAt: row.occurredAt })), context.cursor).map((row) => this.message(
      context.topic,
      row.id,
      row.createdAt,
      "JOB_STATUS_CHANGED",
      "PROVIDER_WORKFLOW_EVENT",
    ));
  }

  private afterCursor<T extends { id: string; createdAt: Date }>(rows: T[], cursor: Cursor): T[] {
    return rows.filter((row) => (
      row.createdAt.getTime() > cursor.at.getTime()
      || (row.createdAt.getTime() === cursor.at.getTime() && row.id > cursor.id)
    ));
  }

  private message(
    topic: RealtimeTopic,
    id: string,
    occurredAt: Date,
    eventType: RealtimeMessage["data"]["eventType"],
    entityType: RealtimeMessage["data"]["entityType"],
  ): RealtimeMessage {
    return {
      id,
      type: eventType,
      data: {
        topic,
        eventType,
        entityType,
        entityId: id,
        occurredAt: occurredAt.toISOString(),
      },
    };
  }

  private normalize(query: RealtimeStreamQuery) {
    const topicInput = typeof query?.topic === "string" ? query.topic.trim().toUpperCase() : "";
    if (!REALTIME_TOPICS.includes(topicInput as RealtimeTopic)) {
      throw new BadRequestException(`topic must be one of ${REALTIME_TOPICS.join(", ")}.`);
    }
    const after = query?.after ? new Date(query.after) : new Date();
    if (Number.isNaN(after.getTime())) throw new BadRequestException("after must be an ISO datetime.");
    const oldest = Date.now() - REPLAY_WINDOW_MS;
    if (after.getTime() < oldest) throw new BadRequestException("after exceeds the bounded 10-minute realtime replay window.");
    if (after.getTime() > Date.now() + 5_000) throw new BadRequestException("after cannot be in the future.");
    return {
      topic: topicInput as RealtimeTopic,
      patientId: query?.patientId?.trim() || null,
      after,
    };
  }

  private async closeSubscription(subscriptionId: string, reason: string): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.realtimeSubscription.updateMany({
      where: { id: subscriptionId, disconnectedAt: null },
      data: { disconnectedAt: now, disconnectReason: reason.slice(0, 80) },
    });
    if (updated.count !== 1) return;
    const row = await this.prisma.realtimeSubscription.findUnique({
      where: { id: subscriptionId },
      select: { actorId: true, topic: true, scopeKey: true, subjectType: true },
    });
    await this.audit.write({
      actorId: row?.actorId ?? null,
      action: "REALTIME_SUBSCRIPTION_CLOSED",
      objectType: "REALTIME_SUBSCRIPTION",
      objectId: subscriptionId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        topic: row?.topic ?? null,
        scopeKey: row?.scopeKey ?? null,
        subjectType: row?.subjectType ?? null,
        reason,
      },
    }).catch(() => undefined);
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
}
