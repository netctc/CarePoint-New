import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const password = process.env.SLICE6_PATIENT_PASSWORD;
if (!password) throw new Error("SLICE6_PATIENT_PASSWORD is required for Doctor D1 acceptance.");

const prisma = new PrismaClient();
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const doctorEmail = `doctor-d1-${stamp}@carepoint.test`;
const adminEmail = `doctor-d1-admin-${stamp}@carepoint.test`;
const patientEmail = `doctor-d1-patient-${stamp}@carepoint.test`;
const licenseNumber = `D1-MED-${stamp}`;
const fixtureEmails = [doctorEmail, adminEmail, patientEmail];
let fixtureUserIds = [];

function assert(ok, message) { if (!ok) throw new Error(message); }

function assertSelfStateSanitized(payload, label) {
  const text = JSON.stringify(payload);
  for (const forbidden of ["userId", "reviewerActorId", "reviewedByActorId", "passwordHash", "accessToken", "refreshToken", "access_token", "refresh_token"]) {
    assert(!text.includes(`\"${forbidden}\"`), `${label} leaked forbidden field ${forbidden}.`);
  }
}

async function call(path, { method = "GET", token, body, expected } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  const allowed = expected === undefined ? null : (Array.isArray(expected) ? expected : [expected]);
  if (allowed) {
    assert(allowed.includes(response.status), `${method} ${path} expected ${allowed.join("/")} but got ${response.status}: ${text}`);
  } else {
    assert(response.ok, `${method} ${path} failed ${response.status}: ${text}`);
  }
  return { response, payload, text };
}

async function login(email) {
  const result = await call("/iam/login", { method: "POST", body: { email, password }, expected: 201 });
  assert(result.payload.accessToken, `Login did not issue an access token for ${email}.`);
  return result.payload.accessToken;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: fixtureEmails } }, select: { id: true } });
  const ids = users.map((item) => item.id);
  if (ids.length === 0) return;
  await prisma.provider.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

try {
  await cleanup();
  const passwordHash = hashPassword(password);
  const created = await Promise.all([
    prisma.user.create({ data: { email: doctorEmail, passwordHash, role: "DOCTOR" }, select: { id: true } }),
    prisma.user.create({ data: { email: adminEmail, passwordHash, role: "ADMIN" }, select: { id: true } }),
    prisma.user.create({ data: { email: patientEmail, passwordHash, role: "PATIENT" }, select: { id: true } }),
  ]);
  fixtureUserIds = created.map((item) => item.id);
  const [doctorId] = fixtureUserIds;

  let doctorToken = await login(doctorEmail);
  const adminToken = await login(adminEmail);
  const patientToken = await login(patientEmail);

  const fresh = (await call("/onboarding/me", { token: doctorToken, expected: 200 })).payload;
  assert(fresh.kind === "DOCTOR" && fresh.provider === null && fresh.onboarding === null && fresh.accessReady === false,
    "D1 fresh doctor self-state is incorrect.");
  assertSelfStateSanitized(fresh, "D1 fresh self-state");

  await call("/onboarding/me", { token: patientToken, expected: 403 });

  const specialties = (await call("/doctors/specialties", { expected: 200 })).payload;
  const items = Array.isArray(specialties.items) ? specialties.items : [];
  const specialty = items.find((item) => item?.active !== false && item?.id);
  assert(specialty, "D1 requires at least one active medical specialty.");

  const onboarding = (await call("/onboarding/doctors", {
    method: "POST",
    token: doctorToken,
    body: { specialtyId: specialty.id },
    expected: 201,
  })).payload;
  assert(onboarding.id && onboarding.state === "DRAFT", "D1 doctor onboarding did not start in DRAFT.");

  let state = (await call("/onboarding/me", { token: doctorToken, expected: 200 })).payload;
  assert(state.provider?.status === "DRAFT" && state.onboarding?.id === onboarding.id && state.onboarding?.state === "DRAFT" && state.accessReady === false,
    "D1 self-state did not reflect the draft provider application.");
  assertSelfStateSanitized(state, "D1 draft self-state");

  const credential = (await call(`/onboarding/${onboarding.id}/credentials`, {
    method: "POST",
    token: doctorToken,
    body: { type: "medical-license", number: licenseNumber, issuer: "D1 Medical Council", validUntil: "2032-12-31" },
    expected: 201,
  })).payload;
  assert(credential.id && credential.type === "medical-license", "D1 medical license was not persisted.");

  await call(`/onboarding/${onboarding.id}/submit`, { method: "POST", token: doctorToken, body: {}, expected: 201 });
  state = (await call("/onboarding/me", { token: doctorToken, expected: 200 })).payload;
  assert(state.provider?.status === "PENDING_REVIEW" && state.onboarding?.state === "PENDING_REVIEW" && state.accessReady === false,
    "D1 pending review state did not round-trip.");
  assertSelfStateSanitized(state, "D1 pending self-state");

  await call(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, {
    method: "POST",
    token: adminToken,
    body: { state: "VERIFIED" },
    expected: 201,
  });
  await call(`/onboarding/${onboarding.id}/approve`, { method: "POST", token: adminToken, body: {}, expected: 201 });

  state = (await call("/onboarding/me", { token: doctorToken, expected: 200 })).payload;
  assert(state.accessReady === true && state.provider?.status === "ACTIVE" && state.onboarding?.state === "APPROVED",
    "D1 approved doctor did not become access-ready.");
  assertSelfStateSanitized(state, "D1 approved self-state");

  const activeRestart = await call("/onboarding/doctors", {
    method: "POST",
    token: doctorToken,
    body: { specialtyId: specialty.id },
    expected: 409,
  });
  assert(/active provider cannot restart onboarding/i.test(activeRestart.text), "D1 ACTIVE restart guard is missing.");

  await call(`/onboarding/provider-access/${doctorId}/suspend`, { method: "POST", token: adminToken, body: {}, expected: 201 });
  await call("/onboarding/me", { token: doctorToken, expected: 401 });
  doctorToken = await login(doctorEmail);
  state = (await call("/onboarding/me", { token: doctorToken, expected: 200 })).payload;
  assert(state.accessReady === false && state.provider?.status === "SUSPENDED" && state.onboarding?.state === "APPROVED",
    "D1 suspended doctor self-state is incorrect.");
  assertSelfStateSanitized(state, "D1 suspended self-state");

  const suspendedRestart = await call("/onboarding/doctors", {
    method: "POST",
    token: doctorToken,
    body: { specialtyId: specialty.id },
    expected: 409,
  });
  assert(/suspended provider cannot restart onboarding/i.test(suspendedRestart.text), "D1 SUSPENDED restart guard is missing.");

  const auditActions = await prisma.auditEvent.findMany({
    where: {
      OR: [
        { actorId: { in: fixtureUserIds } },
        { objectId: { in: [onboarding.id, credential.id] } },
      ],
    },
    select: { action: true },
  });
  const actions = new Set(auditActions.map((item) => item.action));
  for (const action of ["DOCTOR_ONBOARDING_STARTED", "ONBOARDING_CREDENTIAL_ADDED", "ONBOARDING_SUBMITTED", "CREDENTIAL_REVIEWED", "ONBOARDING_APPROVED", "PROVIDER_SUSPENDED"]) {
    assert(actions.has(action), `D1 audit trail is missing ${action}.`);
  }

  console.log(JSON.stringify({
    status: "passed",
    phase: "Doctor-D1",
    isolatedFixtureAccounts: true,
    providerSelfState: true,
    roleIsolation: true,
    selfStateMinimized: true,
    draftOnboarding: true,
    medicalLicenseCapture: true,
    pendingReviewGate: true,
    adminApprovalToActive: true,
    activeWorkspaceGate: true,
    activeRestartProtected: true,
    suspensionRevokesSessions: true,
    suspendedWorkspaceBlocked: true,
    suspendedRestartProtected: true,
    auditableCredentialingLifecycle: true
  }));
} finally {
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
}
