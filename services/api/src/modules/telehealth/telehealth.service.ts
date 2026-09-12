import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type TelehealthSession } from "@prisma/client";
import type { TelehealthReadinessInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash, randomBytes } from "node:crypto";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { TelehealthEnvelopeService } from "./telehealth-envelope.service";
import { TelehealthProviderService } from "./telehealth-provider.service";

const CONSENT_SCOPE = "TELEMEDICINE_SESSION";
const CONSENT_VERSION = "telemedicine-v1";
const TOKEN_TTL_SECONDS = 5 * 60;
const READINESS_EARLY_MINUTES = 30;
const JOIN_EARLY_MINUTES = 15;
const JOIN_LATE_MINUTES = 60;

@Injectable()
export class TelehealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: TelehealthEnvelopeService,
    private readonly provider: TelehealthProviderService,
  ) {}

  async status(principal: AuthPrincipal, appointmentId: string) {
    const appointment = await this.requireParticipant(principal, appointmentId);
    const session = await this.ensureSession(appointment);
    return this.view(appointment, session, principal);
  }

  async confirmConsent(principal: AuthPrincipal, appointmentId: string, version: string) {
    const appointment = await this.requireParticipant(principal, appointmentId);
    if (principal.role !== "PATIENT" || appointment.patient.userId !== principal.accountId) {
      throw new ForbiddenException("Only the patient may grant telemedicine consent.");
    }
    if (version !== CONSENT_VERSION) throw new BadRequestException(`Telemedicine consent version must be '${CONSENT_VERSION}'.`);
    const session = await this.ensureSession(appointment);
    if (session.status === "ENDED" || session.status === "CANCELLED") throw new ConflictException("Telemedicine session is no longer active.");
    if (session.consentId && session.consentVersion === version) return this.view(appointment, session, principal);

    const updated = await this.prisma.$transaction(async (tx) => {
      const consent = await tx.consent.create({
        data: {
          patientId: appointment.patientId,
          providerId: appointment.providerId,
          scope: CONSENT_SCOPE,
          version,
          state: "GRANTED",
          grantedAt: new Date(),
        },
      });
      return tx.telehealthSession.update({
        where: { id: session.id },
        data: { consentId: consent.id, consentVersion: version },
      });
    });
    await this.audit.write({ actorId: principal.accountId, action: "TELEHEALTH_CONSENT_GRANTED", objectType: "TELEHEALTH_SESSION", objectId: session.id, result: "SUCCESS", metadata: { appointmentId, version } });
    return this.view(appointment, updated, principal);
  }

  async readiness(principal: AuthPrincipal, appointmentId: string, input: TelehealthReadinessInput) {
    const appointment = await this.requireParticipant(principal, appointmentId);
    this.assertReadinessWindow(appointment.startsAt, appointment.endsAt);
    const session = await this.ensureSession(appointment);
    if (session.status === "ENDED" || session.status === "CANCELLED") throw new ConflictException("Telemedicine session is no longer active.");
    const ready = input.camera === true && input.microphone === true && input.network === true;
    const diagnostics = { camera: input.camera === true, microphone: input.microphone === true, network: input.network === true, checkedAt: new Date().toISOString() };
    const isPatient = principal.role === "PATIENT";
    const updated = await this.prisma.telehealthSession.update({
      where: { id: session.id },
      data: isPatient
        ? { patientReadyAt: ready ? new Date() : null, patientReadiness: diagnostics }
        : { providerReadyAt: ready ? new Date() : null, providerReadiness: diagnostics },
    });
    const reconciled = await this.reconcileReadyState(updated);
    await this.audit.write({ actorId: principal.accountId, action: "TELEHEALTH_READINESS_UPDATED", objectType: "TELEHEALTH_SESSION", objectId: session.id, result: "SUCCESS", metadata: { ready, participant: isPatient ? "PATIENT" : "PROVIDER" } });
    return this.view(appointment, reconciled, principal);
  }

  async join(principal: AuthPrincipal, appointmentId: string) {
    const appointment = await this.requireParticipant(principal, appointmentId);
    this.assertJoinWindow(appointment.startsAt, appointment.endsAt);
    const session = await this.ensureSession(appointment);
    if (session.status === "ENDED" || session.status === "CANCELLED") throw new ConflictException("Telemedicine session is no longer active.");
    if (!session.consentId) throw new ConflictException("Patient telemedicine consent is required before joining.");
    const isPatient = principal.role === "PATIENT";
    if (isPatient && !session.patientReadyAt) throw new ConflictException("Patient readiness check is required before joining.");
    if (!isPatient && !session.providerReadyAt) throw new ConflictException("Provider readiness check is required before joining.");

    const key = await this.envelope.decryptSessionKey(this.toEnvelope(session));
    const participantIdentity = this.participantIdentity(session.id, principal.accountId);
    const issued = await this.provider.issueJoinToken({
      roomName: session.roomName,
      participantIdentity,
      participantRole: isPatient ? "PATIENT" : "PROVIDER",
      ttlSeconds: TOKEN_TTL_SECONDS,
    });
    await this.audit.write({ actorId: principal.accountId, action: "TELEHEALTH_JOIN_TOKEN_ISSUED", objectType: "TELEHEALTH_SESSION", objectId: session.id, result: "SUCCESS", metadata: { participant: isPatient ? "PATIENT" : "PROVIDER", expiresAt: issued.expiresAt.toISOString() } });
    return {
      sessionId: session.id,
      serverUrl: issued.serverUrl,
      participantToken: issued.participantToken,
      e2eeKey: key,
      expiresAt: issued.expiresAt.toISOString(),
      recordingEnabled: false as const,
    };
  }

  async end(principal: AuthPrincipal, appointmentId: string) {
    const appointment = await this.requireParticipant(principal, appointmentId);
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("Only the appointment provider may end the telemedicine session.");
    const session = await this.ensureSession(appointment);
    if (session.status === "ENDED") return this.view(appointment, session, principal);
    const updated = await this.prisma.telehealthSession.update({ where: { id: session.id }, data: { status: "ENDED", endedAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "TELEHEALTH_SESSION_ENDED", objectType: "TELEHEALTH_SESSION", objectId: session.id, result: "SUCCESS", metadata: { appointmentId } });
    return this.view(appointment, updated, principal);
  }

  async webhook(rawBody: string, authorization?: string): Promise<void> {
    const event = await this.provider.verifyWebhook(rawBody, authorization);
    if (!event.roomName) return;
    const session = await this.prisma.telehealthSession.findUnique({ where: { roomName: event.roomName } });
    if (!session) return;
    if (event.event === "participant_joined" && session.status !== "ENDED" && session.status !== "CANCELLED") {
      await this.prisma.telehealthSession.update({ where: { id: session.id }, data: { status: "ACTIVE", startedAt: session.startedAt ?? new Date() } });
    } else if (event.event === "room_finished") {
      await this.prisma.telehealthSession.update({ where: { id: session.id }, data: { status: "ENDED", endedAt: session.endedAt ?? new Date() } });
    }
    await this.audit.write({ action: "TELEHEALTH_PROVIDER_WEBHOOK", objectType: "TELEHEALTH_SESSION", objectId: session.id, result: "SUCCESS", metadata: { event: event.event, participantIdentity: event.participantIdentity } });
  }

  private async requireParticipant(principal: AuthPrincipal, appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true, provider: true, service: true },
    });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    if (appointment.modality !== "TELEMEDICINE") throw new BadRequestException("Appointment is not a telemedicine visit.");
    const ownsAsPatient = principal.role === "PATIENT" && appointment.patient.userId === principal.accountId;
    const ownsAsProvider = (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") && appointment.provider.userId === principal.accountId && appointment.provider.status === "ACTIVE";
    if (!ownsAsPatient && !ownsAsProvider) throw new ForbiddenException("Telemedicine appointment access denied.");
    if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
      const existing = await this.prisma.telehealthSession.findUnique({ where: { appointmentId: appointment.id } });
      if (existing && existing.status !== "CANCELLED") await this.prisma.telehealthSession.update({ where: { id: existing.id }, data: { status: "CANCELLED", endedAt: existing.endedAt ?? new Date() } });
      throw new ConflictException("Appointment is not active.");
    }
    if (appointment.status !== "CONFIRMED") throw new ConflictException("Appointment must be confirmed before telemedicine can start.");
    return appointment;
  }

  private async ensureSession(appointment: Awaited<ReturnType<TelehealthService["requireParticipant"]>>): Promise<TelehealthSession> {
    const existing = await this.prisma.telehealthSession.findUnique({ where: { appointmentId: appointment.id } });
    if (existing) return existing;
    const key = await this.envelope.createSessionKey();
    const roomName = `cp_${randomBytes(18).toString("hex")}`;
    try {
      return await this.prisma.telehealthSession.create({
        data: {
          appointmentId: appointment.id,
          roomName,
          e2eeVersion: key.envelope.version,
          e2eeAlgorithm: key.envelope.algorithm,
          e2eeKeyId: key.envelope.keyId,
          e2eeWrappedKey: key.envelope.wrappedKey,
          e2eeIv: key.envelope.iv,
          e2eeCiphertext: key.envelope.ciphertext,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await this.prisma.telehealthSession.findUnique({ where: { appointmentId: appointment.id } });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  private async reconcileReadyState(session: TelehealthSession): Promise<TelehealthSession> {
    if (session.status === "ACTIVE" || session.status === "ENDED" || session.status === "CANCELLED") return session;
    const next = session.patientReadyAt && session.providerReadyAt && session.consentId ? "READY" : "WAITING";
    if (session.status === next) return session;
    return this.prisma.telehealthSession.update({ where: { id: session.id }, data: { status: next } });
  }

  private view(appointment: Awaited<ReturnType<TelehealthService["requireParticipant"]>>, session: TelehealthSession, principal: AuthPrincipal) {
    const now = Date.now();
    const joinOpensAt = new Date(appointment.startsAt.getTime() - JOIN_EARLY_MINUTES * 60_000);
    const joinClosesAt = new Date(appointment.endsAt.getTime() + JOIN_LATE_MINUTES * 60_000);
    const participantReady = principal.role === "PATIENT" ? Boolean(session.patientReadyAt) : Boolean(session.providerReadyAt);
    return {
      id: session.id,
      appointmentId: appointment.id,
      status: session.status,
      consentVersion: session.consentVersion,
      consentGranted: Boolean(session.consentId),
      patientReady: Boolean(session.patientReadyAt),
      providerReady: Boolean(session.providerReadyAt),
      participantReady,
      recordingEnabled: false,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      joinOpensAt: joinOpensAt.toISOString(),
      joinClosesAt: joinClosesAt.toISOString(),
      canJoin: now >= joinOpensAt.getTime() && now <= joinClosesAt.getTime() && Boolean(session.consentId) && participantReady && session.status !== "ENDED" && session.status !== "CANCELLED",
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
    };
  }

  private assertReadinessWindow(startsAt: Date, endsAt: Date): void {
    const now = Date.now();
    const opens = startsAt.getTime() - READINESS_EARLY_MINUTES * 60_000;
    const closes = endsAt.getTime() + JOIN_LATE_MINUTES * 60_000;
    if (now < opens || now > closes) throw new ConflictException("Readiness checks are outside the allowed telemedicine window.");
  }

  private assertJoinWindow(startsAt: Date, endsAt: Date): void {
    const now = Date.now();
    const opens = startsAt.getTime() - JOIN_EARLY_MINUTES * 60_000;
    const closes = endsAt.getTime() + JOIN_LATE_MINUTES * 60_000;
    if (now < opens) throw new ConflictException("Telemedicine room is not open yet.");
    if (now > closes) throw new ConflictException("Telemedicine room join window has closed.");
  }

  private participantIdentity(sessionId: string, accountId: string): string {
    return `cp_${createHash("sha256").update(`${sessionId}:${accountId}`).digest("hex").slice(0, 24)}`;
  }

  private toEnvelope(session: TelehealthSession): EncryptedEnvelope {
    if (session.e2eeVersion !== 1 || session.e2eeAlgorithm !== "AES-256-GCM") {
      throw new InternalServerErrorException("Stored telehealth encryption envelope uses an unsupported format.");
    }
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: session.e2eeKeyId,
      wrappedKey: session.e2eeWrappedKey,
      iv: session.e2eeIv,
      ciphertext: session.e2eeCiphertext,
    };
  }
}
