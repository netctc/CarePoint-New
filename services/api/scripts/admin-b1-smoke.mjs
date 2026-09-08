import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://127.0.0.1:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const patientEmail = "patient-ci@carepoint.test";
const patientPassword = "CarePoint-Patient#2026";
const prisma = new PrismaClient();

const ACCESS_COOKIE = "carepoint_admin_access";
const REFRESH_COOKIE = "carepoint_admin_refresh";
const SESSION_COOKIE = "carepoint_admin_session";

class CookieJar {
  constructor() { this.values = new Map(); }
  capture(response) {
    const lines = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : splitSetCookie(response.headers.get("set-cookie") || "");
    for (const line of lines) {
      const first = line.split(";", 1)[0] || "";
      const separator = first.indexOf("=");
      if (separator <= 0) continue;
      const name = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (!value || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(line)) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
  header() { return [...this.values.entries()].map(([name, value]) => `${name}=${value}`).join("; "); }
  get(name) { return this.values.get(name) || ""; }
  has(name) { return this.values.has(name); }
}

function splitSetCookie(raw) {
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;,]+=)/g).map((value) => value.trim()).filter(Boolean);
}

async function api(path, init = {}) {
  const response = await fetch(apiBase + path, {
    ...init,
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`API ${init.method || "GET"} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function web(path, init = {}, jar = null) {
  const headers = { ...(init.headers || {}) };
  if (jar?.header()) headers.cookie = jar.header();
  if (init.method && init.method !== "GET" && init.method !== "HEAD") headers.origin = adminBase;
  const response = await fetch(adminBase + path, { ...init, headers, redirect: "manual" });
  if (jar) jar.capture(response);
  return response;
}

async function webJson(path, init = {}, jar = null) {
  const response = await web(path, {
    ...init,
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
  }, jar);
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return { response, payload, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoBearerMaterial(payload, label) {
  const text = JSON.stringify(payload);
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(text), `${label} leaked bearer token material.`);
}

function totp(secret) {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.replace(/=+$/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 TOTP secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

try {
  const anonymous = await web("/");
  assert([307, 308].includes(anonymous.status), `Anonymous admin root should redirect, got ${anonymous.status}.`);
  assert((anonymous.headers.get("location") || "").includes("/login"), "Anonymous admin root did not redirect to login.");

  const loginPage = await web("/login");
  assert(loginPage.status === 200, `Admin login page failed with ${loginPage.status}.`);

  const patient = await prisma.user.findUnique({ where: { email: patientEmail } });
  assert(patient, "CI patient account was not found.");
  const patientSessionsBefore = new Set((await prisma.authSession.findMany({
    where: { userId: patient.id },
    select: { id: true },
  })).map((session) => session.id));

  const patientJar = new CookieJar();
  const patientAttempt = await webJson("/api/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: patientEmail, password: patientPassword }),
  }, patientJar);
  assert(patientAttempt.response.status === 403, `Patient admin login should be denied with 403, got ${patientAttempt.response.status}.`);
  assertNoBearerMaterial(patientAttempt.payload, "Patient-role denial");
  assert(!patientJar.has(ACCESS_COOKIE) && !patientJar.has(REFRESH_COOKIE), "Patient-role denial wrote admin auth cookies.");
  const patientSessionsAfter = await prisma.authSession.findMany({ where: { userId: patient.id } });
  const portalPatientSessions = patientSessionsAfter.filter((session) => !patientSessionsBefore.has(session.id));
  assert(portalPatientSessions.length === 1, `Expected exactly one portal-issued Patient session, got ${portalPatientSessions.length}.`);
  assert(portalPatientSessions[0].revokedAt, "Non-admin session issued during Admin Web login was not revoked.");

  const jar = new CookieJar();
  const adminLogin = await webJson("/api/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  }, jar);
  assert(adminLogin.response.status === 200, `Admin login failed with ${adminLogin.response.status}: ${adminLogin.text}`);
  assert(adminLogin.payload.authenticated === true && adminLogin.payload.account?.role === "ADMIN", "Admin login did not return sanitized ADMIN identity.");
  assertNoBearerMaterial(adminLogin.payload, "Admin login");
  assert(jar.has(ACCESS_COOKIE) && jar.has(REFRESH_COOKIE) && jar.has(SESSION_COOKIE), "Admin login did not establish all HttpOnly session cookies.");
  const authSetCookies = typeof adminLogin.response.headers.getSetCookie === "function" ? adminLogin.response.headers.getSetCookie() : splitSetCookie(adminLogin.response.headers.get("set-cookie") || "");
  for (const cookieName of [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE]) {
    const line = authSetCookies.find((item) => item.startsWith(`${cookieName}=`));
    assert(line && /HttpOnly/i.test(line) && /SameSite=Strict/i.test(line), `${cookieName} is missing HttpOnly/SameSite=Strict hardening.`);
  }

  const session = await webJson("/api/admin/auth/session", {}, jar);
  assert(session.response.status === 200 && session.payload.account?.email === adminEmail, "Admin session endpoint did not resolve the authenticated operator.");
  assertNoBearerMaterial(session.payload, "Admin session");

  const protectedRoot = await web("/", {}, jar);
  assert(protectedRoot.status === 200, `Authenticated admin root failed with ${protectedRoot.status}.`);

  const oldSessionId = jar.get(SESSION_COOKIE);
  await prisma.authSession.update({ where: { id: oldSessionId }, data: { expiresAt: new Date(Date.now() - 5_000) } });
  const refreshedPage = await web("/security", {}, jar);
  assert(refreshedPage.status === 200, `Expired access token was not transparently refreshed, status ${refreshedPage.status}.`);
  const rotatedSessionId = jar.get(SESSION_COOKIE);
  assert(rotatedSessionId && rotatedSessionId !== oldSessionId, "Transparent refresh did not rotate the CarePoint session.");
  const oldSession = await prisma.authSession.findUnique({ where: { id: oldSessionId } });
  assert(oldSession?.revokedAt && oldSession.replacedBySessionId === rotatedSessionId, "Backend refresh rotation did not revoke/link the previous session.");

  const rotatedAccessToken = jar.get(ACCESS_COOKIE);
  const enrollment = await api("/iam/mfa/enroll", { method: "POST", headers: { authorization: `Bearer ${rotatedAccessToken}` }, body: JSON.stringify({}) });
  assert(typeof enrollment.secret === "string" && enrollment.secret.length >= 16, "MFA enrollment did not return a test secret.");
  await api("/iam/mfa/confirm", { method: "POST", headers: { authorization: `Bearer ${rotatedAccessToken}` }, body: JSON.stringify({ code: totp(enrollment.secret) }) });

  const preMfaLogoutSessionId = jar.get(SESSION_COOKIE);
  const logoutBeforeMfa = await web("/api/admin/auth/logout", { method: "POST" }, jar);
  assert(logoutBeforeMfa.status === 204, `Pre-MFA logout failed with ${logoutBeforeMfa.status}.`);
  const preMfaLogoutRow = await prisma.authSession.findUnique({ where: { id: preMfaLogoutSessionId } });
  assert(preMfaLogoutRow?.revokedAt, "Logout did not revoke the active backend session.");
  assert(!jar.has(ACCESS_COOKIE) && !jar.has(REFRESH_COOKIE) && !jar.has(SESSION_COOKIE), "Logout did not clear Admin Web cookies.");

  const mfaLogin = await webJson("/api/admin/auth/login", { method: "POST", body: JSON.stringify({ email: adminEmail, password: adminPassword }) }, jar);
  assert(mfaLogin.response.status === 200 && mfaLogin.payload.requiresMfa === true && typeof mfaLogin.payload.challengeId === "string", "MFA-enabled admin login did not return a challenge.");
  assertNoBearerMaterial(mfaLogin.payload, "Admin MFA challenge");
  assert(!jar.has(ACCESS_COOKIE) && !jar.has(REFRESH_COOKIE), "MFA challenge issued session cookies before verification.");

  const mfaVerify = await webJson("/api/admin/auth/mfa", {
    method: "POST",
    body: JSON.stringify({ challengeId: mfaLogin.payload.challengeId, code: totp(enrollment.secret) }),
  }, jar);
  assert(mfaVerify.response.status === 200 && mfaVerify.payload.authenticated === true && mfaVerify.payload.account?.role === "ADMIN", `Admin MFA verification failed: ${mfaVerify.text}`);
  assertNoBearerMaterial(mfaVerify.payload, "Admin MFA verification");
  assert(jar.has(ACCESS_COOKIE) && jar.has(REFRESH_COOKIE) && jar.has(SESSION_COOKIE), "Verified MFA did not establish Admin Web session cookies.");

  const finalSessionId = jar.get(SESSION_COOKIE);
  const finalLogout = await web("/api/admin/auth/logout", { method: "POST" }, jar);
  assert(finalLogout.status === 204, `Final logout failed with ${finalLogout.status}.`);
  const finalSession = await prisma.authSession.findUnique({ where: { id: finalSessionId } });
  assert(finalSession?.revokedAt, "Final Admin Web session remains active after logout.");
  const afterLogout = await web("/", {}, jar);
  assert([307, 308].includes(afterLogout.status) && (afterLogout.headers.get("location") || "").includes("/login"), "Logged-out admin can still reach a protected route.");

  console.log(JSON.stringify({
    status: "passed",
    phase: "B1",
    adminRoleBoundary: true,
    httpOnlyCookies: true,
    sameSiteStrict: true,
    bearerTokensHiddenFromBrowserJson: true,
    backendValidatedRouteGuard: true,
    refreshRotation: true,
    mfaChallengeFlow: true,
    logoutRevocation: true,
  }));
} finally {
  const admin = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } }).catch(() => null);
  if (admin) await prisma.mfaEnrollment.deleteMany({ where: { userId: admin.id } }).catch(() => undefined);
  await prisma.$disconnect();
}

await import("./admin-b2-smoke.mjs");
await import("./admin-b3-smoke.mjs");
