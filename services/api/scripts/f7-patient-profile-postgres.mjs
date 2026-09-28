import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const base = process.env.CAREPOINT_F7_URL || "http://127.0.0.1:4000/api/v1";
const prisma = new PrismaClient();

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function json(path, options = {}) {
  const result = await request(path, options);
  if (!result.response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${result.response.status} ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function registerAndLogin(suffix, firstName, lastName, phone) {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const email = `f7-${suffix}-${unique}@carepoint.test`;
  const username = `f7-${suffix}-${unique}`.slice(0, 40);
  const password = "CarePoint-F7#2026";
  const otp = await json("/iam/register/otp/start", {
    method: "POST",
    body: { kind: "PATIENT", firstName, lastName, phone },
  });
  assert.equal(otp.deliveryMode, "display", "test registration OTP must use display delivery");
  assert.match(otp.testOtp || "", /^\\d{6}$/);
  const verified = await json("/iam/register/otp/verify", {
    method: "POST",
    body: { challengeId: otp.challengeId, code: otp.testOtp },
  });
  await json("/iam/register/patient", {
    method: "POST",
    body: {
      challengeId: otp.challengeId,
      registrationToken: verified.registrationToken,
      email,
      username,
      password,
      dateOfBirth: "1990-01-15",
      sex: "PREFER_NOT_TO_SAY",
    },
  });
  const session = await json("/iam/login", { method: "POST", body: { email, password } });
  assert.ok(session.accessToken, "patient login must return access token");
  const account = await json("/iam/accounts/me", { token: session.accessToken });
  return { account, token: session.accessToken };
}

try {
  const patientA = await registerAndLogin("a", "F7", "Owner", "+961 70 111 111");
  const patientB = await registerAndLogin("b", "F7", "Other", "+961 70 222 222");

  const initialA = await json("/iam/patient-profile", { token: patientA.token });
  const initialB = await json("/iam/patient-profile", { token: patientB.token });
  assert.equal(initialA.firstName, "F7");
  assert.equal(initialA.lastName, "Owner");
  assert.equal(initialA.phone, "+96170111111");
  assert.match(initialA.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(initialB.lastName, "Other");

  const updatedA = await json("/iam/patient-profile", {
    method: "PATCH",
    token: patientA.token,
    body: {
      firstName: "  F7 Updated  ",
      lastName: "Owner",
      phone: "  ",
      expectedUpdatedAt: initialA.updatedAt,
      patientId: "must-be-ignored",
      userId: patientB.account.id,
      accountId: patientB.account.id,
    },
  });
  assert.equal(updatedA.firstName, "F7 Updated");
  assert.equal(updatedA.lastName, "Owner");
  assert.equal(updatedA.phone, null);
  assert.notEqual(updatedA.updatedAt, initialA.updatedAt, "successful update must advance optimistic-concurrency token");

  const afterB = await json("/iam/patient-profile", { token: patientB.token });
  assert.deepEqual(
    { firstName: afterB.firstName, lastName: afterB.lastName, phone: afterB.phone },
    { firstName: initialB.firstName, lastName: initialB.lastName, phone: initialB.phone },
    "patient A must not be able to redirect a profile update to patient B",
  );

  const stale = await request("/iam/patient-profile", {
    method: "PATCH",
    token: patientA.token,
    body: {
      firstName: "Stale overwrite",
      lastName: "Owner",
      phone: "+961 70 999 999",
      expectedUpdatedAt: initialA.updatedAt,
    },
  });
  assert.equal(stale.response.status, 409, "stale profile write must fail with conflict");

  const afterStale = await json("/iam/patient-profile", { token: patientA.token });
  assert.equal(afterStale.firstName, "F7 Updated");
  assert.equal(afterStale.phone, null);
  assert.equal(afterStale.updatedAt, updatedA.updatedAt);

  const unauthenticated = await request("/iam/patient-profile");
  assert.equal(unauthenticated.response.status, 401, "profile endpoint must require authentication");

  const audit = await prisma.auditEvent.findFirst({
    where: {
      actorId: patientA.account.id,
      action: "PATIENT_PROFILE_UPDATED",
      objectType: "PATIENT_PROFILE",
    },
    orderBy: { occurredAt: "desc" },
  });
  assert.ok(audit, "successful profile change must be audited");
  assert.equal(audit.purpose, "PATIENT_SELF_SERVICE");
  assert.equal(audit.result, "SUCCESS");
  assert.deepEqual(Object.keys(audit.metadata || {}).sort(), ["changedFields"]);
  assert.deepEqual(audit.metadata.changedFields.sort(), ["firstName", "phone"]);
  const serializedAudit = JSON.stringify(audit.metadata);
  assert.equal(serializedAudit.includes("F7 Updated"), false, "audit metadata must not contain profile values");
  assert.equal(serializedAudit.includes("+961"), false, "audit metadata must not contain phone values");

  console.log("F7 patient profile PostgreSQL acceptance passed");
} finally {
  await prisma.$disconnect();
}
