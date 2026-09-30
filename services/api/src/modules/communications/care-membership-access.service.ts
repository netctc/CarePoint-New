import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const CARE_COORDINATION_SCOPE = "CARE_COORDINATION";
const CARE_COORDINATION_CONSENT_VERSION = "care-coordination-v1";

@Injectable()
export class CareMembershipAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async pruneForAccount(accountId: string): Promise<void> {
    const memberships = await this.prisma.careConversationParticipant.findMany({
      where: { accountId, kind: "PROVIDER", leftAt: null, providerId: { not: null } },
      select: { conversationId: true, providerId: true },
    });
    for (const membership of memberships) {
      if (membership.providerId) await this.revalidateAddedProvider(membership.conversationId, accountId, membership.providerId, false);
    }
  }

  async pruneConversation(conversationId: string): Promise<void> {
    const memberships = await this.prisma.careConversationParticipant.findMany({
      where: { conversationId, kind: "PROVIDER", leftAt: null, providerId: { not: null } },
      select: { accountId: true, providerId: true },
    });
    for (const membership of memberships) {
      if (membership.providerId) await this.revalidateAddedProvider(conversationId, membership.accountId, membership.providerId, false);
    }
  }

  async assertActiveAccess(principal: AuthPrincipal, conversationId: string): Promise<void> {
    const membership = await this.prisma.careConversationParticipant.findUnique({
      where: { conversationId_accountId: { conversationId, accountId: principal.accountId } },
      select: { kind: true, providerId: true, leftAt: true },
    });
    if (!membership || membership.leftAt) throw new ForbiddenException("Secure conversation access denied.");
    if (membership.kind !== "PROVIDER" || !membership.providerId) return;
    await this.revalidateAddedProvider(conversationId, principal.accountId, membership.providerId, true);
  }

  private async revalidateAddedProvider(conversationId: string, accountId: string, providerId: string, throwOnRevoked: boolean): Promise<void> {
    const conversation = await this.prisma.careConversation.findUnique({
      where: { id: conversationId },
      select: { patientId: true, appointmentId: true },
    });
    if (!conversation) {
      if (throwOnRevoked) throw new ForbiddenException("Secure conversation access denied.");
      return;
    }

    if (conversation.appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: conversation.appointmentId },
        select: { providerId: true },
      });
      if (appointment?.providerId === providerId) return;
    }

    if (await this.hasCurrentCareBasis(providerId, conversation.patientId)) return;

    const now = new Date();
    const revoked = await this.prisma.careConversationParticipant.updateMany({
      where: { conversationId, accountId, providerId, leftAt: null },
      data: { leftAt: now },
    });
    if (revoked.count > 0) {
      await this.audit.write({
        actorId: accountId,
        action: "CARE_PARTICIPANT_ACCESS_REVOKED",
        objectType: "CARE_CONVERSATION",
        objectId: conversationId,
        purpose: "CARE_COORDINATION",
        result: "SUCCESS",
        metadata: { providerId, reason: "CARE_BASIS_NO_LONGER_ACTIVE" },
      });
    }
    if (throwOnRevoked) throw new ForbiddenException("Care-team access is no longer authorized by an active treatment relationship or provider-specific consent.");
  }

  private async hasCurrentCareBasis(providerId: string, patientId: string): Promise<boolean> {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (relationship) return true;

    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId,
        providerId,
        scope: CARE_COORDINATION_SCOPE,
        version: CARE_COORDINATION_CONSENT_VERSION,
        state: "GRANTED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
      orderBy: { grantedAt: "desc" },
    });
    return Boolean(consent);
  }
}
