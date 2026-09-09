import { PrismaClient } from "@prisma/client";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
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
  const payload = await request("/iam/login", { method: "POST", body: { email, password } });
  if (!payload.accessToken) throw new Error("Login did not return an access token.");
  return payload.accessToken;
}

async function createPatient(suffix, label) {
  const email = `r6-${label}-${suffix}@carepoint.test`;
  const password = `CarePoint-R6-${label}#2026`;
  await request("/iam/register/patient", {
    method: "POST",
    body: { email, password, firstName: `R6${label}`, lastName: "Synthetic" },
  });
  const token = await login(email, password);
  const user = await prisma.user.findUnique({ where: { email }, include: { patientProfile: true } });
  if (!user?.patientProfile?.id) throw new Error("Patient profile was not created.");
  return { token, accountId: user.id, patientId: user.patientProfile.id };
}

async function createApprovedDoctor(adminToken, suffix, label, specialtyId) {
  const email = `r6-doctor-${label}-${suffix}@carepoint.test`;
  const password = `CarePoint-R6-Doctor-${label}#2026`;
  await request("/iam/accounts", { method: "POST", token: adminToken, body: { email, password, role: "DOCTOR" } });
  const token = await login(email, password);
  const onboarding = await request("/onboarding/doctors", { method: "POST", token, body: { specialtyId } });
  const credential = await request(`/onboarding/${onboarding.id}/credentials`, {
    method: "POST",
    token,
    body: { type: "medical-license", number: `R6-${label}-${suffix}`, issuer: "CarePoint R6 Synthetic", validUntil: "2035-12-31" },
  });
  await request(`/onboarding/${onboarding.id}/submit`, { method: "POST", token });
  await request(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, {
    method: "POST",
    token: adminToken,
    body: { state: "VERIFIED", note: "R6 synthetic authorization acceptance" },
  });
  await request(`/onboarding/${onboarding.id}/approve`, { method: "POST", token: adminToken });
  const user = await prisma.user.findUnique({ where: { email }, include: { provider: true } });
  if (!user?.provider?.id) throw new Error("Approved provider profile was not created.");
  return { token, accountId: user.id, providerId: user.provider.id };
}

async function createAppointment(doctor, patientToken, suffix) {
  const service = await request("/provider/services", {
    method: "POST",
    token: doctor.token,
    body: {
      labels: { en: "R6 Security Follow-up", ar: "متابعة أمنية تجريبية", fr: "Suivi de sécurité R6", es: "Seguimiento de seguridad R6" },
      currency: "USD",
      modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 5000 }],
    },
  });
  const target = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = target.toISOString().slice(0, 10);
  const rule = await request("/provider/availability/rules", {
    method: "POST",
    token: doctor.token,
    body: {
      serviceId: service.id,
      modality: "CLINIC",
      timezone: "UTC",
      weekday: target.getUTCDay(),
      startMinute: 600,
      endMinute: 630,
      intervalMinutes: 30,
      slotCapacity: 1,
      effectiveFrom: date,
      effectiveUntil: date,
    },
  });
  await request("/provider/availability/generate", { method: "POST", token: doctor.token, body: { fromDate: date, toDate: date, ruleId: rule.id } });
  const slots = await request(`/availability?serviceId=${service.id}&modality=CLINIC&from=${encodeURIComponent(`${date}T00:00:00.000Z`)}&to=${encodeURIComponent(`${date}T23:59:59.999Z`)}`);
  if (!slots[0]?.id) throw new Error("Security-test slot was not generated.");
  return request("/bookings", { method: "POST", token: patientToken, body: { slotId: slots[0].id, idempotencyKey: `r6-authz-${suffix}` } });
}

function assertNoMarker(payload, marker, label) {
  if (JSON.stringify(payload).includes(marker)) throw new Error(`${label} leaked the synthetic clinical marker.`);
}

async function main() {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const adminToken = await login("admin-ci@carepoint.test", "CarePoint-CI-Admin#2026");
  const specialties = await request("/doctors/specialties");
  const specialtyId = specialties.items?.[0]?.id;
  if (!specialtyId) throw new Error("No specialty available for R6 authorization acceptance.");

  const patientA = await createPatient(suffix, "patient-a");
  const patientB = await createPatient(suffix, "patient-b");
  const doctorA = await createApprovedDoctor(adminToken, suffix, "a", specialtyId);
  const doctorB = await createApprovedDoctor(adminToken, suffix, "b", specialtyId);
  const appointment = await createAppointment(doctorA, patientA.token, suffix);
  if (appointment.status !== "CONFIRMED") throw new Error("Security-test appointment was not confirmed.");

  const marker = `R6-SYNTHETIC-CLINICAL-MARKER-${suffix}`;
  const record = await request(`/clinical/appointments/${appointment.id}/records`, {
    method: "POST",
    token: doctorA.token,
    body: { chiefComplaint: "Synthetic follow-up", subjective: `Synthetic clinical text ${marker}`, assessment: "Synthetic stable assessment", plan: "Synthetic follow-up plan" },
  });
  if (!record.id) throw new Error("Security-test clinical record was not created.");

  const ownEncounter = await request(`/clinical/appointments/${appointment.id}`, { token: patientA.token });
  if (!ownEncounter.latestRecord?.data?.subjective?.includes(marker)) throw new Error("Patient A could not read own synthetic encounter.");

  const patientBCrossRead = await raw(`/clinical/appointments/${appointment.id}`, { token: patientB.token });
  if (patientBCrossRead.status !== 403) throw new Error(`Patient B cross-account read expected 403, got ${patientBCrossRead.status}.`);
  assertNoMarker(patientBCrossRead.payload, marker, "Patient B denied response");

  const doctorBCrossTimeline = await raw(`/clinical/patients/${patientA.patientId}/timeline`, { token: doctorB.token });
  if (doctorBCrossTimeline.status !== 403) throw new Error(`Doctor B pre-consent timeline expected 403, got ${doctorBCrossTimeline.status}.`);
  assertNoMarker(doctorBCrossTimeline.payload, marker, "Doctor B denied timeline response");

  const doctorBCrossWrite = await raw(`/clinical/appointments/${appointment.id}/records`, { method: "POST", token: doctorB.token, body: { assessment: "Synthetic unauthorized write" } });
  if (doctorBCrossWrite.status !== 403) throw new Error(`Doctor B cross-provider write expected 403, got ${doctorBCrossWrite.status}.`);

  const wrongVersionConsent = await request("/consents", {
    method: "POST",
    token: patientA.token,
    body: { providerId: doctorB.providerId, scope: "CLINICAL_RECORD_READ", version: "r6-unapproved-version" },
  });
  if (!wrongVersionConsent.id) throw new Error("Negative-test consent was not created.");
  const wrongVersionAccess = await raw(`/clinical/patients/${patientA.patientId}/timeline`, { token: doctorB.token });
  if (wrongVersionAccess.status !== 403) throw new Error(`Unapproved consent version must not grant access; got ${wrongVersionAccess.status}.`);
  assertNoMarker(wrongVersionAccess.payload, marker, "Unapproved-consent denial response");

  const validConsent = await request("/consents", {
    method: "POST",
    token: patientA.token,
    body: { providerId: doctorB.providerId, scope: "CLINICAL_RECORD_READ", version: "clinical-record-v1" },
  });
  const consentAccess = await request(`/clinical/patients/${patientA.patientId}/timeline`, { token: doctorB.token });
  if (consentAccess.accessBasis !== "PATIENT_CONSENT") throw new Error("Valid consent did not produce PATIENT_CONSENT access basis.");
  if (!consentAccess.items?.[0]?.latestRecord?.data?.subjective?.includes(marker)) throw new Error("Valid consent did not expose the intended synthetic record.");

  await request(`/consents/${validConsent.id}/revoke`, { method: "POST", token: patientA.token });
  const postRevokeAccess = await raw(`/clinical/patients/${patientA.patientId}/timeline`, { token: doctorB.token });
  if (postRevokeAccess.status !== 403) throw new Error(`Revoked consent must remove access; got ${postRevokeAccess.status}.`);
  assertNoMarker(postRevokeAccess.payload, marker, "Post-revocation denial response");

  const deniedAudits = await prisma.auditEvent.findMany({
    where: { result: "DENIED", actorId: { in: [patientB.accountId, doctorB.accountId] } },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
  if (JSON.stringify(deniedAudits).includes(marker)) throw new Error("Denied audit evidence leaked the synthetic clinical marker.");
  if (!deniedAudits.some((event) => event.action === "CLINICAL_RECORD_READ_DENIED")) throw new Error("Patient cross-account denial was not audited.");
  if (!deniedAudits.some((event) => event.action === "CLINICAL_TIMELINE_READ_DENIED")) throw new Error("Provider/consent denial was not audited.");

  console.log(JSON.stringify({ status: "passed", twoPatients: true, twoProviders: true, patientCrossAccountDenied: true, providerCrossAccountDenied: true, consentVersionEnforced: true, consentRevocationEnforced: true, deniedResponseMarkerLeakage: false, deniedAuditMarkerLeakage: false }));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
