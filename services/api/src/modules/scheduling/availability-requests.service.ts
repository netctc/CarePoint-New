import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PatientAvailabilityRequest, type PatientAvailabilityNotice } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { journeyHash, journeyId } from "./patient-journeys.policy";
import { AVAILABILITY_CONSENT_VERSION, availabilityInput, availabilityPage, availabilityRetryable } from "./availability-requests.policy";

type OpenSlot = { id: string; startsAt: Date; endsAt: Date; capacity: number; bookedCount: number };
@Injectable()
export class AvailabilityRequestsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: DatabaseAuditService) {}
  private async patient(db: Prisma.TransactionClient, principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient access is required.");
    const patient = await db.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }
  private async serial<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (!availabilityRetryable(error)) throw error;
        if (attempt === 2) throw new ConflictException("Concurrent availability change. Refresh and retry.");
      }
    }
    throw new ConflictException("Availability is busy.");
  }
  private async owned(db: Prisma.TransactionClient, principal: AuthPrincipal, rawId: string, lock = false) {
    const patient = await this.patient(db, principal), id = journeyId(rawId, "requestId");
    if (lock) await db.$queryRaw(Prisma.sql`SELECT id FROM "PatientAvailabilityRequest" WHERE id = ${id} AND "patientId" = ${patient.id} FOR UPDATE`);
    const entry = await db.patientAvailabilityRequest.findFirst({ where: { id, patientId: patient.id } });
    if (!entry) throw new NotFoundException("Availability request not found.");
    return entry;
  }
  private active(entry: PatientAvailabilityRequest) {
    if (entry.status !== "WAITING" || entry.toAt.getTime() <= Date.now()) throw new ConflictException("Availability request is closed or expired.");
  }
  private present(entry: PatientAvailabilityRequest, notice?: PatientAvailabilityNotice | null) {
    const status = entry.status === "WAITING" && entry.toAt.getTime() <= Date.now() ? "EXPIRED" : entry.status;
    return {
      id: entry.id, serviceId: entry.serviceId, modality: entry.modality, fromAt: entry.fromAt, toAt: entry.toAt,
      status, createdAt: entry.createdAt, closedAt: entry.closedAt, bookedAppointmentId: entry.bookedAppointmentId,
      reservesSlot: false, noticeConsentVersion: entry.noticeConsentVersion,
      notice: notice ? { id: notice.id, version: notice.version, active: notice.active && status === "WAITING", matchCount: notice.matchCount, firstAvailableAt: notice.firstAvailableAt, checkedAt: notice.checkedAt, readAt: notice.readAt, truncated: notice.truncated, requiresAvailabilityRecheck: true } : null,
    };
  }
  private async writeAudit(tx: Prisma.TransactionClient, principal: AuthPrincipal, action: string, id: string) {
    await this.audit.writeInTransaction(tx, { actorId: principal.accountId, action, objectType: "AVAILABILITY_REQUEST", objectId: id, purpose: "PATIENT_SCHEDULING", result: "SUCCESS", metadata: { source: "F3_IN_APP", consentVersion: AVAILABILITY_CONSENT_VERSION } });
  }
  async join(principal: AuthPrincipal, input: unknown) {
    // Reject other roles before parsing or querying any patient state.
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient access is required.");
    const parsed = availabilityInput(input);
    return this.serial(async (tx) => {
      const patient = await this.patient(tx, principal);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientProfile" WHERE id = ${patient.id} FOR UPDATE`);
      const service = await tx.service.findUnique({ where: { id: parsed.serviceId }, include: { provider: true, modalities: true } });
      if (!service || !service.active || service.provider.status !== "ACTIVE" || !service.modalities.some((m) => m.modality === parsed.modality && m.active)) throw new ConflictException("Service is not available for this modality.");
      await tx.patientAvailabilityRequest.updateMany({ where: { patientId: patient.id, status: "WAITING", toAt: { lte: new Date() } }, data: { status: "EXPIRED", activeKey: null, closedAt: new Date() } });
      const activeKey = journeyHash([patient.id, service.id, parsed.modality]);
      const existing = await tx.patientAvailabilityRequest.findUnique({ where: { activeKey } });
      if (existing) {
        if (existing.fromAt.getTime() !== parsed.from.getTime() || existing.toAt.getTime() !== parsed.to.getTime()) throw new ConflictException("Withdraw the existing request before choosing a different interval.");
        return this.present(existing);
      }
      const alreadyBooked = await tx.appointment.findFirst({ where: { patientId: patient.id, serviceId: service.id, modality: parsed.modality, status: { in: ["REQUESTED", "CONFIRMED"] }, startsAt: { gte: parsed.from, lt: parsed.to, gt: new Date() } }, select: { id: true } });
      if (alreadyBooked) throw new ConflictException("A matching appointment already exists. Manage it from My Visits.");
      if (await tx.patientAvailabilityRequest.count({ where: { patientId: patient.id, status: "WAITING" } }) >= 20) throw new ConflictException("A maximum of 20 active availability requests is allowed.");
      const entry = await tx.patientAvailabilityRequest.create({ data: { patientId: patient.id, providerId: service.providerId, serviceId: service.id, modality: parsed.modality, fromAt: parsed.from, toAt: parsed.to, activeKey, noticeConsentVersion: AVAILABILITY_CONSENT_VERSION } });
      await this.writeAudit(tx, principal, "AVAILABILITY_REQUEST_CREATED", entry.id);
      return this.present(entry);
    });
  }
  async list(principal: AuthPrincipal, rawPage?: string, view = "requests") {
    const patient = await this.patient(this.prisma, principal), page = availabilityPage(rawPage);
    if (!["requests", "notices"].includes(view)) throw new BadRequestException("Invalid availability view.");
    const entries = await this.prisma.patientAvailabilityRequest.findMany({
      where: { patientId: patient.id, ...(view === "notices" ? { status: "WAITING", toAt: { gt: new Date() }, notice: { is: { active: true } } } : {}) },
      include: { notice: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 51,
    });
    const services = await this.prisma.service.findMany({ where: { id: { in: entries.map((e) => e.serviceId) } }, select: { id: true, name: true, provider: { select: { displayName: true } } } });
    return { items: entries.slice(0, 50).map((e) => {
      const service = services.find((s) => s.id === e.serviceId);
      return { ...this.present(e, e.notice), serviceName: service?.name, providerName: service?.provider.displayName };
    }), nextPage: entries.length > 50 && page < 1000 ? page + 1 : null, refreshMode: "ON_DEMAND", reservesSlot: false };
  }
  async withdraw(principal: AuthPrincipal, rawId: string) {
    return this.serial(async (tx) => {
      const entry = await this.owned(tx, principal, rawId, true);
      if (entry.status !== "WAITING") return this.present(entry);
      const changed = await tx.patientAvailabilityRequest.update({ where: { id: entry.id }, data: { status: entry.toAt.getTime() <= Date.now() ? "EXPIRED" : "WITHDRAWN", activeKey: null, closedAt: new Date() } });
      await this.writeAudit(tx, principal, "AVAILABILITY_REQUEST_WITHDRAWN", entry.id);
      return this.present(changed);
    });
  }
  private async matching(db: Prisma.TransactionClient, entry: PatientAvailabilityRequest) {
    this.active(entry);
    const service = await db.service.findUnique({ where: { id: entry.serviceId }, include: { provider: true, modalities: true } });
    if (!service || !service.active || service.provider.status !== "ACTIVE" || !service.modalities.some((m) => m.modality === entry.modality && m.active)) return { items: [] as OpenSlot[], service: null, truncated: false };
    const now = new Date();
    const rows = await db.$queryRaw<OpenSlot[]>(Prisma.sql`
      SELECT s.id, s."startsAt", s."endsAt", s.capacity, s."bookedCount" FROM "AvailabilitySlot" s
      WHERE s."serviceId" = ${entry.serviceId} AND s."providerId" = ${entry.providerId}
        AND s.modality::text = ${entry.modality} AND s.status = 'OPEN' AND s."bookedCount" < s.capacity
        AND s."startsAt" >= ${entry.fromAt} AND s."startsAt" < ${entry.toAt} AND s."startsAt" > ${now}
        AND NOT EXISTS (SELECT 1 FROM "AvailabilityException" e WHERE e."providerId" = s."providerId" AND e.active
          AND (e."serviceId" IS NULL OR e."serviceId" = s."serviceId") AND (e.modality IS NULL OR e.modality = s.modality)
          AND e."startsAt" < s."endsAt" AND e."endsAt" > s."startsAt")
        AND NOT EXISTS (SELECT 1 FROM "Appointment" a WHERE a."patientId" = ${entry.patientId}
          AND a.status IN ('REQUESTED','CONFIRMED') AND a."startsAt" < s."endsAt" AND a."endsAt" > s."startsAt")
      ORDER BY s."startsAt", s.id LIMIT 101`);
    const delivery = await db.serviceDeliveryContext.findUnique({ where: { serviceId_modality: { serviceId: service.id, modality: entry.modality } } });
    const location = delivery?.clinicLocationId ? await db.providerLocation.findUnique({ where: { id: delivery.clinicLocationId } }) : null;
    if (entry.modality === "CLINIC" && (!location?.active || !location.addressValidatedAt || location.providerId !== entry.providerId)) return { items: [] as OpenSlot[], service: null, truncated: false };
    const locationView = location ? { id: location.id, addressLine1: location.addressLine1, addressLine2: location.addressLine2, city: location.city, region: location.region, postalCode: location.postalCode, countryCode: location.countryCode, latitude: Number(location.latitude), longitude: Number(location.longitude) } : null;
    return {
      items: rows.slice(0, 100), truncated: rows.length > 100,
      service: { id: service.id, name: service.name, labels: service.labels, currency: service.currency, provider: { id: service.provider.id, displayName: service.provider.displayName }, modalities: service.modalities.filter((m) => m.active).map((m) => ({ modality: m.modality, durationMinutes: m.durationMinutes, priceMinor: m.priceMinor })), deliveryContexts: locationView ? [{ modality: "CLINIC", clinic: { location: locationView, arrivalInstructions: delivery?.clinicArrivalInstructions || location?.arrivalInstructions } }] : [] },
    };
  }
  async matches(principal: AuthPrincipal, rawId: string) {
    return this.serial(async (tx) => {
      const entry = await this.owned(tx, principal, rawId);
      return { ...(await this.matching(tx, entry)), requestId: entry.id, reservesSlot: false, checkedAt: new Date() };
    });
  }
  async refresh(principal: AuthPrincipal, rawId: string) {
    return this.serial(async (tx) => {
      const entry = await this.owned(tx, principal, rawId, true);
      const matches = await this.matching(tx, entry), checkedAt = new Date();
      const matchHash = journeyHash(matches.items.map((s) => [s.id, s.startsAt.toISOString(), s.endsAt.toISOString()]));
      const previous = await tx.patientAvailabilityNotice.findUnique({ where: { requestId: entry.id } });
      const active = matches.items.length > 0;
      const same = previous?.matchHash === matchHash && previous.active === active;
      const observation = { active, matchHash, matchCount: matches.items.length, firstAvailableAt: matches.items[0]?.startsAt ?? null, truncated: matches.truncated, checkedAt };
      const notice = await tx.patientAvailabilityNotice.upsert({ where: { requestId: entry.id },
        create: { requestId: entry.id, patientId: entry.patientId, ...observation },
        update: { ...observation, version: previous ? previous.version + (same ? 0 : 1) : 1, readAt: same ? previous?.readAt ?? null : null },
      });
      return this.present(entry, notice);
    });
  }
  async read(principal: AuthPrincipal, rawId: string, version: unknown) {
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw new BadRequestException("Notice version is required.");
    return this.serial(async (tx) => {
      const entry = await this.owned(tx, principal, rawId, true); this.active(entry);
      const notice = await tx.patientAvailabilityNotice.findUnique({ where: { requestId: entry.id } });
      if (!notice || !notice.active || notice.version !== version) throw new ConflictException("The notice changed. Refresh before marking it as read.");
      const changed = notice.readAt ? notice : await tx.patientAvailabilityNotice.update({ where: { id: notice.id }, data: { readAt: new Date() } });
      return this.present(entry, changed);
    });
  }
}
