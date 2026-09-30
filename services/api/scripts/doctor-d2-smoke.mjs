import { PrismaClient } from "@prisma/client";
import { hashPassword, totpCode } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const password = process.env.SLICE6_PATIENT_PASSWORD;
if (!password) throw new Error("SLICE6_PATIENT_PASSWORD is required for Doctor D2 acceptance.");

const prisma = new PrismaClient();
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `doctor-d2-${stamp}@carepoint.test`;
let userId;

function assert(ok, message) { if (!ok) throw new Error(message); }

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

async function login() {
  const value = (await call("/iam/login", { method: "POST", body: { email, password }, expected: 201 })).payload;
  assert(value.accessToken && value.refreshToken && value.sessionId, "D2 login did not issue a complete session.");
  return value;
}

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;
  await prisma.provider.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

try {
  await cleanup();
  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword(password), role: "DOCTOR" },
    select: { id: true },
  });
  userId = user.id;
  await prisma.provider.create({
    data: {
      userId,
      class: "DOCTOR",
      status: "ACTIVE",
      displayName: "Doctor D2",
      legalName: "Doctor D2",
    },
  });

  const first = await login();
  const token = first.accessToken;

  const me = (await call("/iam/accounts/me", { token, expected: 200 })).payload;
  assert(me.email === email && me.role === "DOCTOR" && me.status === "ACTIVE", "D2 professional account self-state is incorrect.");
  const meText = JSON.stringify(me);
  assert(!meText.includes("passwordHash") && !meText.includes("refreshTokenHash"), "D2 account self-state leaked credential material.");

  const professional = (await call("/onboarding/me", { token, expected: 200 })).payload;
  assert(professional.kind === "DOCTOR" && professional.provider?.status === "ACTIVE" && professional.accessReady === true,
    "D2 professional access summary did not identify the active doctor.");

  const second = await login();
  assert(second.sessionId !== first.sessionId, "D2 second login did not create an independent session.");
  let sessions = (await call("/iam/sessions", { token, expected: 200 })).payload;
  assert(Array.isArray(sessions), "D2 session inventory did not return a list.");
  assert(sessions.some((item) => item.id === first.sessionId && item.current === true && item.active === true), "D2 current device marker is missing.");
  assert(sessions.some((item) => item.id === second.sessionId && item.current === false && item.active === true), "D2 remote device session is missing.");
  const sessionsText = JSON.stringify(sessions);
  assert(!sessionsText.includes("refreshTokenHash") && !sessionsText.includes(first.refreshToken) && !sessionsText.includes(second.refreshToken),
    "D2 session inventory leaked refresh-token material.");

  await call(`/iam/sessions/${second.sessionId}`, { method: "DELETE", token, expected: 200 });
  sessions = (await call("/iam/sessions", { token, expected: 200 })).payload;
  assert(sessions.some((item) => item.id === second.sessionId && item.active === false), "D2 remote session revocation did not persist.");

  let mfa = (await call("/iam/mfa/status", { token, expected: 200 })).payload;
  assert(mfa.enabled === false, "D2 fresh doctor unexpectedly has MFA enabled.");
  const enrollment = (await call("/iam/mfa/enroll", { method: "POST", token, body: {}, expected: 201 })).payload;
  assert(enrollment.secret && enrollment.otpauthUri, "D2 MFA enrollment did not return setup material to the account owner.");
  await call("/iam/mfa/confirm", { method: "POST", token, body: { code: totpCode(enrollment.secret) }, expected: 201 });
  mfa = (await call("/iam/mfa/status", { token, expected: 200 })).payload;
  assert(mfa.enabled === true && mfa.enabledAt, "D2 MFA confirmation did not persist.");
  await call("/iam/mfa/enroll", { method: "POST", token, body: {}, expected: 409 });
  mfa = (await call("/iam/mfa/status", { token, expected: 200 })).payload;
  assert(mfa.enabled === true, "D2 rejected re-enrollment weakened active MFA.");

  await call("/iam/sessions/revoke-all", { method: "POST", token, body: {}, expected: 201 });
  await call("/iam/accounts/me", { token, expected: 401 });

  console.log(JSON.stringify({
    status: "passed",
    phase: "Doctor-D2",
    isolatedFixtureAccount: true,
    professionalAccountSelfService: true,
    activeProviderSummary: true,
    sessionInventory: true,
    currentDeviceMarker: true,
    remoteSessionRevocation: true,
    sessionSecretsHidden: true,
    mfaEnrollment: true,
    activeMfaReenrollmentProtected: true,
    revokeAllSessions: true,
    bearerMaterialHiddenFromSelfService: true
  }));
} finally {
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
}
