import { PrismaClient } from "@prisma/client";

const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://localhost:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const doctorEmail = "b2-doctor-ci@carepoint.test";
const otherEmail = "b2-provider-ci@carepoint.test";
const doctorPassword = "CarePoint-B2-Doctor#2026";
const otherPassword = "CarePoint-B2-Provider#2026";
const prisma = new PrismaClient();

const ACCESS_COOKIE = "carepoint_admin_access";

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
}

function splitSetCookie(raw) {
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;,]+=)/g).map((value) => value.trim()).filter(Boolean);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoBearerMaterial(payload, label) {
  const text = JSON.stringify(payload);
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(text), `${label} leaked bearer token material.`);
}

async function api(path, init = {}) {
  const response = await fetch(apiBase + path, {
    ...init,
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return { response, payload, text };
}

async function apiJson(path, init = {}) {
  const result = await api(path, init);
  if (!result.response.ok) throw new Error(`API ${init.method || "GET"} ${path} -> ${result.response.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function web(path, init = {}, jar = null) {
  const headers = { ...(init.headers || {}) };
  if (jar?.header()) headers.cookie = jar.header();
  if (init.method && init.method !== "GET" && init.method !== "HEAD" && !headers.origin) headers.origin = adminBase;
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

async function cleanupFixtures() {
  const users = await prisma.user.findMany({ where: { email: { in: [doctorEmail, otherEmail] } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  if (ids.length > 0) {
    await prisma.provider.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

try {
  await cleanupFixtures();

  const jar = new CookieJar();
  const adminLogin = await webJson("/api/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  }, jar);
  assert(adminLogin.response.status === 200 && adminLogin.payload.authenticated === true, `B2 admin login failed: ${adminLogin.text}`);
  assertNoBearerMaterial(adminLogin.payload, "B2 admin login");
  const adminAccess = jar.get(ACCESS_COOKIE);
  assert(adminAccess, "B2 setup could not resolve the HttpOnly admin access cookie.");

  const adminHeaders = { authorization: `Bearer ${adminAccess}` };
  const doctorAccount = await apiJson("/iam/accounts", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email: doctorEmail, password: doctorPassword, role: "DOCTOR" }),
  });
  const otherAccount = await apiJson("/iam/accounts", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email: otherEmail, password: otherPassword, role: "OTHER_PROVIDER" }),
  });
  assert(doctorAccount.role === "DOCTOR" && otherAccount.role === "OTHER_PROVIDER", "Managed B2 provider accounts were not created with strict domain roles.");

  const specialty = await prisma.medicalSpecialty.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  const category = await prisma.providerCategory.findFirst({ where: { active: true }, orderBy: { slug: "asc" } });
  assert(specialty && category, "B2 requires an active specialty and non-doctor provider category from reference data.");

  const doctorLogin = await apiJson("/iam/login", { method: "POST", body: JSON.stringify({ email: doctorEmail, password: doctorPassword }) });
  const otherLogin = await apiJson("/iam/login", { method: "POST", body: JSON.stringify({ email: otherEmail, password: otherPassword }) });
  assert(doctorLogin.accessToken && otherLogin.accessToken, "B2 provider login did not issue access tokens.");
  const doctorHeaders = { authorization: `Bearer ${doctorLogin.accessToken}` };
  const otherHeaders = { authorization: `Bearer ${otherLogin.accessToken}` };

  const doctorDenied = await api("/onboarding", { headers: doctorHeaders });
  assert(doctorDenied.response.status === 403, `DOCTOR should not read the admin review queue, got ${doctorDenied.response.status}.`);

  const doctorOnboarding = await apiJson("/onboarding/doctors", {
    method: "POST",
    headers: doctorHeaders,
    body: JSON.stringify({ specialtyId: specialty.id }),
  });
  const oldDoctorCredential = await apiJson(`/onboarding/${doctorOnboarding.id}/credentials`, {
    method: "POST",
    headers: doctorHeaders,
    body: JSON.stringify({ type: "medical-license", number: "B2-MED-OLD", issuer: "B2 Medical Council", validUntil: "2031-12-31" }),
  });
  await apiJson(`/onboarding/${doctorOnboarding.id}/submit`, { method: "POST", headers: doctorHeaders, body: JSON.stringify({}) });

  const requiredTypes = Array.isArray(category.requiredCredentialTypes)
    ? category.requiredCredentialTypes.filter((item) => typeof item === "string" && item.trim())
    : [];
  const otherTypes = requiredTypes.length > 0 ? requiredTypes : ["operating-license"];
  const otherOnboarding = await apiJson("/onboarding/other-providers", {
    method: "POST",
    headers: otherHeaders,
    body: JSON.stringify({ providerCategoryId: category.id }),
  });
  for (const [index, type] of otherTypes.entries()) {
    await apiJson(`/onboarding/${otherOnboarding.id}/credentials`, {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({ type, number: `B2-OTHER-${index + 1}`, issuer: "B2 Provider Authority", validUntil: "2031-12-31" }),
    });
  }
  await apiJson(`/onboarding/${otherOnboarding.id}/submit`, { method: "POST", headers: otherHeaders, body: JSON.stringify({}) });

  const initialQueue = await webJson("/api/admin/governance/onboarding", {}, jar);
  assert(initialQueue.response.status === 200 && Array.isArray(initialQueue.payload), `B2 queue failed: ${initialQueue.text}`);
  assertNoBearerMaterial(initialQueue.payload, "B2 review queue");
  assert(initialQueue.payload.some((item) => item.id === doctorOnboarding.id && item.state === "PENDING_REVIEW" && item.provider?.status === "PENDING_REVIEW"), "Doctor onboarding was not visible in the live Admin queue.");
  assert(initialQueue.payload.some((item) => item.id === otherOnboarding.id && item.state === "PENDING_REVIEW" && item.provider?.status === "PENDING_REVIEW"), "Other-provider onboarding was not visible in the live Admin queue.");

  const forged = await webJson("/api/admin/governance/onboarding/action", {
    method: "POST",
    headers: { origin: "https://evil.example" },
    body: JSON.stringify({ action: "request-changes", onboardingId: otherOnboarding.id, note: "forged cross-origin decision" }),
  }, jar);
  assert(forged.response.status === 403, `Cross-origin governance mutation should be denied, got ${forged.response.status}.`);
  const untouchedOther = await prisma.providerOnboarding.findUnique({ where: { id: otherOnboarding.id } });
  assert(untouchedOther?.state === "PENDING_REVIEW", "Cross-origin governance request mutated onboarding state.");

  const rejectOldCredential = await webJson("/api/admin/governance/onboarding/action", {
    method: "POST",
    body: JSON.stringify({ action: "credential-reject", onboardingId: doctorOnboarding.id, credentialId: oldDoctorCredential.id, note: "License evidence must be replaced with the corrected registration." }),
  }, jar);
  assert(rejectOldCredential.response.status === 201 || rejectOldCredential.response.status === 200, `Credential rejection failed: ${rejectOldCredential.text}`);
  assertNoBearerMaterial(rejectOldCredential.payload, "Credential rejection");
  const doctorChanges = await prisma.providerOnboarding.findUnique({ where: { id: doctorOnboarding.id } });
  const doctorProviderAfterReject = await prisma.provider.findUnique({ where: { userId: doctorAccount.id } });
  assert(doctorChanges?.state === "REQUEST_CHANGES" && doctorProviderAfterReject?.status === "DRAFT", "Rejected credential did not return the doctor onboarding for changes.");

  const correctedCredential = await apiJson(`/onboarding/${doctorOnboarding.id}/credentials`, {
    method: "POST",
    headers: doctorHeaders,
    body: JSON.stringify({ type: "medical-license", number: "B2-MED-CORRECTED", issuer: "B2 Medical Council", validUntil: "2032-12-31", documentId: "b2-corrected-license" }),
  });
  await apiJson(`/onboarding/${doctorOnboarding.id}/submit`, { method: "POST", headers: doctorHeaders, body: JSON.stringify({}) });

  const verifyCorrected = await webJson("/api/admin/governance/onboarding/action", {
    method: "POST",
    body: JSON.stringify({ action: "credential-verify", onboardingId: doctorOnboarding.id, credentialId: correctedCredential.id, note: "Verified against corrected registry evidence." }),
  }, jar);
  assert(verifyCorrected.response.ok, `Corrected credential verification failed: ${verifyCorrected.text}`);

  const approveDoctor = await webJson("/api/admin/governance/onboarding/action", {
    method: "POST",
    body: JSON.stringify({ action: "approve", onboardingId: doctorOnboarding.id }),
  }, jar);
  assert(approveDoctor.response.ok && approveDoctor.payload.state === "APPROVED", `Doctor approval failed: ${approveDoctor.text}`);
  assertNoBearerMaterial(approveDoctor.payload, "Doctor approval");

  const approvedDoctor = await prisma.providerOnboarding.findUnique({ where: { id: doctorOnboarding.id }, include: { credentials: true } });
  const activeDoctorProvider = await prisma.provider.findUnique({ where: { userId: doctorAccount.id }, include: { doctorProfile: true, credentials: true } });
  assert(approvedDoctor?.state === "APPROVED" && activeDoctorProvider?.status === "ACTIVE", "Approved doctor was not activated.");
  assert(approvedDoctor.credentials.some((item) => item.id === oldDoctorCredential.id && item.state === "REJECTED"), "Rejected credential history was not preserved after correction.");
  assert(approvedDoctor.credentials.some((item) => item.id === correctedCredential.id && item.state === "VERIFIED"), "Corrected credential was not preserved as verified evidence.");
  assert(activeDoctorProvider.doctorProfile?.licenseNumber === "B2-MED-CORRECTED", "Doctor profile did not use the latest verified medical license.");
  assert(activeDoctorProvider.credentials.some((item) => item.number === "B2-MED-CORRECTED" && item.status === "VERIFIED"), "Verified onboarding evidence was not promoted to the operational Provider credential register.");

  const requestOtherChanges = await webJson("/api/admin/governance/onboarding/action", {
    method: "POST",
    body: JSON.stringify({ action: "request-changes", onboardingId: otherOnboarding.id, note: "Please clarify the operating coverage before activation." }),
  }, jar);
  assert(requestOtherChanges.response.ok && requestOtherChanges.payload.state === "REQUEST_CHANGES", `Request changes failed: ${requestOtherChanges.text}`);
  const otherProviderDraft = await prisma.provider.findUnique({ where: { userId: otherAccount.id } });
  assert(otherProviderDraft?.status === "DRAFT", "Request changes did not return the provider to DRAFT.");

  await apiJson(`/onboarding/${otherOnboarding.id}/submit`, { method: "POST", headers: otherHeaders, body: JSON.stringify({}) });
  const rejectOther = await webJson("/api/admin/governance/onboarding/action", {
    method: "POST",
    body: JSON.stringify({ action: "reject", onboardingId: otherOnboarding.id, note: "Application rejected after governance review of the submitted operating model." }),
  }, jar);
  assert(rejectOther.response.ok && rejectOther.payload.state === "REJECTED", `Terminal onboarding rejection failed: ${rejectOther.text}`);
  const rejectedOtherProvider = await prisma.provider.findUnique({ where: { userId: otherAccount.id } });
  assert(rejectedOtherProvider?.status === "REJECTED", "Terminal onboarding rejection did not mark the Provider as REJECTED.");

  const revokedProviderAccess = await api("/onboarding/provider-access/me", { headers: otherHeaders });
  assert(revokedProviderAccess.response.status === 401, `Rejected provider session should be revoked, got ${revokedProviderAccess.response.status}.`);

  const auditEvents = await prisma.auditEvent.findMany({
    where: { objectId: { in: [doctorOnboarding.id, otherOnboarding.id, oldDoctorCredential.id, correctedCredential.id] } },
    select: { action: true, objectId: true, result: true },
  });
  const auditActions = new Set(auditEvents.filter((item) => item.result === "SUCCESS").map((item) => item.action));
  for (const action of ["CREDENTIAL_REVIEWED", "ONBOARDING_APPROVED", "ONBOARDING_CHANGES_REQUESTED", "ONBOARDING_REJECTED"]) {
    assert(auditActions.has(action), `B2 audit trail is missing ${action}.`);
  }

  const finalQueue = await webJson("/api/admin/governance/onboarding", {}, jar);
  assert(finalQueue.response.ok && Array.isArray(finalQueue.payload), "Final B2 queue could not be loaded.");
  assert(finalQueue.payload.some((item) => item.id === doctorOnboarding.id && item.state === "APPROVED" && item.provider?.status === "ACTIVE"), "Final queue did not reflect approved doctor state.");
  assert(finalQueue.payload.some((item) => item.id === otherOnboarding.id && item.state === "REJECTED" && item.provider?.status === "REJECTED"), "Final queue did not reflect rejected other-provider state.");
  assertNoBearerMaterial(finalQueue.payload, "Final B2 review queue");

  const doctorsPage = await web("/doctors", {}, jar);
  const providersPage = await web("/providers", {}, jar);
  assert(doctorsPage.status === 200 && providersPage.status === 200, "Authenticated Admin could not reach the live governance pages.");

  console.log(JSON.stringify({
    status: "passed",
    phase: "B2",
    liveReviewQueue: true,
    roleIsolation: true,
    sameOriginMutationGuard: true,
    credentialCorrectionHistory: true,
    requestChanges: true,
    terminalRejection: true,
    rejectionRevokesSessions: true,
    verifiedCredentialPromotion: true,
    auditableDecisions: true,
    bearerTokensHiddenFromBrowserJson: true,
  }));
} finally {
  await cleanupFixtures().catch(() => undefined);
  await prisma.$disconnect();
}
