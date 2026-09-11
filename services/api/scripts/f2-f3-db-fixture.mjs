import assert from 'node:assert/strict';
import { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
const require = createRequire(import.meta.url);
const { DatabaseAuditService } = require('../dist/infrastructure/audit/audit.service.js');
const { SiemAuditOutboxStoreService } = require('../dist/infrastructure/siem/siem-audit-outbox-store.service.js');
const { PatientJourneysService } = require('../dist/modules/scheduling/patient-journeys.service.js');
const { AvailabilityRequestsService } = require('../dist/modules/scheduling/availability-requests.service.js');
const { Release1ContextualBookingService } = require('../dist/modules/scheduling/release1-contextual-booking.service.js');

// Synthetic, non-production fixtures only. This suite never truncates tables,
// removes history, disables triggers, contacts a gateway, or clears audit data.
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.CAREPOINT_JOURNEYS_DB_ACCEPTANCE, 'true');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.equal(url.pathname, '/carepoint_f3_test');
export const db = new PrismaClient();
after(async () => { await db.$disconnect(); });
export const audit = new DatabaseAuditService(db, new SiemAuditOutboxStoreService(db), { wake() {} });
export const journeys = new PatientJourneysService(db, audit);
export const requests = new AvailabilityRequestsService(db, audit);
export const booking = new Release1ContextualBookingService(db, audit, {});
export const conflict = (error) => error?.getStatus?.() === 409;
export const notFound = (error) => error?.getStatus?.() === 404;
export const key = () => `synthetic-${randomUUID()}`;
const day = 86400000;
export async function patient() {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC_FIXTURE', role: 'PATIENT', patientProfile: { create: { firstName: 'Synthetic', lastName: 'Acceptance' } } }, include: { patientProfile: true } });
  return { actor: { accountId: user.id, role: 'PATIENT' }, patientId: user.patientProfile.id };
}
export async function fixture() {
  const p = await patient();
  const provider = await db.provider.create({ data: { class: 'DOCTOR', displayName: 'Synthetic acceptance provider', status: 'ACTIVE' } });
  const service = await db.service.create({ data: { providerId: provider.id, name: 'Synthetic acceptance service', currency: 'SAR', modalities: { create: [{ modality: 'CLINIC', durationMinutes: 30, priceMinor: 5000 }, { modality: 'HOME_VISIT', durationMinutes: 30, priceMinor: 6000 }] } } });
  const location = await db.providerLocation.create({ data: { providerId: provider.id, label: 'Synthetic clinic', addressLine1: '100 Test Street', city: 'Test City', countryCode: 'SA', latitude: 24.7, longitude: 46.7, addressValidatedAt: new Date(), arrivalInstructions: 'Synthetic reception' } });
  await db.serviceDeliveryContext.create({ data: { serviceId: service.id, modality: 'CLINIC', clinicLocationId: location.id, clinicArrivalInstructions: 'Synthetic reception' } });
  const start = new Date(); start.setUTCMinutes(0, 0, 0);
  const slot = async (offset, extra = {}) => db.availabilitySlot.create({ data: { providerId: provider.id, serviceId: service.id, modality: 'CLINIC', startsAt: new Date(start.getTime() + offset * day), endsAt: new Date(start.getTime() + offset * day + 1800000), ...extra } });
  const origin = await slot(8), early = await slot(2), later = await slot(12);
  const input = { serviceId: service.id, modality: 'CLINIC', from: new Date(start.getTime() + day).toISOString(), to: new Date(start.getTime() + 15 * day).toISOString(), inAppNotices: true };
  return { ...p, provider, service, location, origin, early, later, input, slot };
}
export async function booked(f, slot = f.origin, who = f.actor) {
  return booking.book(who, { slotId: slot.id, idempotencyKey: key() });
}
export function change(appointment, destination) {
  return { slotId: destination.id, idempotencyKey: key(), expectedUpdatedAt: new Date(appointment.updatedAt).toISOString() };
}
export async function financial(appointmentId) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { appointmentId } });
  return {
    pricing: await db.pricingSnapshot.findUniqueOrThrow({ where: { appointmentId } }), invoice,
    payments: await db.paymentIntent.findMany({ where: { invoiceId: invoice.id }, orderBy: { id: 'asc' } }),
    receipts: await db.paymentReceipt.findMany({ where: { invoiceId: invoice.id }, orderBy: { id: 'asc' } }),
    refunds: await db.paymentRefund.findMany({ where: { invoiceId: invoice.id }, orderBy: { id: 'asc' } }),
    ledger: await db.providerLedgerEntry.findMany({ where: { invoiceId: invoice.id }, orderBy: { id: 'asc' } }),
    visit: await db.appointmentVisitContext.findUnique({ where: { appointmentId } }),
  };
}
export async function seedPartialPayment(appointmentId) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { appointmentId } });
  const payment = await db.paymentIntent.create({ data: { invoiceId: invoice.id, patientId: invoice.patientId, providerId: invoice.providerId, currency: invoice.currency, amountMinor: 2500, gateway: 'SYNTHETIC_OFFLINE', idempotencyKey: key(), status: 'SUCCEEDED', succeededAt: new Date() } });
  await db.invoice.update({ where: { id: invoice.id }, data: { amountPaidMinor: 2500, balanceDueMinor: invoice.totalMinor - 2500, status: 'PARTIALLY_PAID' } });
  await db.paymentReceipt.create({ data: { number: key(), invoiceId: invoice.id, paymentIntentId: payment.id, patientId: invoice.patientId, providerId: invoice.providerId, amountMinor: 2500, currency: invoice.currency } });
  await db.providerLedgerEntry.create({ data: { providerId: invoice.providerId, invoiceId: invoice.id, paymentIntentId: payment.id, type: 'CHARGE', amountMinor: 2500, currency: invoice.currency, reference: key() } });
}
export async function state(f) {
  const where = { patientId: f.patientId }, orderBy = { id: 'asc' };
  return {
    slots: await db.availabilitySlot.findMany({ where: { serviceId: f.service.id }, orderBy }),
    appointments: await db.appointment.findMany({ where, orderBy }),
    requests: await db.patientAvailabilityRequest.findMany({ where, orderBy }),
    notices: await db.patientAvailabilityNotice.findMany({ where, orderBy }),
    changes: await db.patientAppointmentChange.findMany({ where, orderBy }),
    waitlist: await db.patientWaitlistEntry.findMany({ where, orderBy }),
    pricing: await db.pricingSnapshot.findMany({ where, orderBy }),
    invoices: await db.invoice.findMany({ where, orderBy }),
    audits: await db.auditEvent.findMany({ where: { actorId: f.actor.accountId }, orderBy }),
    deliveries: await db.siemAuditDelivery.findMany({ where: { auditEvent: { actorId: f.actor.accountId } }, orderBy }),
  };
}
export function failingJourneys() {
  return new PatientJourneysService(db, { async writeInTransaction(tx, input) { await audit.writeInTransaction(tx, input); throw new Error('SYNTHETIC_ROLLBACK_AFTER_AUDIT'); } });
}
export function failingBooking() {
  return new Release1ContextualBookingService(db, { async writeInTransaction(tx, input) { await audit.writeInTransaction(tx, input); throw new Error('SYNTHETIC_ROLLBACK_AFTER_AUDIT'); }, write: (input) => audit.write(input) }, {});
}
