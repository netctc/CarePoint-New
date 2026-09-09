import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const { appointmentNotificationConfiguration } = require("../dist/modules/communications/appointment-notification-orchestrator.service.js");

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const doctorPassword = process.env.SLICE6_DOCTOR_PASSWORD || "CarePoint-Doctor#2026";
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD || "CarePoint-Patient#2026";
const prisma = new PrismaClient();

async function raw(path, { method = "GET", token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function request(path, options = {}) {
  const result = await raw(path, options);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${options.method || "GET"} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function login(email, password) {
  const result = await request("/iam/login", { method: "POST", body: { email, password } });
  if (!result.accessToken) throw new Error(`No access token for ${email}`);
  return result.accessToken;
}

async function ensurePatient(email, password) {
  const created = await raw("/iam/register/patient", {
    method: "POST",
    body: { email, password, firstName: "Release1", lastName: "Reminder" },
  });
  if (created.status !== 201 && created.status !== 409) {
    throw new Error(`Unable to prepare reminder patient: HTTP ${created.status} ${JSON.stringify(created.payload)}`);
  }
}

async function ensureDoctorAccount(adminToken, email, password) {
  const created = await raw("/iam/accounts", {
    method: "POST",
    token: adminToken,
    body: { email, password, role: "DOCTOR" },
  });
  if (created.status !== 201 && created.status !== 409) {
    throw new Error(`Unable to prepare reminder doctor: HTTP ${created.status} ${JSON.stringify(created.payload)}`);
  }
}

async function waitFor(label, probe, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function settledNotification(accountId, appointmentId, bodyKey) {
  return waitFor(`${bodyKey} for ${accountId}`, async () => {
    const event = await prisma.notificationEvent.findFirst({
      where: { accountId, entityType: "APPOINTMENT", entityId: appointmentId, safeBodyKey: bodyKey },
      include: { deliveries: { orderBy: { channel: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    if (!event || event.deliveries.length !== 4 || event.deliveries.some((item) => item.status === "PENDING")) return null;
    return event;
  });
}

function assertPatientDelivery(event, label) {
  const inApp = event.deliveries.find((item) => item.channel === "IN_APP");
  assert.equal(inApp?.status, "SENT", `${label}: patient in-app delivery was not sent.`);
  for (const channel of ["PUSH", "EMAIL", "SMS"]) {
    assert.equal(event.deliveries.find((item) => item.channel === channel)?.status, "SKIPPED", `${label}: disabled ${channel} delivery was not skipped.`);
  }
}

function assertOptedOutDelivery(event, label) {
  assert(event.deliveries.every((item) => item.status === "SKIPPED"), `${label}: opted-out recipient received an enabled delivery.`);
}

try {
  const parsed = appointmentNotificationConfiguration({
    NODE_ENV: "test",
    APPOINTMENT_NOTIFICATION_WORKER_ENABLED: "true",
    APPOINTMENT_NOTIFICATION_POLL_MS: "250",
    APPOINTMENT_NOTIFICATION_BATCH_SIZE: "25",
    APPOINTMENT_REMINDER_OFFSETS_MINUTES: "15,60,60",
  });
  assert.deepEqual(parsed.reminderOffsetsMinutes, [60, 15], "Reminder timing policy was not normalized/deduplicated.");
  assert.throws(
    () => appointmentNotificationConfiguration({ NODE_ENV: "production", APPOINTMENT_NOTIFICATION_WORKER_ENABLED: "true" }),
    /APPOINTMENT_REMINDER_OFFSETS_MINUTES/,
    "Production accepted an undefined reminder timing policy.",
  );
  assert.throws(
    () => appointmentNotificationConfiguration({ NODE_ENV: "production", APPOINTMENT_NOTIFICATION_WORKER_ENABLED: "false", APPOINTMENT_REMINDER_OFFSETS_MINUTES: "60" }),
    /forbidden in production/,
    "Production accepted a disabled appointment notification worker.",
  );

  const adminToken = await login(adminEmail, adminPassword);
  const doctorEmail = "doctor-release1-reminders@carepoint.test";
  const patientEmail = "patient-release1-reminders@carepoint.test";
  await ensureDoctorAccount(adminToken, doctorEmail, doctorPassword);
  await ensurePatient(patientEmail, patientPassword);
  const doctorToken = await login(doctorEmail, doctorPassword);
  const patientToken = await login(patientEmail, patientPassword);

  const doctorUser = await prisma.user.findUnique({ where: { email: doctorEmail } });
  const patientUser = await prisma.user.findUnique({ where: { email: patientEmail }, include: { patientProfile: true } });
  if (!doctorUser || !patientUser?.patientProfile) throw new Error("Reminder acceptance identities are incomplete.");
  const provider = await prisma.provider.upsert({
    where: { userId: doctorUser.id },
    create: { userId: doctorUser.id, class: "DOCTOR", displayName: "Release 1 Reminder Doctor", status: "ACTIVE" },
    update: { class: "DOCTOR", displayName: "Release 1 Reminder Doctor", status: "ACTIVE" },
  });
  const service = await prisma.service.create({
    data: {
      providerId: provider.id,
      name: "Release 1 reminder acceptance service",
      labels: { en: "Reminder acceptance", ar: "اختبار التذكير", fr: "Test de rappel", es: "Prueba de recordatorio" },
      currency: "USD",
      modalities: { create: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 1000 }] },
    },
  });

  await request("/notifications/preferences", {
    method: "PATCH",
    token: patientToken,
    body: { locale: "ar", inAppEnabled: true, pushEnabled: false, emailEnabled: false, smsEnabled: false },
  });
  await request("/notifications/preferences", {
    method: "PATCH",
    token: doctorToken,
    body: { locale: "en", inAppEnabled: false, pushEnabled: false, emailEnabled: false, smsEnabled: false },
  });

  const now = Date.now();
  const slotStart = new Date(now + 4 * 60 * 60 * 1000);
  const rescheduleStart = new Date(now + 5 * 60 * 60 * 1000);
  const dueReminderStart = new Date(now + 30 * 60 * 1000);
  const [slot, rescheduleSlot] = await Promise.all([
    prisma.availabilitySlot.create({
      data: { providerId: provider.id, serviceId: service.id, modality: "CLINIC", startsAt: slotStart, endsAt: new Date(slotStart.getTime() + 30 * 60_000), capacity: 1 },
    }),
    prisma.availabilitySlot.create({
      data: { providerId: provider.id, serviceId: service.id, modality: "CLINIC", startsAt: rescheduleStart, endsAt: new Date(rescheduleStart.getTime() + 30 * 60_000), capacity: 1 },
    }),
  ]);

  const bookingInput = { slotId: slot.id, idempotencyKey: "release1-reminder-booking-0001" };
  const booking = await request("/bookings", { method: "POST", token: patientToken, body: bookingInput });
  assert.equal(booking.status, "CONFIRMED", "Release 1 reminder booking was not confirmed.");

  const patientConfirmed = await settledNotification(patientUser.id, booking.id, "notification.appointment.confirmed.body");
  const doctorConfirmed = await settledNotification(doctorUser.id, booking.id, "notification.appointment.confirmed.body");
  assertPatientDelivery(patientConfirmed, "booking confirmation");
  assertOptedOutDelivery(doctorConfirmed, "booking confirmation");

  const repeat = await request("/bookings", { method: "POST", token: patientToken, body: bookingInput });
  assert.equal(repeat.id, booking.id, "Idempotent booking retry returned a different appointment.");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const patientConfirmationCount = await prisma.notificationEvent.count({
    where: { accountId: patientUser.id, entityId: booking.id, safeBodyKey: "notification.appointment.confirmed.body" },
  });
  assert.equal(patientConfirmationCount, 1, "Idempotent booking retry produced a duplicate confirmation notification.");

  const beforeReschedule = await prisma.appointment.findUnique({ where: { id: booking.id } });
  if (!beforeReschedule) throw new Error("Booked appointment disappeared before reschedule acceptance.");
  const oldSchedule = await prisma.appointmentReminderSchedule.create({
    data: {
      appointmentId: booking.id,
      startsAt: beforeReschedule.startsAt,
      appointmentUpdatedAt: beforeReschedule.updatedAt,
      offsetMinutes: 60,
      dueAt: new Date(beforeReschedule.startsAt.getTime() - 60 * 60_000),
    },
  });
  const staleEvent = await prisma.notificationEvent.create({
    data: {
      accountId: patientUser.id,
      dedupeKey: `${patientUser.id}:appointment-reminder:${booking.id}:60:${beforeReschedule.updatedAt.getTime()}`,
      type: "APPOINTMENT_UPDATE",
      entityType: "APPOINTMENT",
      entityId: booking.id,
      safeTitleKey: "notification.appointment.reminder.title",
      safeBodyKey: "notification.appointment.reminder.body",
      deliveries: {
        create: [
          { channel: "IN_APP", availableAt: new Date(Date.now() + 60 * 60_000) },
          { channel: "PUSH", availableAt: new Date(Date.now() + 60 * 60_000) },
          { channel: "EMAIL", availableAt: new Date(Date.now() + 60 * 60_000) },
          { channel: "SMS", availableAt: new Date(Date.now() + 60 * 60_000) },
        ],
      },
    },
  });

  const rescheduled = await request(`/admin/operations/appointments/${booking.id}/reschedule`, {
    method: "POST",
    token: adminToken,
    body: { slotId: rescheduleSlot.id },
  });
  assert.equal(rescheduled.appointmentId, booking.id, "Administrative reschedule returned the wrong appointment.");
  await settledNotification(patientUser.id, booking.id, "notification.appointment.rescheduled.body");
  await waitFor("old reminder schedule cancellation", async () => {
    const row = await prisma.appointmentReminderSchedule.findUnique({ where: { id: oldSchedule.id } });
    return row?.status === "CANCELLED" ? row : null;
  });
  await waitFor("stale pending reminder suppression", async () => {
    const rows = await prisma.notificationDelivery.findMany({ where: { notificationId: staleEvent.id } });
    return rows.length === 4 && rows.every((item) => item.status === "SKIPPED") ? rows : null;
  });

  await request(`/bookings/${booking.id}/cancel`, { method: "POST", token: patientToken, body: { reason: "Release 1 reminder cancellation acceptance" } });
  const cancelled = await settledNotification(patientUser.id, booking.id, "notification.appointment.cancelled.body");
  assertPatientDelivery(cancelled, "appointment cancellation");
  await waitFor("terminal reminder schedule cancellation", async () => {
    const count = await prisma.appointmentReminderSchedule.count({ where: { appointmentId: booking.id, status: "ACTIVE" } });
    return count === 0 ? true : null;
  });

  const staleAfterCancellation = await prisma.notificationEvent.create({
    data: {
      accountId: patientUser.id,
      dedupeKey: `${patientUser.id}:appointment-reminder:${booking.id}:60:${Date.now()}`,
      type: "APPOINTMENT_UPDATE",
      entityType: "APPOINTMENT",
      entityId: booking.id,
      safeTitleKey: "notification.appointment.reminder.title",
      safeBodyKey: "notification.appointment.reminder.body",
      deliveries: { create: [{ channel: "IN_APP" }] },
    },
  });
  await waitFor("delivery-time stale reminder guard", async () => {
    const delivery = await prisma.notificationDelivery.findFirst({ where: { notificationId: staleAfterCancellation.id } });
    return delivery?.status === "SKIPPED" ? delivery : null;
  });

  const dueAppointment = await prisma.appointment.create({
    data: {
      patientId: patientUser.patientProfile.id,
      providerId: provider.id,
      serviceId: service.id,
      modality: "CLINIC",
      status: "CONFIRMED",
      startsAt: dueReminderStart,
      endsAt: new Date(dueReminderStart.getTime() + 30 * 60_000),
    },
  });
  const patientReminder = await settledNotification(patientUser.id, dueAppointment.id, "notification.appointment.reminder.body");
  const doctorReminder = await settledNotification(doctorUser.id, dueAppointment.id, "notification.appointment.reminder.body");
  assertPatientDelivery(patientReminder, "scheduled reminder");
  assertOptedOutDelivery(doctorReminder, "scheduled reminder");
  const reminderSchedule = await waitFor("processed reminder schedule", async () => prisma.appointmentReminderSchedule.findFirst({
    where: { appointmentId: dueAppointment.id, offsetMinutes: 60, status: "PROCESSED" },
  }));
  assert.equal(reminderSchedule.dueAt.getTime(), dueReminderStart.getTime() - 60 * 60_000, "Reminder dueAt did not use absolute appointment time minus configured offset.");
  assert.equal(patientReminder.safeTitleKey, "notification.appointment.reminder.title", "Reminder notification used an unexpected title template.");
  assert(!JSON.stringify(patientReminder).includes("Release 1 reminder acceptance service"), "Reminder notification leaked service detail instead of PHI-neutral template keys.");

  const completedStart = new Date(now - 2 * 60 * 60 * 1000);
  const completedAppointment = await prisma.appointment.create({
    data: {
      patientId: patientUser.patientProfile.id,
      providerId: provider.id,
      serviceId: service.id,
      modality: "CLINIC",
      status: "CONFIRMED",
      startsAt: completedStart,
      endsAt: new Date(completedStart.getTime() + 30 * 60_000),
    },
  });
  await request(`/admin/operations/appointments/${completedAppointment.id}/intervention`, {
    method: "POST",
    token: adminToken,
    body: { action: "COMPLETE" },
  });
  const completed = await settledNotification(patientUser.id, completedAppointment.id, "notification.appointment.completed.body");
  assertPatientDelivery(completed, "appointment completion");

  const lifecycleSignals = await prisma.appointmentLifecycleSignal.findMany({ where: { appointmentId: booking.id }, orderBy: { id: "asc" } });
  assert(lifecycleSignals.some((item) => item.eventType === "SCHEDULED"), "Booking did not produce a durable SCHEDULED lifecycle signal.");
  assert(lifecycleSignals.some((item) => item.eventType === "RESCHEDULED"), "Reschedule did not produce a durable RESCHEDULED lifecycle signal.");
  assert(lifecycleSignals.some((item) => item.eventType === "STATUS_CHANGED" && item.toStatus === "CANCELLED"), "Cancellation did not produce a durable status lifecycle signal.");
  assert(lifecycleSignals.every((item) => item.processedAt), "A Release 1 appointment lifecycle signal remained unprocessed.");

  console.log(JSON.stringify({
    status: "passed",
    phase: "Release 1 FR-NTF-001",
    bookingConfirmation: true,
    idempotentLifecycleNotifications: true,
    reminderTimingPolicyConfigurable: true,
    scheduledReminder: true,
    rescheduleInvalidatesOldReminder: true,
    cancellationInvalidatesReminder: true,
    statusChangeNotifications: true,
    recipientPreferencesEnforced: true,
    phiNeutralTemplates: true,
    deliveryTimeStaleReminderGuard: true,
  }));
} finally {
  await prisma.$disconnect();
}
