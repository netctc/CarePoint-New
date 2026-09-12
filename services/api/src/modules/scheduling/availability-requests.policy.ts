import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma, type AvailabilitySlot } from "@prisma/client";
import { DAY_MS, journeyHash, journeyId, journeyWindow } from "./patient-journeys.policy";
import type { Release1BookingInput } from "./release1-scheduling-context.types";

export const AVAILABILITY_CONSENT_VERSION = "IN_APP_AVAILABILITY_V1";
export function availabilityInput(input: unknown, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("An availability request object is required.");
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["serviceId", "modality", "from", "to", "inAppNotices"].includes(key))) throw new BadRequestException("Unsupported availability request field.");
  if (body.inAppNotices !== true) throw new BadRequestException("Explicit in-app notice opt-in is required.");
  if (typeof body.modality !== "string" || !["CLINIC", "TELEMEDICINE", "HOME_VISIT"].includes(body.modality)) throw new BadRequestException("Invalid modality.");
  const window = journeyWindow(body.from, body.to, 62);
  if (window.to <= now || window.from.getTime() < now.getTime() - DAY_MS || window.to.getTime() > now.getTime() + 366 * DAY_MS) throw new BadRequestException("Choose a future interval within the next year.");
  return { serviceId: journeyId(body.serviceId, "serviceId"), modality: body.modality as "CLINIC" | "TELEMEDICINE" | "HOME_VISIT", ...window };
}
export function availabilityPage(raw: unknown = "1") {
  if (typeof raw !== "string" || !/^[1-9]\d{0,3}$/.test(raw) || Number(raw) > 1000) throw new BadRequestException("Invalid page.");
  return Number(raw);
}
export function availabilityBookingHash(input: Release1BookingInput) {
  const home = input.homeVisit;
  // Fixed field ordering; address/contact content is not stored in the receipt.
  return journeyHash([journeyId(input.slotId), journeyId(input.availabilityRequestId), home == null ? null : [home.addressLine1, home.addressLine2, home.city, home.region, home.postalCode, home.countryCode, home.latitude, home.longitude, home.instructions, home.contactPhone, home.contactConfirmed, home.addressValidated]]);
}
export async function assertAvailabilityReplay(db: Prisma.TransactionClient, patientId: string, appointmentId: string, input: Release1BookingInput) {
  if (input.availabilityRequestId == null) return;
  const id = journeyId(input.availabilityRequestId, "availabilityRequestId");
  const entry = await db.patientAvailabilityRequest.findFirst({ where: { id, patientId } });
  if (!entry) throw new NotFoundException("Availability request not found.");
  if (entry.bookedAppointmentId !== appointmentId || entry.acceptedKeyHash !== journeyHash([patientId, input.idempotencyKey.trim()]) || entry.acceptedRequestHash !== availabilityBookingHash(input)) throw new ConflictException("The booking key was used for a different availability request or payload.");
}
export async function prepareAvailabilityBooking(tx: Prisma.TransactionClient, patientId: string, input: Release1BookingInput, slot: AvailabilitySlot) {
  if (input.availabilityRequestId == null) return;
  const id = journeyId(input.availabilityRequestId, "availabilityRequestId");
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientAvailabilityRequest" WHERE id = ${id} AND "patientId" = ${patientId} FOR UPDATE`);
  const entry = await tx.patientAvailabilityRequest.findFirst({ where: { id, patientId } });
  if (!entry) throw new NotFoundException("Availability request not found.");
  if (entry.status !== "WAITING" || entry.toAt.getTime() <= Date.now()) throw new ConflictException("Availability request is closed or expired.");
  if (entry.serviceId !== slot.serviceId || entry.providerId !== slot.providerId || entry.modality !== slot.modality || slot.startsAt < entry.fromAt || slot.startsAt >= entry.toAt) throw new ConflictException("Slot does not match the requested service and interval.");
  await tx.patientAvailabilityRequest.update({ where: { id }, data: { acceptedKeyHash: journeyHash([patientId, input.idempotencyKey.trim()]), acceptedRequestHash: availabilityBookingHash(input) } });
}
export function availabilityRetryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002" || (error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code))));
}
