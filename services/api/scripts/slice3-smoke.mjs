import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";

async function raw(path, { method = "GET", token, body, headers = {} } = {}) {
  const merged = { "content-type": "application/json", ...headers };
  if (token) merged.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers: merged, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function request(path, options = {}) {
  const result = await raw(path, options);
  if (result.status < 200 || result.status >= 300) throw new Error(`${options.method || "GET"} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function login(email, password) {
  const value = await request("/iam/login", { method: "POST", body: { email, password } });
  if (!value.accessToken) throw new Error(`No access token for ${email}`);
  return value.accessToken;
}

async function registerPatient(email, firstName) {
  const password = "CarePoint-Telehealth#2026";
  await request("/iam/register/patient", { method: "POST", body: { email, password, firstName, lastName: "Telehealth CI" } });
  return login(email, password);
}

try {
  const adminToken = await login("admin-ci@carepoint.test", "CarePoint-CI-Admin#2026");
  const specialties = await request("/doctors/specialties");
  const specialty = specialties.items?.[0];
  if (!specialty?.id) throw new Error("No specialty available.");

  const doctorEmail = "doctor-slice3@carepoint.test";
  const doctorPassword = "CarePoint-Doctor-Tele#2026";
  await request("/iam/accounts", { method: "POST", token: adminToken, body: { email: doctorEmail, password: doctorPassword, role: "DOCTOR" } });
  const doctorToken = await login(doctorEmail, doctorPassword);
  const onboarding = await request("/onboarding/doctors", { method: "POST", token: doctorToken, body: { specialtyId: specialty.id } });
  const credential = await request(`/onboarding/${onboarding.id}/credentials`, { method: "POST", token: doctorToken, body: { type: "medical-license", number: "CI-TELE-0001", issuer: "CarePoint CI", validUntil: "2035-12-31" } });
  await request(`/onboarding/${onboarding.id}/submit`, { method: "POST", token: doctorToken });
  await request(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, { method: "POST", token: adminToken, body: { state: "VERIFIED" } });
  await request(`/onboarding/${onboarding.id}/approve`, { method: "POST", token: adminToken });

  const service = await request("/provider/services", {
    method: "POST",
    token: doctorToken,
    body: {
      labels: { en: "Secure Telemedicine", ar: "استشارة آمنة عن بعد", fr: "Téléconsultation sécurisée", es: "Teleconsulta segura" },
      currency: "USD",
      modalities: [{ modality: "TELEMEDICINE", durationMinutes: 30, priceMinor: 6000 }],
    },
  });

  const patientToken = await registerPatient("patient-slice3@carepoint.test", "Tele Patient");
  const intruderToken = await registerPatient("intruder-slice3@carepoint.test", "Other Patient");
  const doctorUser = await prisma.user.findUnique({ where: { email: doctorEmail }, include: { provider: true } });
  const patientUser = await prisma.user.findUnique({ where: { email: "patient-slice3@carepoint.test" }, include: { patientProfile: true } });
  if (!doctorUser?.provider || !patientUser?.patientProfile) throw new Error("Telehealth test profiles are missing.");

  const startsAt = new Date(Date.now() + 5 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const slot = await prisma.availabilitySlot.create({
    data: { providerId: doctorUser.provider.id, serviceId: service.id, modality: "TELEMEDICINE", startsAt, endsAt, capacity: 1 },
  });
  const appointment = await request("/bookings", { method: "POST", token: patientToken, body: { slotId: slot.id, idempotencyKey: "slice3-secure-telemedicine-booking" } });

  const initial = await request(`/telehealth/appointments/${appointment.id}`, { token: patientToken });
  if (initial.status !== "WAITING" || initial.consentGranted !== false || initial.recordingEnabled !== false) throw new Error(`Unexpected initial telehealth state: ${JSON.stringify(initial)}`);

  const denied = await raw(`/telehealth/appointments/${appointment.id}`, { token: intruderToken });
  if (denied.status !== 403) throw new Error(`Expected nonparticipant 403, got ${denied.status}`);

  const preConsentJoin = await raw(`/telehealth/appointments/${appointment.id}/join`, { method: "POST", token: patientToken, body: {} });
  if (preConsentJoin.status !== 409) throw new Error(`Expected consent-gated join 409, got ${preConsentJoin.status}`);

  await request(`/telehealth/appointments/${appointment.id}/consent`, { method: "POST", token: patientToken, body: { version: "telemedicine-v1" } });
  await request(`/telehealth/appointments/${appointment.id}/readiness`, { method: "POST", token: patientToken, body: { camera: true, microphone: true, network: true } });
  const ready = await request(`/telehealth/appointments/${appointment.id}/readiness`, { method: "POST", token: doctorToken, body: { camera: true, microphone: true, network: true } });
  if (ready.status !== "READY" || ready.patientReady !== true || ready.providerReady !== true) throw new Error(`Expected READY state: ${JSON.stringify(ready)}`);

  const patientJoin = await request(`/telehealth/appointments/${appointment.id}/join`, { method: "POST", token: patientToken, body: {} });
  const doctorJoin = await request(`/telehealth/appointments/${appointment.id}/join`, { method: "POST", token: doctorToken, body: {} });
  if (!patientJoin.participantToken || !doctorJoin.participantToken || patientJoin.participantToken === doctorJoin.participantToken) throw new Error("Participant tokens are invalid.");
  if (!patientJoin.e2eeKey || patientJoin.e2eeKey !== doctorJoin.e2eeKey) throw new Error("Participants did not receive the same session E2EE key.");
  if (patientJoin.recordingEnabled !== false) throw new Error("Recording must be disabled.");

  const sessionRow = await prisma.telehealthSession.findUnique({ where: { appointmentId: appointment.id } });
  if (!sessionRow) throw new Error("Telehealth session was not persisted.");
  if (sessionRow.e2eeCiphertext.includes(patientJoin.e2eeKey)) throw new Error("E2EE key leaked into ciphertext storage.");

  const webhook = await raw("/telehealth/webhooks/livekit", {
    method: "POST",
    body: JSON.stringify({ event: "participant_joined", room: { name: sessionRow.roomName }, participant: { identity: "opaque-ci-participant" } }),
  });
  if (webhook.status !== 204) throw new Error(`Mock webhook failed: ${webhook.status}`);
  const active = await request(`/telehealth/appointments/${appointment.id}`, { token: doctorToken });
  if (active.status !== "ACTIVE" || !active.startedAt) throw new Error(`Webhook did not activate session: ${JSON.stringify(active)}`);

  const ended = await request(`/telehealth/appointments/${appointment.id}/end`, { method: "POST", token: doctorToken, body: {} });
  if (ended.status !== "ENDED") throw new Error("Provider could not end telehealth session.");
  const postEndJoin = await raw(`/telehealth/appointments/${appointment.id}/join`, { method: "POST", token: patientToken, body: {} });
  if (postEndJoin.status !== 409) throw new Error(`Expected join rejection after end, got ${postEndJoin.status}`);

  console.log(JSON.stringify({ status: "passed", appointmentId: appointment.id, telehealthSessionId: sessionRow.id, nonparticipantStatus: denied.status, finalStatus: ended.status }));
} finally {
  await prisma.$disconnect();
}
