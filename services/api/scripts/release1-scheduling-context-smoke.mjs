import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const providerPassword = process.env.SLICE6_DOCTOR_PASSWORD || "CarePoint-Doctor#2026";
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD || "CarePoint-Patient#2026";
const prisma = new PrismaClient();

async function raw(path, { method = "GET", token, body } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function request(path, options = {}) {
  const result = await raw(path, options);
  if (result.status < 200 || result.status >= 300) throw new Error(`${options.method || "GET"} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function login(email, password) {
  const result = await request("/iam/login", { method: "POST", body: { email, password } });
  if (!result.accessToken) throw new Error(`No access token for ${email}`);
  return result.accessToken;
}

async function ensureAccount(adminToken, email, password, role) {
  const result = await raw("/iam/accounts", { method: "POST", token: adminToken, body: { email, password, role } });
  if (result.status !== 201 && result.status !== 409) throw new Error(`Unable to prepare ${role} account ${email}: ${result.status} ${JSON.stringify(result.payload)}`);
}

async function ensurePatient(email, password, firstName) {
  const result = await raw("/iam/register/patient", { method: "POST", body: { email, password, firstName, lastName: "Release1 Context" } });
  if (result.status !== 201 && result.status !== 409) throw new Error(`Unable to prepare patient ${email}: ${result.status} ${JSON.stringify(result.payload)}`);
  return login(email, password);
}

function iso(dateText, time) {
  return `${dateText}T${time}:00.000Z`;
}

try {
  const adminToken = await login(adminEmail, adminPassword);
  const doctorEmail = "doctor-release1-context@carepoint.test";
  await ensureAccount(adminToken, doctorEmail, providerPassword, "DOCTOR");
  const doctorToken = await login(doctorEmail, providerPassword);
  const doctorUser = await prisma.user.findUnique({ where: { email: doctorEmail } });
  if (!doctorUser) throw new Error("Release 1 context doctor account is missing.");

  const specialties = await request("/doctors/specialties");
  const specialty = specialties.items?.[0];
  if (!specialty?.id || !specialty?.code) throw new Error("No seeded medical specialty is available for Release 1 context acceptance.");
  const provider = await prisma.provider.upsert({
    where: { userId: doctorUser.id },
    create: { userId: doctorUser.id, class: "DOCTOR", displayName: "Release 1 Context Doctor", status: "ACTIVE" },
    update: { class: "DOCTOR", displayName: "Release 1 Context Doctor", status: "ACTIVE" },
  });
  const doctorProfile = await prisma.doctorProfile.upsert({
    where: { providerId: provider.id },
    create: { providerId: provider.id, licenseNumber: "R1-CONTEXT-DOCTOR", licenseIssuer: "CarePoint acceptance" },
    update: { licenseNumber: "R1-CONTEXT-DOCTOR", licenseIssuer: "CarePoint acceptance" },
  });
  await prisma.doctorSpecialty.upsert({
    where: { doctorId_specialtyId: { doctorId: doctorProfile.id, specialtyId: specialty.id } },
    create: { doctorId: doctorProfile.id, specialtyId: specialty.id, primary: true },
    update: { primary: true },
  });

  const invalidLocation = await raw("/provider/locations", {
    method: "POST",
    token: doctorToken,
    body: { label: "Unvalidated", addressLine1: "1 Test Street", city: "Beirut", countryCode: "LB", latitude: 33.8938, longitude: 35.5018, addressValidated: false },
  });
  assert.equal(invalidLocation.status, 400, "Provider location accepted an unvalidated address assertion.");

  const location = await request("/provider/locations", {
    method: "POST",
    token: doctorToken,
    body: {
      label: "Release 1 Beirut Clinic",
      addressLine1: "100 CarePoint Avenue",
      city: "Beirut",
      region: "Beirut",
      countryCode: "LB",
      latitude: 33.8938,
      longitude: 35.5018,
      arrivalInstructions: "Use the main reception and present the appointment reference.",
      addressValidated: true,
    },
  });
  assert.equal(location.validated, true, "Validated provider location was not marked as validated.");
  assert.equal(location.navigation.latitude, 33.8938, "Provider location navigation coordinates were not exposed.");

  const clinicService = await request("/provider/services", {
    method: "POST",
    token: doctorToken,
    body: {
      labels: { en: "Release 1 Clinic A", ar: "عيادة الإصدار الأول أ", fr: "Clinique Release 1 A", es: "Clínica Release 1 A" },
      currency: "USD",
      modalities: [{
        modality: "CLINIC",
        durationMinutes: 30,
        priceMinor: 5000,
        clinicLocationId: location.id,
        clinicArrivalInstructions: "Check in at reception fifteen minutes before the appointment.",
      }],
    },
  });
  assert.equal(clinicService.deliveryContexts?.[0]?.clinic?.location?.id, location.id, "Clinic service did not persist its delivery location context.");

  const clinicServiceB = await request("/provider/services", {
    method: "POST",
    token: doctorToken,
    body: {
      labels: { en: "Release 1 Clinic B", ar: "عيادة الإصدار الأول ب", fr: "Clinique Release 1 B", es: "Clínica Release 1 B" },
      currency: "USD",
      modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 5500, clinicLocationId: location.id }],
    },
  });

  const unreadyClinic = await request("/provider/services", {
    method: "POST",
    token: doctorToken,
    body: {
      labels: { en: "Release 1 Unready Clinic", ar: "عيادة غير جاهزة", fr: "Clinique non prête", es: "Clínica no preparada" },
      currency: "USD",
      modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 4000 }],
    },
  });

  const discoveryQuery = new URLSearchParams({
    specialty: specialty.code,
    providerClass: "DOCTOR",
    modality: "CLINIC",
    location: "Beirut",
    page: "1",
    limit: "1",
  });
  const discoveryPage1 = await request(`/services/discovery?${discoveryQuery.toString()}`);
  assert.equal(discoveryPage1.items.length, 1, "Structured discovery did not return the first deterministic page.");
  assert.equal(discoveryPage1.nextPage, 2, "Structured discovery did not expose deterministic pagination.");
  discoveryQuery.set("page", "2");
  const discoveryPage2 = await request(`/services/discovery?${discoveryQuery.toString()}`);
  assert.equal(discoveryPage2.items.length, 1, "Structured discovery did not return the second deterministic page.");
  assert.notEqual(discoveryPage1.items[0].id, discoveryPage2.items[0].id, "Structured discovery pagination repeated the same service.");
  assert(new Set([discoveryPage1.items[0].id, discoveryPage2.items[0].id]).has(clinicService.id), "Structured discovery omitted Release 1 Clinic A.");
  assert(new Set([discoveryPage1.items[0].id, discoveryPage2.items[0].id]).has(clinicServiceB.id), "Structured discovery omitted Release 1 Clinic B.");

  const serviceFilter = await request(`/services/discovery?service=${encodeURIComponent(clinicService.id)}&specialty=${encodeURIComponent(specialty.code)}&providerClass=DOCTOR&modality=CLINIC&location=Beirut`);
  assert.equal(serviceFilter.items?.[0]?.id, clinicService.id, "Structured discovery service/specialty/provider/modality/location filters did not compose correctly.");
  const wrongLocation = await request(`/services/discovery?service=${encodeURIComponent(clinicService.id)}&modality=CLINIC&location=Riyadh`);
  assert.equal(wrongLocation.items.length, 0, "Structured discovery location filter returned a clinic outside the requested location.");
  const wrongProviderType = await request(`/services/discovery?service=${encodeURIComponent(clinicService.id)}&providerClass=OTHER_PROVIDER&modality=CLINIC`);
  assert.equal(wrongProviderType.items.length, 0, "Structured discovery provider type filter returned the wrong provider class.");
  const unreadyDiscovery = await request(`/services/discovery?service=${encodeURIComponent(unreadyClinic.id)}&modality=CLINIC`);
  assert.equal(unreadyDiscovery.items.length, 0, "Structured Release 1 discovery exposed a clinic without validated location/instructions.");

  const scheduleDate = "2031-01-06";
  const weekday = new Date(`${scheduleDate}T12:00:00.000Z`).getUTCDay();
  const invalidBufferedRule = await raw("/provider/availability/rules", {
    method: "POST",
    token: doctorToken,
    body: { serviceId: clinicService.id, modality: "CLINIC", timezone: "UTC", weekday, startMinute: 600, endMinute: 720, intervalMinutes: 35, bufferBeforeMinutes: 10, bufferAfterMinutes: 5, effectiveFrom: scheduleDate, effectiveUntil: scheduleDate },
  });
  assert.equal(invalidBufferedRule.status, 400, "Availability rule accepted an interval smaller than duration plus configured buffers.");

  const rule = await request("/provider/availability/rules", {
    method: "POST",
    token: doctorToken,
    body: { serviceId: clinicService.id, modality: "CLINIC", timezone: "UTC", weekday, startMinute: 600, endMinute: 720, intervalMinutes: 45, bufferBeforeMinutes: 10, bufferAfterMinutes: 5, effectiveFrom: scheduleDate, effectiveUntil: scheduleDate },
  });
  assert.equal(rule.bufferBeforeMinutes, 10, "Availability buffer-before policy was not persisted.");
  assert.equal(rule.bufferAfterMinutes, 5, "Availability buffer-after policy was not persisted.");
  const listedRules = await request("/provider/availability/rules", { token: doctorToken });
  const listedRule = listedRules.find((item) => item.id === rule.id);
  assert.equal(listedRule?.bufferBeforeMinutes, 10, "Availability rule list lost the buffer policy.");

  const vacation = await request("/provider/availability/exceptions", {
    method: "POST",
    token: doctorToken,
    body: { serviceId: clinicService.id, modality: "CLINIC", kind: "VACATION", startsAt: iso(scheduleDate, "10:40"), endsAt: iso(scheduleDate, "11:20"), reason: "Release 1 vacation acceptance" },
  });
  assert.equal(vacation.kind, "VACATION", "Availability exception kind was not persisted.");
  const generated = await request("/provider/availability/generate", { method: "POST", token: doctorToken, body: { fromDate: scheduleDate, toDate: scheduleDate, ruleId: rule.id } });
  assert.equal(generated.createdCount, 3, "Buffered recurring rule did not generate the expected slots.");
  assert(generated.blockedByExceptions >= 1, "Active availability exception did not block generated overlapping slots.");
  const blockedSlot = await prisma.availabilitySlot.findFirst({ where: { serviceId: clinicService.id, status: "BLOCKED", startsAt: { gte: new Date(iso(scheduleDate, "00:00")), lt: new Date(iso("2031-01-07", "00:00")) } } });
  if (!blockedSlot) throw new Error("No blocked slot was found for the Release 1 vacation exception.");
  const deactivatedVacation = await request(`/provider/availability/exceptions/${vacation.id}/status`, { method: "PATCH", token: doctorToken, body: { active: false } });
  assert.equal(deactivatedVacation.blockedSlotsRequireExplicitUnblock, true, "Exception deactivation silently implied slot reopening.");
  await request(`/provider/availability/slots/${blockedSlot.id}/unblock`, { method: "POST", token: doctorToken, body: {} });
  assert.equal((await prisma.availabilitySlot.findUnique({ where: { id: blockedSlot.id } }))?.status, "OPEN", "Explicit slot unblock did not reopen the slot after exception deactivation.");

  const slots = await request(`/availability?serviceId=${encodeURIComponent(clinicService.id)}&modality=CLINIC&from=${encodeURIComponent(iso(scheduleDate, "00:00"))}&to=${encodeURIComponent(iso("2031-01-07", "00:00"))}`);
  assert(slots.length >= 3, "Clinic availability did not expose generated slots after explicit exception resolution.");

  const patientAToken = await ensurePatient("patient-r1-context-a@carepoint.test", patientPassword, "Context A");
  const patientBToken = await ensurePatient("patient-r1-context-b@carepoint.test", patientPassword, "Context B");
  const patientCToken = await ensurePatient("patient-r1-context-c@carepoint.test", patientPassword, "Context C");
  const clinicBooking = await request("/bookings", { method: "POST", token: patientAToken, body: { slotId: slots[0].id, idempotencyKey: "r1-context-clinic-a-0001" } });
  assert.equal(clinicBooking.visitContext?.modality, "CLINIC", "Clinic booking did not persist a clinic visit context.");
  assert.equal(clinicBooking.visitContext?.sourceProviderLocationId, location.id, "Clinic booking did not snapshot the provider location.");
  assert.equal(clinicBooking.visitContext?.addressValidated, true, "Clinic booking visit context did not retain validated-address evidence.");
  assert.equal(clinicBooking.visitContext?.instructions, "Check in at reception fifteen minutes before the appointment.", "Clinic booking did not snapshot arrival instructions.");
  assert.equal(clinicBooking.visitContext?.navigation?.latitude, 33.8938, "Clinic visit context did not expose navigation coordinates.");

  const conflictingException = await raw("/provider/availability/exceptions", {
    method: "POST",
    token: doctorToken,
    body: { serviceId: clinicService.id, modality: "CLINIC", kind: "UNAVAILABLE", startsAt: new Date(Date.parse(clinicBooking.startsAt) - 5 * 60_000).toISOString(), endsAt: new Date(Date.parse(clinicBooking.endsAt) + 5 * 60_000).toISOString() },
  });
  assert.equal(conflictingException.status, 409, "Availability exception was allowed to overlap an active confirmed appointment.");

  const [concurrentB, concurrentC] = await Promise.all([
    raw("/bookings", { method: "POST", token: patientBToken, body: { slotId: slots[1].id, idempotencyKey: "r1-context-concurrent-b-0001" } }),
    raw("/bookings", { method: "POST", token: patientCToken, body: { slotId: slots[1].id, idempotencyKey: "r1-context-concurrent-c-0001" } }),
  ]);
  assert.equal([concurrentB, concurrentC].filter((result) => result.status >= 200 && result.status < 300).length, 1, "Contextual booking lost single-capacity concurrency protection.");
  assert.equal([concurrentB, concurrentC].filter((result) => result.status === 409).length, 1, "Contextual booking did not return one concurrency conflict.");

  const homeService = await request("/provider/services", {
    method: "POST",
    token: doctorToken,
    body: {
      labels: { en: "Release 1 Home Visit", ar: "زيارة منزلية", fr: "Visite à domicile", es: "Visita domiciliaria" },
      currency: "USD",
      modalities: [{ modality: "HOME_VISIT", durationMinutes: 30, priceMinor: 6000, homeVisitCoverage: { centerLatitude: 33.8938, centerLongitude: 35.5018, radiusKm: 10 } }],
    },
  });
  assert.equal(homeService.deliveryContexts?.[0]?.homeVisitCoverage?.radiusKm, 10, "Home-visit coverage configuration was not persisted.");
  const homeDate = "2031-01-07";
  const homeWeekday = new Date(`${homeDate}T12:00:00.000Z`).getUTCDay();
  const homeRule = await request("/provider/availability/rules", {
    method: "POST",
    token: doctorToken,
    body: { serviceId: homeService.id, modality: "HOME_VISIT", timezone: "UTC", weekday: homeWeekday, startMinute: 600, endMinute: 690, intervalMinutes: 30, effectiveFrom: homeDate, effectiveUntil: homeDate },
  });
  await request("/provider/availability/generate", { method: "POST", token: doctorToken, body: { fromDate: homeDate, toDate: homeDate, ruleId: homeRule.id } });
  const homeSlots = await request(`/availability?serviceId=${encodeURIComponent(homeService.id)}&modality=HOME_VISIT&from=${encodeURIComponent(iso(homeDate, "00:00"))}&to=${encodeURIComponent(iso("2031-01-08", "00:00"))}`);
  assert(homeSlots.length >= 3, "Home-visit availability was not generated.");

  const commonHome = { addressLine1: "12 Home Care Street", city: "Beirut", countryCode: "LB", latitude: 33.89, longitude: 35.50, instructions: "Call on arrival", contactPhone: "+9611000000", addressValidated: true };
  const missingConfirmation = await raw("/bookings", { method: "POST", token: patientAToken, body: { slotId: homeSlots[0].id, idempotencyKey: "r1-home-missing-confirmation", homeVisit: { ...commonHome, contactConfirmed: false } } });
  assert.equal(missingConfirmation.status, 400, "Home visit accepted an unconfirmed contact.");
  const outsideCoverage = await raw("/bookings", { method: "POST", token: patientAToken, body: { slotId: homeSlots[0].id, idempotencyKey: "r1-home-outside-coverage", homeVisit: { ...commonHome, latitude: 34.5, longitude: 36.0, contactConfirmed: true } } });
  assert.equal(outsideCoverage.status, 409, "Home visit outside configured coverage was accepted.");
  const homeBookingInput = { slotId: homeSlots[0].id, idempotencyKey: "r1-home-inside-coverage-0001", homeVisit: { ...commonHome, contactConfirmed: true } };
  const homeBooking = await request("/bookings", { method: "POST", token: patientAToken, body: homeBookingInput });
  assert.equal(homeBooking.visitContext?.modality, "HOME_VISIT", "Home visit did not persist structured visit context.");
  assert.equal(homeBooking.visitContext?.addressValidated, true, "Home visit did not persist validated-address evidence.");
  assert.equal(homeBooking.visitContext?.contactConfirmed, true, "Home visit did not persist contact confirmation.");
  assert.equal(homeBooking.visitContext?.contactPhone, "+9611000000", "Home visit did not persist contact information.");
  const repeatedHome = await request("/bookings", { method: "POST", token: patientAToken, body: homeBookingInput });
  assert.equal(repeatedHome.id, homeBooking.id, "Idempotent contextual home-visit booking returned a different appointment.");
  assert.equal(await prisma.appointmentVisitContext.count({ where: { appointmentId: homeBooking.id } }), 1, "Idempotent booking duplicated appointment visit context.");

  const patientAppointments = await request("/bookings/me", { token: patientAToken });
  assert(patientAppointments.some((item) => item.id === clinicBooking.id && item.visitContext?.modality === "CLINIC"), "Patient appointment list omitted clinic visit context.");
  assert(patientAppointments.some((item) => item.id === homeBooking.id && item.visitContext?.modality === "HOME_VISIT"), "Patient appointment list omitted home-visit context.");
  const providerAgenda = await request("/provider/appointments?from=2031-01-06T00%3A00%3A00.000Z&to=2031-01-08T00%3A00%3A00.000Z", { token: doctorToken });
  assert(providerAgenda.some((item) => item.id === clinicBooking.id && item.visitContext?.modality === "CLINIC"), "Provider agenda omitted clinic visit context.");
  assert(providerAgenda.some((item) => item.id === homeBooking.id && item.visitContext?.modality === "HOME_VISIT"), "Provider agenda omitted home-visit context.");

  console.log(JSON.stringify({
    status: "passed",
    phase: "Release 1 P0 #75",
    structuredDiscovery: true,
    deterministicPagination: true,
    specialtyProviderServiceModalityLocationFilters: true,
    validatedClinicLocationAndInstructions: true,
    availabilityBuffers: true,
    vacationExceptionsAndExplicitUnblock: true,
    activeAppointmentExceptionGuard: true,
    clinicVisitContextSnapshot: true,
    homeVisitValidatedAddressCoordinatesInstructionsContact: true,
    homeVisitCoverageValidation: true,
    contextualBookingIdempotency: true,
    contextualBookingConcurrency: true,
    patientProviderVisitContextSurfaces: true,
  }));
} finally {
  await prisma.$disconnect();
}
