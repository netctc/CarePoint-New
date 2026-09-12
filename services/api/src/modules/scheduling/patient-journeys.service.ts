import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PatientAppointmentChange } from "@prisma/client";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { assertFutureChange, DAY_MS, journeyHash, journeyId, journeyInstant, journeyWindow, TELEHEALTH_CHANGE_BUFFER_MS } from "./patient-journeys.policy";

type RescheduleInput = { slotId?: unknown; idempotencyKey?: unknown; expectedUpdatedAt?: unknown; waitlistEntryId?: unknown };
type WaitInput = { from?: unknown; to?: unknown; expectedUpdatedAt?: unknown };
const appointmentInclude = { provider: true, service: true, telehealthSession: true } as const;

@Injectable()
export class PatientJourneysService {
  constructor(private readonly prisma: PrismaService, private readonly audit: DatabaseAuditService) {}

  private async owned(db: Prisma.TransactionClient, principal: AuthPrincipal, id: string) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient self-service access is required.");
    const appointment = await db.appointment.findFirst({ where: { id, patient: { userId: principal.accountId } }, include: appointmentInclude });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    return appointment;
  }
  private async eligible(db: Prisma.TransactionClient, principal: AuthPrincipal, id: string) {
    const appointment = await this.owned(db, principal, id);
    assertFutureChange(appointment, new Date());
    if (!appointment.service.active || appointment.provider.status !== "ACTIVE") throw new ConflictException("The provider or service is not active.");
    const modality = await db.serviceModality.findUnique({ where: { serviceId_modality: { serviceId: appointment.serviceId, modality: appointment.modality } } });
    if (!modality?.active) throw new ConflictException("The service modality is no longer active.");
    if (await db.clinicalRecord.findFirst({ where: { encounterRef: id }, select: { id: true } })) throw new ConflictException("Clinical documentation already exists. Contact the provider to change this visit.");
    if (await db.insuranceClaim.findFirst({ where: { appointmentId: id }, select: { id: true } })) throw new ConflictException("An issued insurance claim requires provider-assisted rescheduling.");
    return appointment;
  }
  private async serial<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // Raw-query row-lock conflicts use P2010 rather than P2034.
          // Always retry the full transaction with a fresh database snapshot.
          const rawConflict = error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code));
          const retryable = rawConflict || error.code === "P2034" || error.code === "P2002";
          if (retryable && attempt < 2) continue;
          if (retryable || error.code === "P2004") throw new ConflictException("Concurrent scheduling change. Refresh and retry the same request.");
        }
        throw error;
      }
    }
    throw new ConflictException("Scheduling is busy. Retry the same request.");
  }
  private async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Appointment" WHERE id = ${id} FOR UPDATE`);
  }
  private async signalAudit(tx: Prisma.TransactionClient, principal: AuthPrincipal, action: string, objectType: string, objectId: string) {
    await this.audit.writeInTransaction(tx, { actorId: principal.accountId, action, objectType, objectId, purpose: "PATIENT_SCHEDULING", result: "SUCCESS", metadata: { source: "F2_SELF_SERVICE" } });
  }

  async options(principal: AuthPrincipal, rawId: string, input: { from?: string; to?: string } = {}) {
    const id = journeyId(rawId, "appointmentId");
    const appointment = await this.eligible(this.prisma, principal, id);
    const now = new Date();
    const window = journeyWindow(input.from ?? now.toISOString(), input.to ?? new Date(now.getTime() + 30 * DAY_MS).toISOString());
    const buffer = appointment.modality === "TELEMEDICINE" ? TELEHEALTH_CHANGE_BUFFER_MS : 0;
    const candidates = await this.prisma.availabilitySlot.findMany({
      where: { providerId: appointment.providerId, serviceId: appointment.serviceId, modality: appointment.modality, status: "OPEN", startsAt: { gte: window.from, lt: window.to, gt: new Date(now.getTime() + buffer) }, ...(appointment.slotId ? { id: { not: appointment.slotId } } : {}) },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 501,
      select: { id: true, startsAt: true, endsAt: true, capacity: true, bookedCount: true },
    });
    const visitContext = await this.prisma.appointmentVisitContext.findUnique({ where: { appointmentId: id } });
    return {
      appointment: { id, status: appointment.status, modality: appointment.modality, slotId: appointment.slotId, startsAt: appointment.startsAt, endsAt: appointment.endsAt, updatedAt: appointment.updatedAt, provider: { id: appointment.providerId, displayName: appointment.provider.displayName }, service: { id: appointment.serviceId, name: appointment.service.name }, visitContext },
      items: candidates.slice(0, 500).filter((s) => s.bookedCount < s.capacity).map((s) => ({ slotId: s.id, startsAt: s.startsAt, endsAt: s.endsAt, remainingCapacity: s.capacity - s.bookedCount })),
      truncated: candidates.length > 500,
      policy: { sameProvider: true, sameService: true, sameModality: true, appointmentAndInvoicePreserved: true, visitContextPreserved: true, slotsReserved: false },
    };
  }

  async history(principal: AuthPrincipal, rawId: string) {
    const id = journeyId(rawId, "appointmentId");
    await this.owned(this.prisma, principal, id);
    const rows = await this.prisma.patientAppointmentChange.findMany({ where: { appointmentId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101 });
    return { items: rows.slice(0, 100).map((r) => ({ id: r.id, fromStartsAt: r.fromStartsAt, fromEndsAt: r.fromEndsAt, toStartsAt: r.toStartsAt, toEndsAt: r.toEndsAt, createdAt: r.createdAt, fromWaitlist: r.waitlistEntryId !== null })), truncated: rows.length > 100 };
  }

  async reschedule(principal: AuthPrincipal, rawId: string, input: RescheduleInput) {
    const id = journeyId(rawId, "appointmentId"), slotId = journeyId(input.slotId, "slotId");
    const key = journeyId(input.idempotencyKey, "idempotencyKey", 8);
    const expected = journeyInstant(input.expectedUpdatedAt, "expectedUpdatedAt");
    const waitlistId = input.waitlistEntryId == null ? null : journeyId(input.waitlistEntryId, "waitlistEntryId");
    const keyHash = journeyHash([principal.accountId, key]);
    const requestHash = journeyHash([id, slotId, expected.toISOString(), waitlistId]);
    return this.serial(async (tx) => {
      const owned = await this.owned(tx, principal, id);
      await this.lock(tx, id);
      const replay = await tx.patientAppointmentChange.findUnique({ where: { keyHash } });
      if (replay) {
        if (replay.patientId !== owned.patientId || replay.requestHash !== requestHash) throw new ConflictException("The request key was already used for a different change.");
        return this.receipt(replay, true);
      }
      const current = await this.eligible(tx, principal, id);
      if (current.updatedAt.getTime() !== expected.getTime()) throw new ConflictException("Appointment changed. Refresh the visit before confirming again.");
      if (!current.slotId || current.slotId === slotId) throw new ConflictException("Choose a different slot for this appointment.");
      const destination = await tx.availabilitySlot.findUnique({ where: { id: slotId } });
      const buffer = current.modality === "TELEMEDICINE" ? TELEHEALTH_CHANGE_BUFFER_MS : 0;
      if (!destination || destination.status !== "OPEN" || destination.startsAt.getTime() <= Date.now() + buffer || destination.bookedCount >= destination.capacity) throw new ConflictException("The selected slot is no longer available.");
      if (destination.providerId !== current.providerId || destination.serviceId !== current.serviceId || destination.modality !== current.modality) throw new ConflictException("Rescheduling must preserve provider, service and modality.");
      if (await tx.availabilityException.findFirst({ where: { providerId: current.providerId, active: true, startsAt: { lt: destination.endsAt }, endsAt: { gt: destination.startsAt }, AND: [{ OR: [{ serviceId: null }, { serviceId: current.serviceId }] }, { OR: [{ modality: null }, { modality: current.modality }] }] }, select: { id: true } })) throw new ConflictException("The selected slot is covered by an availability exception.");
      if (await tx.appointment.findFirst({ where: { patientId: current.patientId, id: { not: id }, status: { in: ["REQUESTED", "CONFIRMED"] }, startsAt: { lt: destination.endsAt }, endsAt: { gt: destination.startsAt } }, select: { id: true } })) throw new ConflictException("The new time overlaps another active appointment.");
      const eligibility = await tx.insuranceEligibilityCheck.findFirst({ where: { appointmentId: id, status: "ELIGIBLE" }, orderBy: { checkedAt: "desc" }, select: { expiresAt: true } });
      const authorization = await tx.priorAuthorization.findFirst({ where: { appointmentId: id, status: "APPROVED" }, orderBy: { createdAt: "desc" }, select: { validUntil: true } });
      if (eligibility?.expiresAt && eligibility.expiresAt < destination.startsAt) throw new ConflictException("Insurance eligibility does not cover the selected time.");
      if (authorization?.validUntil && authorization.validUntil < destination.startsAt) throw new ConflictException("Prior authorization does not cover the selected time.");
      await this.verifyPhysicalContext(tx, id, current.serviceId, current.modality);
      if (waitlistId) {
        const entry = await tx.patientWaitlistEntry.findFirst({ where: { id: waitlistId, patientId: current.patientId, appointmentId: id, status: "WAITING" } });
        if (!entry || entry.toAt.getTime() <= Date.now() || destination.startsAt < entry.fromAt || destination.startsAt >= entry.toAt || destination.startsAt >= current.startsAt) throw new ConflictException("This slot does not match the active earlier-appointment request.");
        await tx.patientWaitlistEntry.update({ where: { id: entry.id }, data: { status: "FULFILLED", activeKey: null, closureReason: "EARLIER_SLOT_ACCEPTED", closedAt: new Date() } });
      }
      const reserve = await tx.availabilitySlot.updateMany({ where: { id: slotId, status: "OPEN", bookedCount: { lt: destination.capacity } }, data: { bookedCount: { increment: 1 }, version: { increment: 1 } } });
      if (reserve.count !== 1) throw new ConflictException("The new slot was taken concurrently.");
      const changed = await tx.appointment.updateMany({ where: { id, slotId: current.slotId, updatedAt: expected, status: current.status }, data: { slotId, startsAt: destination.startsAt, endsAt: destination.endsAt, updatedAt: new Date(Math.max(Date.now(), expected.getTime() + 1)) } });
      if (changed.count !== 1) throw new ConflictException("Appointment changed concurrently.");
      const released = await tx.availabilitySlot.updateMany({ where: { id: current.slotId, bookedCount: { gt: 0 } }, data: { bookedCount: { decrement: 1 }, version: { increment: 1 } } });
      if (released.count !== 1) throw new ConflictException("Original slot inventory is inconsistent. The change was rolled back.");
      if (current.telehealthSession) await tx.telehealthSession.update({ where: { appointmentId: id }, data: { status: "WAITING", patientReadyAt: null, providerReadyAt: null, patientReadiness: Prisma.DbNull, providerReadiness: Prisma.DbNull } });
      const record = await tx.patientAppointmentChange.create({ data: { appointmentId: id, patientId: current.patientId, actorId: principal.accountId, keyHash, requestHash, fromSlotId: current.slotId, toSlotId: slotId, fromStartsAt: current.startsAt, fromEndsAt: current.endsAt, toStartsAt: destination.startsAt, toEndsAt: destination.endsAt, waitlistEntryId: waitlistId } });
      await this.signalAudit(tx, principal, "PATIENT_APPOINTMENT_RESCHEDULED", "APPOINTMENT", id);
      return this.receipt(record, false);
    });
  }
  private receipt(record: PatientAppointmentChange, replayed: boolean) {
    return { appointmentId: record.appointmentId, changeId: record.id, slotId: record.toSlotId, startsAt: record.toStartsAt, endsAt: record.toEndsAt, replayed };
  }
  private async verifyPhysicalContext(tx: Prisma.TransactionClient, id: string, serviceId: string, modality: string) {
    if (modality === "TELEMEDICINE") return;
    const context = await tx.appointmentVisitContext.findUnique({ where: { appointmentId: id } });
    if (!context) {
      if (process.env.NODE_ENV === "production" || process.env.RELEASE1_TEST_STRICT_VISIT_CONTEXT === "true") throw new ConflictException("The visit context needs provider review before rescheduling.");
      return;
    }
    if (modality === "CLINIC") {
      const location = context.sourceProviderLocationId ? await tx.providerLocation.findUnique({ where: { id: context.sourceProviderLocationId } }) : null;
      const delivery = await tx.serviceDeliveryContext.findUnique({ where: { serviceId_modality: { serviceId, modality: "CLINIC" } } });
      if (!location?.active || !location.addressValidatedAt || delivery?.clinicLocationId !== context.sourceProviderLocationId) throw new ConflictException("The clinic location changed. Contact the provider.");
    } else {
      const delivery = await tx.serviceDeliveryContext.findUnique({ where: { serviceId_modality: { serviceId, modality: "HOME_VISIT" } } });
      if (delivery?.homeCoverageRadiusKm != null) {
        if (delivery.homeCoverageCenterLatitude == null || delivery.homeCoverageCenterLongitude == null) throw new ConflictException("Home-visit coverage needs provider review.");
        const r = (v: number) => v * Math.PI / 180;
        const a = Math.sin(r(Number(context.latitude) - Number(delivery.homeCoverageCenterLatitude)) / 2) ** 2 + Math.cos(r(Number(context.latitude))) * Math.cos(r(Number(delivery.homeCoverageCenterLatitude))) * Math.sin(r(Number(context.longitude) - Number(delivery.homeCoverageCenterLongitude)) / 2) ** 2;
        const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
        if (distance > Number(delivery.homeCoverageRadiusKm)) throw new ConflictException("The original home-visit address is outside current coverage.");
      }
    }
  }

  async joinWaitlist(principal: AuthPrincipal, rawId: string, input: WaitInput) {
    const id = journeyId(rawId, "appointmentId"), window = journeyWindow(input.from, input.to, 62);
    const expected = journeyInstant(input.expectedUpdatedAt, "expectedUpdatedAt");
    return this.serial(async (tx) => {
      await this.owned(tx, principal, id); await this.lock(tx, id);
      const current = await this.eligible(tx, principal, id);
      if (current.updatedAt.getTime() !== expected.getTime()) throw new ConflictException("Refresh the appointment before joining its waitlist.");
      if (window.to > current.startsAt || window.to.getTime() <= Date.now() || window.from.getTime() > Date.now() + 366 * DAY_MS) throw new BadRequestException("The requested window must end before the existing appointment and include future time.");
      await tx.patientWaitlistEntry.updateMany({ where: { appointmentId: id, status: "WAITING", toAt: { lte: new Date() } }, data: { status: "EXPIRED", activeKey: null, closureReason: "WINDOW_ENDED", closedAt: new Date() } });
      const existing = await tx.patientWaitlistEntry.findUnique({ where: { activeKey: id } });
      if (existing) {
        if (existing.fromAt.getTime() === window.from.getTime() && existing.toAt.getTime() === window.to.getTime()) return this.presentWait(existing);
        throw new ConflictException("An active request already exists. Withdraw it before changing the window.");
      }
      if (await tx.patientWaitlistEntry.count({ where: { patientId: current.patientId, status: "WAITING", toAt: { gt: new Date() } } }) >= 20) throw new ConflictException("A maximum of 20 active earlier-appointment requests is allowed.");
      const entry = await tx.patientWaitlistEntry.create({ data: { appointmentId: id, patientId: current.patientId, providerId: current.providerId, serviceId: current.serviceId, modality: current.modality, appointmentUpdatedAt: current.updatedAt, fromAt: window.from, toAt: window.to, activeKey: id } });
      await this.signalAudit(tx, principal, "PATIENT_WAITLIST_JOINED", "PATIENT_WAITLIST", entry.id);
      return this.presentWait(entry);
    });
  }
  private presentWait(entry: { id: string; appointmentId: string; fromAt: Date; toAt: Date; status: string; createdAt: Date; closedAt: Date | null }) {
    return { id: entry.id, appointmentId: entry.appointmentId, fromAt: entry.fromAt, toAt: entry.toAt, status: entry.status === "WAITING" && entry.toAt.getTime() <= Date.now() ? "EXPIRED" : entry.status, createdAt: entry.createdAt, closedAt: entry.closedAt, reservesSlot: false };
  }
  async waitlist(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient self-service access is required.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    const entries = await this.prisma.patientWaitlistEntry.findMany({ where: { patientId: patient.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101 });
    const appointments = await this.prisma.appointment.findMany({ where: { patientId: patient.id, id: { in: entries.map((e) => e.appointmentId) } }, include: { service: true, provider: true } });
    return { items: entries.slice(0, 100).map((entry) => {
      const a = appointments.find((v) => v.id === entry.appointmentId);
      return { ...this.presentWait(entry), serviceName: a?.service.name, providerName: a?.provider.displayName, modality: a?.modality, originalStartsAt: a?.startsAt };
    }), truncated: entries.length > 100 };
  }
  private async ownedEntry(tx: Prisma.TransactionClient, principal: AuthPrincipal, rawId: string) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient self-service access is required.");
    const patient = await tx.patientProfile.findUnique({ where: { userId: principal.accountId } });
    const entry = patient ? await tx.patientWaitlistEntry.findFirst({ where: { id: journeyId(rawId, "entryId"), patientId: patient.id } }) : null;
    if (!entry) throw new NotFoundException("Waitlist entry not found.");
    return entry;
  }
  async withdraw(principal: AuthPrincipal, rawId: string) {
    return this.serial(async (tx) => {
      const entry = await this.ownedEntry(tx, principal, rawId);
      if (entry.status !== "WAITING") return this.presentWait(entry);
      const updated = await tx.patientWaitlistEntry.update({ where: { id: entry.id }, data: { status: "WITHDRAWN", activeKey: null, closureReason: "PATIENT_WITHDREW", closedAt: new Date() } });
      await this.signalAudit(tx, principal, "PATIENT_WAITLIST_WITHDRAWN", "PATIENT_WAITLIST", entry.id);
      return this.presentWait(updated);
    });
  }
  async matches(principal: AuthPrincipal, rawId: string) {
    const entry = await this.ownedEntry(this.prisma, principal, rawId);
    if (entry.status !== "WAITING" || entry.toAt.getTime() <= Date.now()) throw new ConflictException("The earlier-appointment request is no longer active.");
    // A 62-day wish window is queried in two bounded 31-day pages by the same API.
    const midpoint = new Date(Math.min(entry.toAt.getTime(), entry.fromAt.getTime() + 31 * DAY_MS));
    const first = await this.options(principal, entry.appointmentId, { from: entry.fromAt.toISOString(), to: midpoint.toISOString() });
    const second = midpoint < entry.toAt ? await this.options(principal, entry.appointmentId, { from: midpoint.toISOString(), to: entry.toAt.toISOString() }) : null;
    return { ...first, items: [...first.items, ...(second?.items ?? [])], truncated: first.truncated || (second?.truncated ?? false), waitlistEntryId: entry.id, noExclusiveReservation: true };
  }
  async providerDemand(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("Provider access is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("Active provider access is required.");
    const groups = await this.prisma.patientWaitlistEntry.groupBy({ by: ["serviceId", "modality"], where: { providerId: provider.id, status: "WAITING", toAt: { gt: new Date() } }, _count: { _all: true }, _min: { fromAt: true }, _max: { toAt: true }, orderBy: [{ serviceId: "asc" }, { modality: "asc" }], take: 100 });
    const services = await this.prisma.service.findMany({ where: { providerId: provider.id, id: { in: groups.map((g) => g.serviceId) } }, select: { id: true, name: true } });
    return { items: groups.map((g) => ({ serviceId: g.serviceId, serviceName: services.find((s) => s.id === g.serviceId)?.name, modality: g.modality, waitingCount: g._count._all, earliestRequestedAt: g._min.fromAt, latestRequestedAt: g._max.toAt })), containsPatientIdentities: false };
  }

  // The public cancellation route uses the same row lock/serializable boundary
  // as rescheduling. A cancellation cannot release a stale source slot.
  async cancel(principal: AuthPrincipal, rawId: string, reason?: string) {
    const id = journeyId(rawId, "appointmentId");
    if (reason != null && (typeof reason !== "string" || reason.trim().length > 500)) throw new BadRequestException("Cancellation reason is invalid.");
    return this.serial(async (tx) => {
      const current = await tx.appointment.findUnique({ where: { id }, include: { patient: { select: { userId: true } } } });
      if (!current) throw new NotFoundException("Appointment not found.");
      if (current.patient.userId !== principal.accountId && !roleHasPermission(principal.role, "APPOINTMENT_OPERATE")) throw new ForbiddenException("Appointment access denied.");
      await this.lock(tx, id);
      if (current.status !== "REQUESTED" && current.status !== "CONFIRMED") throw new ConflictException("Only active appointments can be cancelled.");
      const changed = await tx.appointment.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason?.trim() || null } });
      if (current.slotId) {
        const release = await tx.availabilitySlot.updateMany({ where: { id: current.slotId, bookedCount: { gt: 0 } }, data: { bookedCount: { decrement: 1 }, version: { increment: 1 } } });
        if (release.count !== 1) throw new ConflictException("Slot inventory is inconsistent; cancellation was rolled back.");
      }
      await this.signalAudit(tx, principal, "APPOINTMENT_CANCELLED", "APPOINTMENT", id);
      return changed;
    });
  }
}
