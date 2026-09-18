const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";

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
  if (!result.accessToken) throw new Error(`login did not return an access token for ${email}`);
  return result.accessToken;
}

async function registerPatient(email, password, firstName) {
  await request("/iam/register/patient", {
    method: "POST",
    body: { email, password, firstName, lastName: "Booking CI" },
  });
  return login(email, password);
}

const adminToken = await login("admin-ci@carepoint.test", "CarePoint-CI-Admin#2026");
const specialties = await request("/doctors/specialties");
const specialty = specialties.items?.[0];
if (!specialty?.id) throw new Error("No seeded medical specialty is available for Slice 2 smoke test.");

const doctorEmail = "doctor-slice2@carepoint.test";
const doctorPassword = "CarePoint-Doctor#2026";
await request("/iam/accounts", {
  method: "POST",
  token: adminToken,
  body: { email: doctorEmail, password: doctorPassword, role: "DOCTOR" },
});
const doctorToken = await login(doctorEmail, doctorPassword);

const onboarding = await request("/onboarding/doctors", {
  method: "POST",
  token: doctorToken,
  body: { specialtyId: specialty.id },
});
const credential = await request(`/onboarding/${onboarding.id}/credentials`, {
  method: "POST",
  token: doctorToken,
  body: { type: "medical-license", number: "CI-MED-0001", issuer: "CarePoint CI Authority", validUntil: "2035-12-31" },
});
await request(`/onboarding/${onboarding.id}/submit`, { method: "POST", token: doctorToken });
await request(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, {
  method: "POST",
  token: adminToken,
  body: { state: "VERIFIED", note: "CI verification" },
});
await request(`/onboarding/${onboarding.id}/approve`, { method: "POST", token: adminToken });

const service = await request("/provider/services", {
  method: "POST",
  token: doctorToken,
  body: {
    labels: {
      en: "Cardiology Consultation",
      ar: "استشارة أمراض القلب",
      fr: "Consultation de cardiologie",
      es: "Consulta de cardiología"
    },
    descriptionLabels: {
      en: "Scheduled cardiology consultation",
      ar: "استشارة قلب مجدولة",
      fr: "Consultation de cardiologie programmée",
      es: "Consulta de cardiología programada"
    },
    currency: "USD",
    modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 7500 }]
  },
});

const scheduleDate = "2030-01-07";
const weekday = new Date(`${scheduleDate}T12:00:00.000Z`).getUTCDay();
const rule = await request("/provider/availability/rules", {
  method: "POST",
  token: doctorToken,
  body: {
    serviceId: service.id,
    modality: "CLINIC",
    timezone: "UTC",
    weekday,
    startMinute: 600,
    endMinute: 630,
    intervalMinutes: 30,
    slotCapacity: 1,
    effectiveFrom: scheduleDate,
    effectiveUntil: scheduleDate
  },
});
const generation = await request("/provider/availability/generate", {
  method: "POST",
  token: doctorToken,
  body: { fromDate: scheduleDate, toDate: scheduleDate, ruleId: rule.id },
});
if (generation.createdCount !== 1) throw new Error(`Expected one generated slot, got ${JSON.stringify(generation)}`);

const slots = await request(`/availability?serviceId=${encodeURIComponent(service.id)}&modality=CLINIC&from=2030-01-07T00%3A00%3A00.000Z&to=2030-01-08T00%3A00%3A00.000Z`);
if (!Array.isArray(slots) || slots.length !== 1 || slots[0].remainingCapacity !== 1) throw new Error(`Expected one available slot, got ${JSON.stringify(slots)}`);
const slotId = slots[0].id;

const password = "CarePoint-Patient#2026";
const patientAToken = await registerPatient("patient-a-slice2@carepoint.test", password, "Patient A");
const patientBToken = await registerPatient("patient-b-slice2@carepoint.test", password, "Patient B");

const bookingA = { slotId, idempotencyKey: "slice2-patient-a-booking-0001" };
const bookingB = { slotId, idempotencyKey: "slice2-patient-b-booking-0001" };
const [resultA, resultB] = await Promise.all([
  raw("/bookings", { method: "POST", token: patientAToken, body: bookingA }),
  raw("/bookings", { method: "POST", token: patientBToken, body: bookingB }),
]);
const results = [
  { ...resultA, token: patientAToken, input: bookingA },
  { ...resultB, token: patientBToken, input: bookingB },
];
const winners = results.filter((result) => result.status >= 200 && result.status < 300);
const conflicts = results.filter((result) => result.status === 409);
if (winners.length !== 1 || conflicts.length !== 1) {
  throw new Error(`Concurrent booking invariant failed: ${JSON.stringify(results.map(({ status, payload }) => ({ status, payload })))}`);
}

const winner = winners[0];
const repeat = await request("/bookings", { method: "POST", token: winner.token, body: winner.input });
if (repeat.id !== winner.payload.id) throw new Error("Idempotent booking retry returned a different appointment.");

await request(`/bookings/${winner.payload.id}/cancel`, {
  method: "POST",
  token: winner.token,
  body: { reason: "CI cancellation to verify inventory release" },
});

const loser = conflicts[0];
const rebook = await request("/bookings", {
  method: "POST",
  token: loser.token,
  body: { slotId, idempotencyKey: `${loser.input.idempotencyKey}-retry` },
});
if (rebook.status !== "CONFIRMED") throw new Error("Slot inventory was not reusable after cancellation.");

const agenda = await request("/provider/appointments?from=2030-01-07T00%3A00%3A00.000Z&to=2030-01-08T00%3A00%3A00.000Z", { token: doctorToken });
if (!Array.isArray(agenda) || agenda.length < 2) throw new Error("Provider agenda does not contain Slice 2 booking history.");

console.log(JSON.stringify({
  status: "passed",
  serviceId: service.id,
  slotId,
  concurrentWinner: winner.payload.id,
  concurrentConflictStatus: conflicts[0].status,
  rebookedAppointmentId: rebook.id,
}));
