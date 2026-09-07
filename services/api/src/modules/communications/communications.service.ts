import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AddCareParticipantInput, CreateCareConversationInput, SendCareMessageInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { MessagingEnvelopeService } from "./messaging-envelope.service";
import { NotificationsService } from "./notifications.service";

const MAX_SUBJECT_CHARS = 240;
const MAX_MESSAGE_CHARS = 12000;
const MAX_ATTACHMENTS = 10;
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const CARE_COORDINATION_SCOPE = "CARE_COORDINATION";
const CARE_COORDINATION_CONSENT_VERSION = "care-coordination-v1";

type EncryptedRow = { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string };
type EncryptedSubjectRow = { subjectAlgorithm: string; subjectKeyId: string; subjectWrappedKey: string; subjectIv: string; subjectCiphertext: string };

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: MessagingEnvelopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async createConversation(principal: AuthPrincipal, input: CreateCareConversationInput) {
    const clientConversationId = this.requiredText(input.clientConversationId, 8, 180, "clientConversationId");
    const existing = await this.prisma.careConversation.findUnique({
      where: { createdByAccountId_clientConversationId: { createdByAccountId: principal.accountId, clientConversationId } },
    });
    if (existing) {
      await this.requireMembership(principal.accountId, existing.id);
      return this.getConversation(principal, existing.id);
    }

    const appointment = await this.requireMessagingAppointment(input.appointmentId);
    await this.assertDirectParticipant(principal, appointment);
    if (!appointment.patient.userId || !appointment.provider.userId) throw new ConflictException("Both appointment parties require linked CarePoint accounts for secure messaging.");

    const subject = this.requiredText(input.subject, 1, MAX_SUBJECT_CHARS, "subject");
    const encrypted = await this.envelope.encrypt({ schemaVersion: 1, text: subject });
    let conversation;
    try {
      conversation = await this.prisma.$transaction(async (tx) => {
        const created = await tx.careConversation.create({
          data: {
            patientId: appointment.patientId,
            appointmentId: appointment.id,
            createdByAccountId: principal.accountId,
            clientConversationId,
            subjectAlgorithm: encrypted.algorithm,
            subjectKeyId: encrypted.keyId,
            subjectWrappedKey: encrypted.wrappedKey,
            subjectIv: encrypted.iv,
            subjectCiphertext: encrypted.ciphertext,
          },
        });
        await tx.careConversationParticipant.createMany({
          data: [
            { conversationId: created.id, accountId: appointment.patient.userId, kind: "PATIENT" },
            { conversationId: created.id, accountId: appointment.provider.userId, providerId: appointment.providerId, kind: "PROVIDER" },
          ],
        });
        return created;
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.prisma.careConversation.findUnique({
        where: { createdByAccountId_clientConversationId: { createdByAccountId: principal.accountId, clientConversationId } },
      });
      if (!raced) throw error;
      conversation = raced;
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "CARE_CONVERSATION_CREATED",
      objectType: "CARE_CONVERSATION",
      objectId: conversation.id,
      purpose: "CARE_COORDINATION",
      result: "SUCCESS",
      metadata: { appointmentId: appointment.id },
    });

    if (input.initialMessage?.trim()) {
      await this.sendMessage(principal, conversation.id, {
        body: input.initialMessage,
        clientMessageId: `initial:${clientConversationId}`,
      });
    }
    return this.getConversation(principal, conversation.id);
  }

  async listConversations(principal: AuthPrincipal) {
    this.assertMessagingRole(principal);
    const memberships = await this.prisma.careConversationParticipant.findMany({
      where: { accountId: principal.accountId, leftAt: null },
      select: { conversationId: true },
    });
    if (memberships.length === 0) return [];
    const conversations = await this.prisma.careConversation.findMany({
      where: { id: { in: memberships.map((item) => item.conversationId) } },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    const result = [];
    for (const conversation of conversations) {
      const unreadCount = await this.prisma.careMessage.count({
        where: {
          conversationId: conversation.id,
          senderAccountId: { not: principal.accountId },
          readReceipts: { none: { accountId: principal.accountId } },
        },
      });
      result.push({ ...(await this.presentConversation(conversation)), unreadCount });
    }
    return result;
  }

  async getConversation(principal: AuthPrincipal, conversationId: string) {
    this.assertMessagingRole(principal);
    await this.requireMembership(principal.accountId, conversationId);
    const conversation = await this.prisma.careConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("Care conversation not found.");
    const messages = await this.prisma.careMessage.findMany({
      where: { conversationId },
      include: { attachments: true, readReceipts: true },
      orderBy: { sentAt: "asc" },
      take: 500,
    });
    const presentedMessages = [];
    for (const message of messages) presentedMessages.push(await this.presentMessage(message));
    await this.audit.write({ actorId: principal.accountId, action: "CARE_CONVERSATION_READ", objectType: "CARE_CONVERSATION", objectId: conversation.id, purpose: "CARE_COORDINATION", result: "SUCCESS" });
    return { ...(await this.presentConversation(conversation)), messages: presentedMessages };
  }

  async sendMessage(principal: AuthPrincipal, conversationId: string, input: SendCareMessageInput) {
    this.assertMessagingRole(principal);
    const membership = await this.requireMembership(principal.accountId, conversationId);
    const conversation = await this.prisma.careConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("Care conversation not found.");
    if (conversation.status !== "OPEN") throw new ConflictException("This care conversation is closed.");

    const clientMessageId = this.requiredText(input.clientMessageId, 8, 180, "clientMessageId");
    const existing = await this.prisma.careMessage.findUnique({
      where: { senderAccountId_clientMessageId: { senderAccountId: principal.accountId, clientMessageId } },
      include: { attachments: true, readReceipts: true },
    });
    if (existing) {
      if (existing.conversationId !== conversationId) throw new ConflictException("clientMessageId was already used in another conversation.");
      await this.notifyOtherParticipants(conversationId, principal.accountId, existing.id);
      return this.presentMessage(existing);
    }

    const body = this.requiredText(input.body, 1, MAX_MESSAGE_CHARS, "body");
    if (Buffer.byteLength(body, "utf8") > 48 * 1024) throw new BadRequestException("Secure message body is too large.");
    const documentIds = [...new Set(input.attachmentDocumentIds ?? [])];
    if (documentIds.length > MAX_ATTACHMENTS) throw new BadRequestException(`A secure message supports at most ${MAX_ATTACHMENTS} attachments.`);
    await this.validateAttachments(conversation.patientId, membership.providerId, principal.role, documentIds);

    const encrypted = await this.envelope.encrypt({ schemaVersion: 1, text: body });
    let message;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.careMessage.create({
          data: {
            conversationId,
            senderAccountId: principal.accountId,
            clientMessageId,
            algorithm: encrypted.algorithm,
            keyId: encrypted.keyId,
            wrappedKey: encrypted.wrappedKey,
            iv: encrypted.iv,
            ciphertext: encrypted.ciphertext,
          },
        });
        if (documentIds.length > 0) {
          await tx.careMessageAttachment.createMany({ data: documentIds.map((clinicalDocumentId) => ({ messageId: created.id, clinicalDocumentId })) });
        }
        await tx.careMessageReadReceipt.create({ data: { messageId: created.id, accountId: principal.accountId } });
        await tx.careConversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.sentAt } });
        return created;
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.prisma.careMessage.findUnique({
        where: { senderAccountId_clientMessageId: { senderAccountId: principal.accountId, clientMessageId } },
      });
      if (!raced || raced.conversationId !== conversationId) throw error;
      message = raced;
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "CARE_MESSAGE_SENT",
      objectType: "CARE_MESSAGE",
      objectId: message.id,
      purpose: "CARE_COORDINATION",
      result: "SUCCESS",
      metadata: { conversationId, attachmentCount: documentIds.length },
    });
    await this.notifyOtherParticipants(conversationId, principal.accountId, message.id);
    const stored = await this.prisma.careMessage.findUnique({ where: { id: message.id }, include: { attachments: true, readReceipts: true } });
    if (!stored) throw new NotFoundException("Secure message not found after persistence.");
    return this.presentMessage(stored);
  }

  async markRead(principal: AuthPrincipal, conversationId: string) {
    this.assertMessagingRole(principal);
    await this.requireMembership(principal.accountId, conversationId);
    const messages = await this.prisma.careMessage.findMany({ where: { conversationId }, select: { id: true } });
    if (messages.length > 0) {
      await this.prisma.careMessageReadReceipt.createMany({
        data: messages.map((message) => ({ messageId: message.id, accountId: principal.accountId })),
        skipDuplicates: true,
      });
    }
    await this.audit.write({ actorId: principal.accountId, action: "CARE_CONVERSATION_MARKED_READ", objectType: "CARE_CONVERSATION", objectId: conversationId, purpose: "CARE_COORDINATION", result: "SUCCESS", metadata: { messageCount: messages.length } });
    return { conversationId, unreadCount: 0, readAt: new Date() };
  }

  async closeConversation(principal: AuthPrincipal, conversationId: string) {
    this.assertMessagingRole(principal);
    await this.requireMembership(principal.accountId, conversationId);
    const conversation = await this.prisma.careConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("Care conversation not found.");
    if (conversation.status === "CLOSED") return this.presentConversation(conversation);
    const closed = await this.prisma.careConversation.update({ where: { id: conversation.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "CARE_CONVERSATION_CLOSED", objectType: "CARE_CONVERSATION", objectId: conversation.id, purpose: "CARE_COORDINATION", result: "SUCCESS" });
    return this.presentConversation(closed);
  }

  async addCareParticipant(principal: AuthPrincipal, conversationId: string, input: AddCareParticipantInput) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("Only healthcare providers may coordinate additional care-team participants.");
    const callerMembership = await this.requireMembership(principal.accountId, conversationId);
    if (callerMembership.kind !== "PROVIDER") throw new ForbiddenException("A provider conversation membership is required.");
    const conversation = await this.prisma.careConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("Care conversation not found.");
    if (conversation.status !== "OPEN") throw new ConflictException("This care conversation is closed.");

    const targetProviderId = this.requiredText(input.providerId, 1, 100, "providerId");
    const target = await this.prisma.provider.findUnique({ where: { id: targetProviderId }, select: { id: true, userId: true, status: true, class: true, displayName: true } });
    if (!target || target.status !== "ACTIVE" || !target.userId) throw new NotFoundException("Active target provider account not found.");
    if (target.id === callerMembership.providerId) throw new ConflictException("The provider is already the coordinating participant.");
    const accessBasis = await this.careTeamAccessBasis(target.id, conversation.patientId);
    if (!accessBasis) {
      await this.audit.write({ actorId: principal.accountId, action: "CARE_PARTICIPANT_ADD_DENIED", objectType: "CARE_CONVERSATION", objectId: conversation.id, purpose: "CARE_COORDINATION", result: "DENIED", metadata: { targetProviderId: target.id } });
      throw new ForbiddenException("The target provider has no treatment relationship or provider-specific care-coordination consent.");
    }

    const participant = await this.prisma.careConversationParticipant.upsert({
      where: { conversationId_accountId: { conversationId, accountId: target.userId } },
      create: { conversationId, accountId: target.userId, providerId: target.id, kind: "PROVIDER" },
      update: { providerId: target.id, kind: "PROVIDER", leftAt: null },
    });
    await this.audit.write({ actorId: principal.accountId, action: "CARE_PARTICIPANT_ADDED", objectType: "CARE_CONVERSATION", objectId: conversation.id, purpose: "CARE_COORDINATION", result: "SUCCESS", metadata: { targetProviderId: target.id, accessBasis } });
    await this.notifications.notifyAccount({ accountId: target.userId, dedupeKey: `care-participant:${conversation.id}`, type: "CARE_COORDINATION", entityType: "CARE_CONVERSATION", entityId: conversation.id, safeTitleKey: "notification.care.title", safeBodyKey: "notification.care.body" });
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: conversation.patientId }, select: { userId: true } });
    if (patient?.userId) await this.notifications.notifyAccount({ accountId: patient.userId, dedupeKey: `care-participant:${conversation.id}:${target.id}`, type: "CARE_COORDINATION", entityType: "CARE_CONVERSATION", entityId: conversation.id, safeTitleKey: "notification.care.title", safeBodyKey: "notification.care.body" });
    return { id: participant.id, providerId: target.id, accountId: target.userId, kind: participant.kind, accessBasis, joinedAt: participant.joinedAt };
  }

  private async notifyOtherParticipants(conversationId: string, senderAccountId: string, messageId: string) {
    const recipients = await this.prisma.careConversationParticipant.findMany({
      where: { conversationId, leftAt: null, accountId: { not: senderAccountId } },
      select: { accountId: true },
    });
    for (const recipient of recipients) {
      await this.notifications.notifyAccount({
        accountId: recipient.accountId,
        dedupeKey: `secure-message:${messageId}`,
        type: "SECURE_MESSAGE",
        entityType: "CARE_CONVERSATION",
        entityId: conversationId,
        safeTitleKey: "notification.message.title",
        safeBodyKey: "notification.message.body",
      });
    }
  }

  private async validateAttachments(patientId: string, senderProviderId: string | null, role: AuthPrincipal["role"], documentIds: string[]) {
    if (documentIds.length === 0) return;
    const documents = await this.prisma.clinicalDocument.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, patientId: true, providerId: true, status: true, releasedToPatient: true },
    });
    if (documents.length !== documentIds.length) throw new BadRequestException("One or more clinical document attachments do not exist.");
    for (const document of documents) {
      if (document.patientId !== patientId || document.status !== "AVAILABLE") throw new ForbiddenException("Clinical document attachment access denied.");
      if ((role === "DOCTOR" || role === "OTHER_PROVIDER") && document.providerId !== senderProviderId && !document.releasedToPatient) {
        throw new ForbiddenException("Providers may attach only their own or patient-released clinical documents.");
      }
    }
  }

  private async careTeamAccessBasis(providerId: string, patientId: string): Promise<"TREATMENT_RELATIONSHIP" | "PATIENT_CONSENT" | null> {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const relationship = await this.prisma.appointment.findFirst({
      where: { providerId, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } },
      select: { id: true },
    });
    if (relationship) return "TREATMENT_RELATIONSHIP";
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
    return consent ? "PATIENT_CONSENT" : null;
  }

  private async presentConversation(conversation: any) {
    const subject = await this.envelope.decrypt<{ schemaVersion: number; text: string }>(this.subjectEnvelope(conversation));
    const participants = await this.prisma.careConversationParticipant.findMany({ where: { conversationId: conversation.id, leftAt: null }, orderBy: { joinedAt: "asc" } });
    const accountIds = participants.map((participant) => participant.accountId);
    const providerIds = participants.flatMap((participant) => participant.providerId ? [participant.providerId] : []);
    const accounts = await this.prisma.user.findMany({ where: { id: { in: accountIds } }, select: { id: true, role: true, patientProfile: { select: { firstName: true, lastName: true } } } });
    const providers = providerIds.length === 0 ? [] : await this.prisma.provider.findMany({ where: { id: { in: providerIds } }, select: { id: true, displayName: true, class: true } });
    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
    return {
      id: conversation.id,
      patientId: conversation.patientId,
      appointmentId: conversation.appointmentId,
      status: conversation.status,
      subject: subject.text,
      lastMessageAt: conversation.lastMessageAt,
      closedAt: conversation.closedAt,
      createdAt: conversation.createdAt,
      participants: participants.map((participant) => {
        const account = accountMap.get(participant.accountId);
        const provider = participant.providerId ? providerMap.get(participant.providerId) : undefined;
        const patientName = account?.patientProfile ? `${account.patientProfile.firstName} ${account.patientProfile.lastName}`.trim() : null;
        return { id: participant.id, accountId: participant.accountId, providerId: participant.providerId, kind: participant.kind, role: account?.role ?? null, displayName: provider?.displayName ?? patientName, providerClass: provider?.class ?? null, joinedAt: participant.joinedAt };
      }),
    };
  }

  private async presentMessage(message: any) {
    const payload = await this.envelope.decrypt<{ schemaVersion: number; text: string }>(this.messageEnvelope(message));
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderAccountId: message.senderAccountId,
      body: payload.text,
      sentAt: message.sentAt,
      attachmentDocumentIds: (message.attachments ?? []).map((attachment: any) => attachment.clinicalDocumentId),
      readBy: (message.readReceipts ?? []).map((receipt: any) => ({ accountId: receipt.accountId, readAt: receipt.readAt })),
    };
  }

  private async requireMembership(accountId: string, conversationId: string) {
    const membership = await this.prisma.careConversationParticipant.findUnique({ where: { conversationId_accountId: { conversationId, accountId } } });
    if (!membership || membership.leftAt) {
      await this.audit.write({ actorId: accountId, action: "CARE_CONVERSATION_ACCESS_DENIED", objectType: "CARE_CONVERSATION", objectId: conversationId, purpose: "CARE_COORDINATION", result: "DENIED" });
      throw new ForbiddenException("Secure conversation access denied.");
    }
    return membership;
  }

  private async requireMessagingAppointment(appointmentId: string) {
    const id = this.requiredText(appointmentId, 1, 100, "appointmentId");
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, userId: true } },
        provider: { select: { id: true, userId: true, status: true, class: true, displayName: true } },
      },
    });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    if (appointment.status !== "CONFIRMED" && appointment.status !== "COMPLETED") throw new ConflictException("Secure messaging requires a confirmed or completed treatment appointment.");
    if (appointment.provider.status !== "ACTIVE") throw new ConflictException("The appointment provider is not active.");
    return appointment;
  }

  private async assertDirectParticipant(principal: AuthPrincipal, appointment: any) {
    if (principal.role === "PATIENT") {
      const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
      if (!patient || patient.id !== appointment.patientId) throw new ForbiddenException("Only the appointment patient may create this secure conversation.");
      return;
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, status: true } });
      if (!provider || provider.status !== "ACTIVE" || provider.id !== appointment.providerId) throw new ForbiddenException("Only the appointment provider may create this secure conversation.");
      return;
    }
    throw new ForbiddenException("Secure healthcare messaging is restricted to patients and healthcare providers.");
  }

  private assertMessagingRole(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT" && principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Secure healthcare messaging is restricted to patients and healthcare providers.");
    }
  }

  private subjectEnvelope(row: EncryptedSubjectRow): EncryptedEnvelope {
    if (row.subjectAlgorithm !== "AES-256-GCM") throw new ConflictException("Unsupported conversation subject encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: row.subjectKeyId, wrappedKey: row.subjectWrappedKey, iv: row.subjectIv, ciphertext: row.subjectCiphertext };
  }

  private messageEnvelope(row: EncryptedRow): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported secure message encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: row.keyId, wrappedKey: row.wrappedKey, iv: row.iv, ciphertext: row.ciphertext };
  }

  private requiredText(value: unknown, min: number, max: number, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (text.length < min || text.length > max) throw new BadRequestException(`${field} must contain between ${min} and ${max} characters.`);
    return text;
  }

  private isUniqueConflict(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
  }
}
