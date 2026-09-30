import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { QuestionnaireService } from "./questionnaire.service";

@Injectable()
export class QuestionnaireReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly questionnaires: QuestionnaireService,
  ) {}

  async statusForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    code: string,
    responseId: string,
  ) {
    const context = await this.requireContext(principal, patientId, code, responseId);
    const review = await this.prisma.questionnaireResponseReview.findUnique({
      where: {
        responseId_providerId: {
          responseId: context.response.id,
          providerId: context.providerId,
        },
      },
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "QUESTIONNAIRE_RESPONSE_REVIEW_STATUS_READ",
      objectType: "QUESTIONNAIRE_RESPONSE",
      objectId: context.response.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "QUESTIONNAIRE_REVIEW",
        accessBasis: context.accessBasis,
        patientId,
        providerId: context.providerId,
        responseId: context.response.id,
        responseSequence: context.response.sequence,
        reviewed: Boolean(review),
        decision: "ALLOW",
      },
    });

    return this.present(context, review);
  }

  async markReviewedForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    code: string,
    responseId: string,
  ) {
    const context = await this.requireContext(principal, patientId, code, responseId);
    const review = await this.prisma.$transaction(async (tx) => {
      const row = await tx.questionnaireResponseReview.upsert({
        where: {
          responseId_providerId: {
            responseId: context.response.id,
            providerId: context.providerId,
          },
        },
        update: {},
        create: {
          responseId: context.response.id,
          patientId,
          responseSequence: context.response.sequence,
          providerId: context.providerId,
          reviewerActorId: principal.accountId,
        },
      });

      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_RESPONSE_REVIEWED",
        objectType: "QUESTIONNAIRE_RESPONSE_REVIEW",
        objectId: row.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "QUESTIONNAIRE_REVIEW",
          accessBasis: context.accessBasis,
          patientId,
          providerId: context.providerId,
          responseId: context.response.id,
          responseSequence: context.response.sequence,
          questionnaireVersion: context.response.questionnaireVersion.version,
          decision: "ALLOW",
        },
      });
      return row;
    });

    return this.present(context, review);
  }

  private async requireContext(
    principal: AuthPrincipal,
    patientId: string,
    code: string,
    responseId: string,
  ) {
    const authorized = await this.questionnaires.latestForDoctor(principal, patientId, code);
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new NotFoundException("Active doctor provider profile not found.");
    }

    const response = await this.prisma.questionnaireResponse.findFirst({
      where: {
        id: responseId,
        patientId,
        questionnaire: { code: authorized.code },
      },
      select: {
        id: true,
        patientId: true,
        sequence: true,
        completedAt: true,
        questionnaireVersion: { select: { version: true } },
      },
    });
    if (!response) throw new NotFoundException("Questionnaire response not found.");

    return {
      patientId,
      code: authorized.code,
      accessBasis: authorized.accessBasis,
      providerId: provider.id,
      response,
    };
  }

  private present(
    context: {
      patientId: string;
      code: string;
      accessBasis: string;
      providerId: string;
      response: {
        id: string;
        patientId: string;
        sequence: number;
        completedAt: Date;
        questionnaireVersion: { version: number };
      };
    },
    review: {
      id: string;
      responseId: string;
      patientId: string;
      responseSequence: number;
      providerId: string;
      reviewerActorId: string;
      reviewedAt: Date;
    } | null,
  ) {
    return {
      patientId: context.patientId,
      code: context.code,
      response: {
        id: context.response.id,
        sequence: context.response.sequence,
        questionnaireVersion: context.response.questionnaireVersion.version,
        completedAt: context.response.completedAt,
      },
      reviewed: Boolean(review),
      review: review
        ? {
            id: review.id,
            providerId: review.providerId,
            reviewerActorId: review.reviewerActorId,
            reviewedAt: review.reviewedAt,
          }
        : null,
      accessBasis: context.accessBasis,
    };
  }
}
