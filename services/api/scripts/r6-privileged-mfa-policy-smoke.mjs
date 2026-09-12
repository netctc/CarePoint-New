import { PrismaClient } from "@prisma/client";
import { hashPassword, totpCode } from "@carepoint/identity";

const strictBase = process.env.CAREPOINT_MFA_POLICY_URL || "http://127.0.0.1:4001/api/v1";
const normalBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const prisma = new PrismaClient();
const password = "CarePoint-MFA-Policy#2026";
const run = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createdIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(base, path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return { status: response.status, payload, text };
}

async function createAccount(role, label) {
  const user = await prisma.user.create({
    data: {
      email: `mfa-${label}-${run}@carepoint.test`,
      passwordHash: hashPassword(password),
      role,
    },
  });
  createdIds.push(user.id);
  return user;
}

async function strictLogin(user) {
  return request(strictBase, "/iam/login", { method: "POST", body: JSON.stringify({ email: user.email, password }) });
}

async function beginEnrollment(challengeId) {
  const start = await request(strictBase, "/iam/mfa/enrollment/start", { method: "POST", body: JSON.stringify({ challengeId }) });
  assert(start.status === 201 || start.status === 200, `Enrollment start failed: ${start.status} ${start.text}`);
  assert(typeof start.payload.secret === "string" && start.payload.secret.length >= 16, "Enrollment start did not return a valid TOTP setup secret.");
  assert(typeof start.payload.otpauthUri === "string" && start.payload.otpauthUri.startsWith("otpauth://"), "Enrollment start did not return a valid otpauth URI.");
  return start.payload;
}

async function enrollAndVerify(user) {
  const login = await strictLogin(user);
  assert(login.status === 201 || login.status === 200, `${user.role} login failed unexpectedly: ${login.status} ${login.text}`);
  assert(login.payload.requiresMfa === true, `${user.role} password-only login did not require MFA.`);
  assert(typeof login.payload.challengeId === "string" && login.payload.challengeId.startsWith("mfaenroll_"), `${user.role} did not receive the restricted enrollment challenge.`);
  assert(!login.payload.accessToken && !login.payload.refreshToken && !login.payload.sessionId, `${user.role} enrollment challenge leaked unrestricted session tokens.`);
  const sessionsBefore = await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } });
  assert(sessionsBefore === 0, `${user.role} obtained an active session before MFA enrollment.`);

  const setup = await beginEnrollment(login.payload.challengeId);
  const verify = await request(strictBase, "/iam/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId: login.payload.challengeId, code: totpCode(setup.secret) }),
  });
  assert(verify.status === 201 || verify.status === 200, `${user.role} MFA enrollment verification failed: ${verify.status} ${verify.text}`);
  assert(typeof verify.payload.accessToken === "string" && typeof verify.payload.refreshToken === "string", `${user.role} MFA verification did not issue tokens.`);
  assert(typeof verify.payload.sessionId === "string" && verify.payload.sessionId.startsWith("sesmfa_"), `${user.role} verified session is not MFA-assured.`);

  const me = await request(strictBase, "/iam/accounts/me", { headers: { authorization: `Bearer ${verify.payload.accessToken}` } });
  assert(me.status === 200 && me.payload.role === user.role, `${user.role} MFA-assured session could not access its account.`);
  return { login, setup, tokens: verify.payload };
}

try {
  const health = await request(strictBase, "/health");
  assert(health.status === 200 && health.payload.status === "ok", "MFA-policy API health check failed.");

  const patient = await createAccount("PATIENT", "patient");
  const patientLogin = await strictLogin(patient);
  assert(patientLogin.status === 201 || patientLogin.status === 200, "Patient login failed under privileged MFA policy test mode.");
  assert(typeof patientLogin.payload.accessToken === "string" && !patientLogin.payload.requiresMfa, "Patient was incorrectly forced into privileged MFA enrollment.");

  const admin = await createAccount("ADMIN", "admin");
  const doctor = await createAccount("DOCTOR", "doctor");
  const provider = await createAccount("OTHER_PROVIDER", "provider");
  const support = await createAccount("SUPPORT", "support");

  const adminVerified = await enrollAndVerify(admin);
  const doctorVerified = await enrollAndVerify(doctor);
  const providerVerified = await enrollAndVerify(provider);

  const serverStateUser = await createAccount("ADMIN", "server-state-dispatch");
  const serverStateLogin = await strictLogin(serverStateUser);
  assert(serverStateLogin.payload.requiresMfa === true, "Server-state MFA regression account did not require enrollment.");
  const neutralChallengeId = `mfa_${run}-server-state`;
  await prisma.authChallenge.create({
    data: { id: neutralChallengeId, userId: serverStateUser.id, type: "MFA_LOGIN", expiresAt: new Date(Date.now() + 4 * 60 * 1000) },
  });
  const serverStateSetup = await beginEnrollment(neutralChallengeId);
  const serverStateVerify = await request(strictBase, "/iam/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId: neutralChallengeId, code: totpCode(serverStateSetup.secret) }),
  });
  assert(serverStateVerify.status === 201 || serverStateVerify.status === 200, `Persisted MFA state did not drive required enrollment: ${serverStateVerify.status} ${serverStateVerify.text}`);
  const enabledServerState = await prisma.mfaEnrollment.findUnique({ where: { userId: serverStateUser.id } });
  assert(enabledServerState?.enabledAt, "Required MFA enrollment was not persisted after server-state verification.");

  const enrollmentShapedChallengeId = `mfaenroll_${run}-already-enabled`;
  await prisma.authChallenge.create({
    data: { id: enrollmentShapedChallengeId, userId: serverStateUser.id, type: "MFA_LOGIN", expiresAt: new Date(Date.now() + 4 * 60 * 1000) },
  });
  const forcedEnrollment = await request(strictBase, "/iam/mfa/enrollment/start", {
    method: "POST",
    body: JSON.stringify({ challengeId: enrollmentShapedChallengeId }),
  });
  assert(forcedEnrollment.status === 409, `Challenge identifier shape overrode persisted MFA enrollment state: ${forcedEnrollment.status}.`);
  const ordinaryVerify = await request(strictBase, "/iam/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId: enrollmentShapedChallengeId, code: totpCode(serverStateSetup.secret) }),
  });
  assert(ordinaryVerify.status === 201 || ordinaryVerify.status === 200, `Enabled MFA was not verified from persisted server state: ${ordinaryVerify.status} ${ordinaryVerify.text}`);

  const supportLogin = await strictLogin(support);
  assert(supportLogin.payload.requiresMfa === true && supportLogin.payload.challengeId?.startsWith("mfaenroll_"), "SUPPORT did not require MFA enrollment.");
  const supportSetup = await beginEnrollment(supportLogin.payload.challengeId);
  const supportCode = totpCode(supportSetup.secret);
  const concurrent = await Promise.all([
    request(strictBase, "/iam/mfa/verify", { method: "POST", body: JSON.stringify({ challengeId: supportLogin.payload.challengeId, code: supportCode }) }),
    request(strictBase, "/iam/mfa/verify", { method: "POST", body: JSON.stringify({ challengeId: supportLogin.payload.challengeId, code: supportCode }) }),
  ]);
  const successes = concurrent.filter((item) => item.status >= 200 && item.status < 300);
  const denials = concurrent.filter((item) => item.status === 401);
  assert(successes.length === 1 && denials.length === 1, `Concurrent MFA replay was not one-time: ${concurrent.map((item) => item.status).join(",")}`);
  const replay = await request(strictBase, "/iam/mfa/verify", { method: "POST", body: JSON.stringify({ challengeId: supportLogin.payload.challengeId, code: supportCode }) });
  assert(replay.status === 401, `Consumed MFA challenge replay was not denied: ${replay.status}.`);

  await prisma.mfaEnrollment.update({ where: { userId: doctor.id }, data: { enabledAt: null } });
  const resetAccess = await request(strictBase, "/iam/accounts/me", { headers: { authorization: `Bearer ${doctorVerified.tokens.accessToken}` } });
  assert(resetAccess.status === 401, `MFA enrollment reset did not invalidate privileged access: ${resetAccess.status}.`);
  const resetSession = await prisma.authSession.findUnique({ where: { id: doctorVerified.tokens.sessionId } });
  assert(resetSession?.revokedAt, "MFA enrollment reset did not revoke the active privileged session.");

  await prisma.mfaEnrollment.update({ where: { userId: provider.id }, data: { enabledAt: null } });
  const resetRefresh = await request(strictBase, "/iam/sessions/refresh", { method: "POST", body: JSON.stringify({ refreshToken: providerVerified.tokens.refreshToken }) });
  assert(resetRefresh.status === 401, `MFA enrollment reset did not invalidate privileged refresh: ${resetRefresh.status}.`);
  const providerSession = await prisma.authSession.findUnique({ where: { id: providerVerified.tokens.sessionId } });
  assert(providerSession?.revokedAt, "MFA policy refresh denial did not revoke the privileged session.");

  const legacy = await createAccount("ADMIN", "legacy-password-session");
  const legacyLogin = await request(normalBase, "/iam/login", { method: "POST", body: JSON.stringify({ email: legacy.email, password }) });
  assert(typeof legacyLogin.payload.accessToken === "string" && legacyLogin.payload.sessionId?.startsWith("ses_"), "Normal test API did not create the expected legacy password-only session.");
  const legacyDenied = await request(strictBase, "/iam/accounts/me", { headers: { authorization: `Bearer ${legacyLogin.payload.accessToken}` } });
  assert(legacyDenied.status === 401, `Policy activation did not reject a pre-existing password-only privileged session: ${legacyDenied.status}.`);
  const legacySession = await prisma.authSession.findUnique({ where: { id: legacyLogin.payload.sessionId } });
  assert(legacySession?.revokedAt, "Policy activation denial did not revoke the legacy password-only session.");

  const auditRows = await prisma.auditEvent.findMany({ where: { actorId: { in: createdIds } }, select: { action: true, metadata: true } });
  const auditText = JSON.stringify(auditRows);
  for (const secret of [adminVerified.setup.secret, doctorVerified.setup.secret, providerVerified.setup.secret, serverStateSetup.secret, supportSetup.secret]) {
    assert(!auditText.includes(secret), "MFA setup secret leaked into audit evidence.");
  }
  assert(auditRows.some((row) => row.action === "MFA_POLICY_ENROLLMENT_REQUIRED"), "MFA policy denial was not audited.");
  assert(auditRows.some((row) => row.action === "MFA_POLICY_SESSION_DENIED"), "MFA session-policy denial was not audited.");
  assert(auditRows.some((row) => row.action === "MFA_CHALLENGE_REPLAY_DENIED"), "MFA challenge replay denial was not audited.");

  console.log(JSON.stringify({
    status: "passed",
    privilegedRoles: ["ADMIN", "SUPPORT", "DOCTOR", "OTHER_PROVIDER"],
    patientMfaRiskConfigRemainsOptional: true,
    noPasswordOnlyPrivilegedSession: true,
    restrictedEnrollmentBootstrap: true,
    challengePurposeBoundToPersistedServerState: true,
    mfaAssuredSessionMarker: true,
    concurrentReplayDenied: true,
    enrollmentResetRevokesAccessAndRefresh: true,
    legacyPasswordSessionDeniedAfterPolicyActivation: true,
    auditSecretLeakage: false,
  }));
} finally {
  await prisma.user.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined);
  await prisma.$disconnect();
}
