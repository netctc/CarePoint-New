import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const password = process.env.SLICE6_PATIENT_PASSWORD;
if (!password) throw new Error("SLICE6_PATIENT_PASSWORD is required for Other Provider O1 acceptance.");

const prisma = new PrismaClient();
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const providerEmail = `provider-o1-${stamp}@carepoint.test`;
const adminEmail = `provider-o1-admin-${stamp}@carepoint.test`;
const patientEmail = `provider-o1-patient-${stamp}@carepoint.test`;
const fixtureEmails = [providerEmail, adminEmail, patientEmail];
let fixtureUserIds = [];

function assert(ok, message) { if (!ok) throw new Error(message); }
function strings(value) { return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []; }

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
  return { response, payload, text };
}

async function login(email) {
  const result = await call("/iam/login", { method: "POST", body: { email, password }, expected: 201 });
  assert(result.payload.accessToken, `O1 login did not issue an access token for ${email}.`);
  return result.payload.accessToken;
}

function assertSelfStateSanitized(payload, label) {
  const text = JSON.stringify(payload);
  for (const forbidden of ["userId", "reviewerActorId", "reviewedByActorId", "passwordHash", "refreshTokenHash", "accessToken", "refreshToken"]) {
    assert(!text.includes(`\"${forbidden}\"`), `${label} leaked forbidden field ${forbidden}.`);
  }
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
    prisma.user.create({ data: { email: providerEmail, passwordHash, role: "OTHER_PROVIDER" }, select: { id: true } }),
    prisma.user.create({ data: { email: adminEmail, passwordHash, role: "ADMIN" }, select: { id: true } }),
    prisma.user.create({ data: { email: patientEmail, passwordHash, role: "PATIENT" }, select: { id: true } }),
  ]);
  fixtureUserIds = created.map((item) => item.id);
  const [providerUserId] = fixtureUserIds;

  let providerToken = await login(providerEmail);
  const adminToken = await login(adminEmail);
  const patientToken = await login(patientEmail);

  const fresh = (await call("/onboarding/me", { token: providerToken, expected: 200 })).payload;
  assert(fresh.kind === "OTHER_PROVIDER" && fresh.provider === null && fresh.onboarding === null && fresh.accessReady === false,
    "O1 fresh provider self-state is incorrect.");
  assertSelfStateSanitized(fresh, "O1 fresh self-state");
  await call("/onboarding/me", { token: patientToken, expected: 403 });

  const catalog = (await call("/other-provider-categories", { expected: 200 })).payload;
  assert(catalog.excludesDoctors === true && Array.isArray(catalog.items), "O1 Other Provider taxonomy boundary is missing.");
  const category = catalog.items.find((item) => item?.active !== false && item?.id);
  assert(category, "O1 requires at least one active Other Provider category.");
  const requiredTypes = strings(category.requiredCredentialTypes);
  const credentialTypes = requiredTypes.length > 0 ? requiredTypes : ["professional-license"];

  const onboarding = (await call("/onboarding/other-providers", {
    method: "POST",
    token: providerToken,
    body: { providerCategoryId: category.id },
    expected: 201,
  })).payload;
  assert(onboarding.id && onboarding.kind === "OTHER_PROVIDER" && onboarding.state === "DRAFT", "O1 onboarding did not start in DRAFT.");

  let state = (await call("/onboarding/me", { token: providerToken, expected: 200 })).payload;
  assert(state.provider?.status === "DRAFT" && state.onboarding?.providerCategory?.id === category.id && state.accessReady === false,
    "O1 self-state did not expose the owned category application.");
  assertSelfStateSanitized(state, "O1 draft self-state");

  const credentials = [];
  for (let index = 0; index < credentialTypes.length; index += 1) {
    const type = credentialTypes[index];
    const value = (await call(`/onboarding/${onboarding.id}/credentials`, {
      method: "POST",
      token: providerToken,
      body: {
        type,
        number: `O1-${index + 1}-${stamp}`,
        issuer: "CarePoint O1 Credential Authority",
        validUntil: "2032-12-31",
      },
      expected: 201,
    })).payload;
    assert(value.id && value.type === type.toLowerCase(), `O1 credential ${type} was not persisted.`);
    credentials.push(value);
  }

  await call(`/onboarding/${onboarding.id}/submit`, { method: "POST", token: providerToken, body: {}, expected: 201 });
  state = (await call("/onboarding/me", { token: providerToken, expected: 200 })).payload;
  assert(state.provider?.status === "PENDING_REVIEW" && state.onboarding?.state === "PENDING_REVIEW" && state.accessReady === false,
    "O1 pending review state did not round-trip.");

  for (const credential of credentials) {
    await call(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, {
      method: "POST",
      token: adminToken,
      body: { state: "VERIFIED" },
      expected: 201,
    });
  }
  await call(`/onboarding/${onboarding.id}/approve`, { method: "POST", token: adminToken, body: {}, expected: 201 });

  state = (await call("/onboarding/me", { token: providerToken, expected: 200 })).payload;
  assert(state.accessReady === true && state.provider?.status === "ACTIVE" && state.onboarding?.state === "APPROVED",
    "O1 approved Other Provider did not become access-ready.");
  assert(state.onboarding?.providerCategory?.id === category.id, "O1 approved self-state lost provider category.");
  assertSelfStateSanitized(state, "O1 approved self-state");

  const profile = await prisma.otherProviderProfile.findFirst({ where: { provider: { userId: providerUserId } }, include: { category: true } });
  assert(profile?.categoryId === category.id, "O1 approval did not promote the Other Provider profile category.");

  const activeRestart = await call("/onboarding/other-providers", {
    method: "POST",
    token: providerToken,
    body: { providerCategoryId: category.id },
    expected: 409,
  });
  assert(/active provider cannot restart onboarding/i.test(activeRestart.text), "O1 ACTIVE restart guard is missing.");

  await call(`/onboarding/provider-access/${providerUserId}/suspend`, { method: "POST", token: adminToken, body: {}, expected: 201 });
  await call("/onboarding/me", { token: providerToken, expected: 401 });
  providerToken = await login(providerEmail);
  state = (await call("/onboarding/me", { token: providerToken, expected: 200 })).payload;
  assert(state.provider?.status === "SUSPENDED" && state.accessReady === false && state.onboarding?.state === "APPROVED",
    "O1 suspended provider self-state is incorrect.");

  const suspendedRestart = await call("/onboarding/other-providers", {
    method: "POST",
    token: providerToken,
    body: { providerCategoryId: category.id },
    expected: 409,
  });
  assert(/suspended provider cannot restart onboarding/i.test(suspendedRestart.text), "O1 SUSPENDED restart guard is missing.");

  const auditActions = await prisma.auditEvent.findMany({
    where: {
      OR: [
        { actorId: { in: fixtureUserIds } },
        { objectId: { in: [onboarding.id, ...credentials.map((item) => item.id)] } },
      ],
    },
    select: { action: true },
  });
  const actions = new Set(auditActions.map((item) => item.action));
  for (const action of ["OTHER_PROVIDER_ONBOARDING_STARTED", "ONBOARDING_CREDENTIAL_ADDED", "ONBOARDING_SUBMITTED", "CREDENTIAL_REVIEWED", "ONBOARDING_APPROVED", "PROVIDER_SUSPENDED"]) {
    assert(actions.has(action), `O1 audit trail is missing ${action}.`);
  }

  console.log(JSON.stringify({
    status: "passed",
    phase: "Other-Provider-O1",
    isolatedFixtureAccounts: true,
    categoryTaxonomyExcludesDoctors: true,
    providerSelfState: true,
    roleIsolation: true,
    selfStateMinimized: true,
    requiredCredentialTypesHonored: true,
    pendingReviewGate: true,
    adminApprovalToActive: true,
    otherProviderProfilePromotion: true,
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
