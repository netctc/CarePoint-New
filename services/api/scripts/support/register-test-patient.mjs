import { createHash } from "node:crypto";

function fixturePhone(email) {
  const hex = createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 8);
  const value = Number.parseInt(hex, 16) % 100000000;
  return `+9665${String(value).padStart(8, "0")}`;
}

async function postJson(base, path, body) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`POST ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

export async function registerTestPatient({
  base,
  email,
  password,
  firstName,
  lastName,
  username,
  phone,
  dateOfBirth = "1990-01-15",
  sex = "PREFER_NOT_TO_SAY",
}) {
  const resolvedUsername =
    username ??
    String(email)
      .split("@")[0]
      .replace(/[^a-z0-9._-]/gi, "-")
      .toLowerCase()
      .slice(0, 40);

  const otp = await postJson(base, "/iam/register/otp/start", {
    kind: "PATIENT",
    firstName,
    lastName,
    phone: phone ?? fixturePhone(email),
  });
  if (!otp.challengeId || !otp.testOtp) {
    throw new Error("Test registration OTP was not returned in display mode.");
  }

  const verified = await postJson(base, "/iam/register/otp/verify", {
    challengeId: otp.challengeId,
    code: otp.testOtp,
  });
  if (!verified.registrationToken) {
    throw new Error("Test registration OTP verification did not return a completion token.");
  }

  return postJson(base, "/iam/register/patient", {
    challengeId: otp.challengeId,
    registrationToken: verified.registrationToken,
    email,
    username: resolvedUsername,
    password,
    dateOfBirth,
    sex,
  });
}
