import { PrismaClient } from "@prisma/client";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const prisma = new PrismaClient();
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const futureDate = "2035-12-31";
const expiredDate = "2000-01-01";

function assert(ok, message) {
  if (!ok) throw new Error(message);
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
  if (allowed) assert(allowed.includes(response.status), `${method} ${path} expected ${allowed.join("/")} but got ${response.status}: ${text}`);
  else assert(response.ok, `${method} ${path} failed ${response.status}: ${text}`);
  return { status: response.status, payload, text };
}

async function login(email, password) {
  const result = await call("/iam/login", { method: "POST", body: { email, password }, expected: 201 });
  assert(result.payload.accessToken, `Login did not issue an access token for ${email}.`);
  return result.payload.accessToken;
}

async function createProviderAccount(adminToken, role, label) {
  const email = `r9-credential-${label}-${suffix}@carepoint.test`;
  const password = `CarePoint-R9-${label}#2026`;
  await call("/iam/accounts", { method: "POST", token: adminToken, body: { email, password, role }, expected: 201 });
  const token = await login(email, password);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { email, password, token, accountId: user.id };
}

async function doctorOnboarding(adminToken, doctor, specialtyId, validUntil, label) {
  const onboarding = (await call("/onboarding/doctors", {
    method: "POST",
    token: doctor.token,
    body: { specialtyId },
    expected: 201,
  })).payload;
  const credential = (await call(`/onboarding/${onboarding.id}/credentials`, {
    method: "POST",
    token: doctor.token,
    body: {
      type: "medical-license",
      number: `R9-MED-${label}-${suffix}`,
      issuer: "CarePoint R9 Synthetic Authority",
      validUntil,
    },
    expected: 201,
  })).payload;
  await call(`/onboarding/${onboarding.id}/submit`, { method: "POST", token: doctor.token, body: {}, expected: 201 });
  await call(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, {
    method: "POST",
    token: adminToken,
    body: { state: "VERIFIED" },
    expected: 201,
  });
  return { onboarding, credential };
}

async function otherProviderOnboarding(adminToken, provider, categoryId, credentialType, validUntil, label) {
  const onboarding = (await call("/onboarding/other-providers", {
    method: "POST",
    token: provider.token,
    body: { providerCategoryId: categoryId },
    expected: 201,
  })).payload;
  const credential = (await call(`/onboarding/${onboarding.id}/credentials`, {
    method: "POST",
    token: provider.token,
    body: {
      type: credentialType,
      number: `R9-OP-${label}-${suffix}`,
      issuer: "CarePoint R9 Synthetic Authority",
      validUntil,
    },
    expected: 201,
  })).payload;
  await call(`/onboarding/${onboarding.id}/submit`, { method: "POST", token: provider.token, body: {}, expected: 201 });
  await call(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, {
    method: "POST",
    token: adminToken,
    body: { state: "VERIFIED" },
    expected: 201,
  });
  return { onboarding, credential };
}

async function createClinicService(token, label, expected = 201) {
  return call("/provider/services", {
    method: "POST",
    token,
    body: {
      labels: {
        en: `R9 credential service ${label}`,
        ar: `خدمة اعتماد R9 ${label}`,
        fr: `Service de credential R9 ${label}`,
        es: `Servicio de credencial R9 ${label}`,
      },
      currency: "USD",
      modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 5000 }],
    },
    expected,
  });
}

async function main() {
  const adminEmail = "admin-ci@carepoint.test";
  const adminToken = await login(adminEmail, "CarePoint-CI-Admin#2026");
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
  const specialties = (await call("/doctors/specialties", { expected: 200 })).payload;
  const specialtyId = specialties.items?.[0]?.id;
  assert(specialtyId, "R9 credential acceptance requires at least one active medical specialty.");

  const expiredDoctor = await createProviderAccount(adminToken, "DOCTOR", "expired-doctor");
  const expiredDoctorFlow = await doctorOnboarding(adminToken, expiredDoctor, specialtyId, expiredDate, "expired");
  const expiredDoctorApproval = await call(`/onboarding/${expiredDoctorFlow.onboarding.id}/approve`, {
    method: "POST",
    token: adminToken,
    body: {},
    expected: 400,
  });
  assert(/missing current verified credential types/i.test(expiredDoctorApproval.text), "Expired Doctor credential was not rejected at activation.");
  const expiredDoctorProvider = await prisma.provider.findUniqueOrThrow({ where: { userId: expiredDoctor.accountId } });
  assert(expiredDoctorProvider.status === "PENDING_REVIEW", "Rejected expired Doctor activation unexpectedly changed provider status.");

  const doctor = await createProviderAccount(adminToken, "DOCTOR", "runtime-doctor");
  const doctorFlow = await doctorOnboarding(adminToken, doctor, specialtyId, futureDate, "runtime");
  await call(`/onboarding/${doctorFlow.onboarding.id}/approve`, { method: "POST", token: adminToken, body: {}, expected: 201 });
  await createClinicService(doctor.token, "doctor-before-expiry");

  const doctorProvider = await prisma.provider.findUniqueOrThrow({ where: { userId: doctor.accountId } });
  const doctorCredential = await prisma.providerCredential.findFirstOrThrow({
    where: { providerId: doctorProvider.id, type: "medical-license", status: "VERIFIED" },
    orderBy: { createdAt: "desc" },
  });
  await prisma.providerCredential.update({ where: { id: doctorCredential.id }, data: { validUntil: new Date("2000-01-01T00:00:00.000Z") } });
  const expiredDoctorOperation = await createClinicService(doctor.token, "doctor-expired", 403);
  assert(/current verified provider credentials are required/i.test(expiredDoctorOperation.text), "Expired Doctor operational denial did not use the credential gate.");
  const remediationAccess = await call("/onboarding/provider-access/me", { token: doctor.token, expected: 200 });
  assert(remediationAccess.payload.status === "ACTIVE", "Credential expiry must deny operations without hiding self-service remediation state.");
  await prisma.providerCredential.update({ where: { id: doctorCredential.id }, data: { validUntil: new Date("2035-12-31T00:00:00.000Z") } });
  await createClinicService(doctor.token, "doctor-after-renewal");

  const credentialType = "professional-license";
  const category = await prisma.providerCategory.create({
    data: {
      slug: `r9-credential-category-${suffix}`,
      labels: { en: "R9 Synthetic Allied Health", ar: "مزود صحي تجريبي R9", fr: "Prestataire synthetique R9", es: "Proveedor sintetico R9" },
      family: "ALLIED_HEALTH",
      active: true,
      requiredCredentialTypes: [credentialType],
      capabilities: { enabledModalities: ["CLINIC"], clinicalOrderCapabilities: [] },
    },
  });

  const expiredOther = await createProviderAccount(adminToken, "OTHER_PROVIDER", "expired-other");
  const expiredOtherFlow = await otherProviderOnboarding(adminToken, expiredOther, category.id, credentialType, expiredDate, "expired");
  const expiredOtherApproval = await call(`/onboarding/${expiredOtherFlow.onboarding.id}/approve`, {
    method: "POST",
    token: adminToken,
    body: {},
    expected: 400,
  });
  assert(/missing current verified credential types/i.test(expiredOtherApproval.text), "Expired Other Provider credential was not rejected at activation.");

  const other = await createProviderAccount(adminToken, "OTHER_PROVIDER", "runtime-other");
  const otherFlow = await otherProviderOnboarding(adminToken, other, category.id, credentialType, futureDate, "runtime");
  await call(`/onboarding/${otherFlow.onboarding.id}/approve`, { method: "POST", token: adminToken, body: {}, expected: 201 });
  await createClinicService(other.token, "other-before-expiry");
  const otherProvider = await prisma.provider.findUniqueOrThrow({ where: { userId: other.accountId } });
  const otherCredential = await prisma.providerCredential.findFirstOrThrow({
    where: { providerId: otherProvider.id, type: credentialType, status: "VERIFIED" },
    orderBy: { createdAt: "desc" },
  });
  await prisma.providerCredential.update({ where: { id: otherCredential.id }, data: { validUntil: new Date("2000-01-01T00:00:00.000Z") } });
  const expiredOtherOperation = await createClinicService(other.token, "other-expired", 403);
  assert(/current verified provider credentials are required/i.test(expiredOtherOperation.text), "Expired Other Provider operational denial did not use the credential gate.");
  await call("/onboarding/me", { token: other.token, expected: 200 });

  const governanceAudits = await prisma.auditEvent.findMany({
    where: {
      action: { in: ["PROVIDER_APPROVAL_DENIED_CREDENTIAL_VALIDITY", "PROVIDER_OPERATIONAL_ACCESS_DENIED"] },
      OR: [
        { actorId: { in: [admin.id, doctor.accountId, other.accountId] } },
        { objectId: { in: [expiredDoctorFlow.onboarding.id, expiredOtherFlow.onboarding.id] } },
      ],
    },
    orderBy: { occurredAt: "desc" },
  });
  const actions = new Set(governanceAudits.map((event) => event.action));
  assert(actions.has("PROVIDER_APPROVAL_DENIED_CREDENTIAL_VALIDITY"), "R9 credential activation denial audit is missing.");
  assert(actions.has("PROVIDER_OPERATIONAL_ACCESS_DENIED"), "R9 runtime credential denial audit is missing.");
  const auditDump = JSON.stringify(governanceAudits);
  assert(!auditDump.includes(`R9-MED-runtime-${suffix}`), "Credential number leaked into governance denial audit.");
  assert(!auditDump.includes(`R9-OP-runtime-${suffix}`), "Other Provider credential number leaked into governance denial audit.");

  console.log(JSON.stringify({
    status: "passed",
    policyNeutral: true,
    doctorExpiredActivationDenied: true,
    doctorRuntimeExpiryDenied: true,
    doctorSelfRemediationAccessPreserved: true,
    doctorRenewalRestoresOperations: true,
    otherProviderExpiredActivationDenied: true,
    otherProviderRuntimeExpiryDenied: true,
    denialAuditMinimized: true,
  }));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
