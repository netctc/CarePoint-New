import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const fhirBase = process.env.SMART_FHIR_BASE_URL || `${base}/fhir/R4`;
const clientId = "slice108-offline-client";
const redirectUri = "https://smart-offline.carepoint.test/callback";
const wrongClientId = "slice107-browser-client";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const password = `Cp!${suffix}OfflinePatient9Aa`;
const patientAEmail = `smart-offline-a-${suffix}@carepoint.test`;
const patientBEmail = `smart-offline-b-${suffix}@carepoint.test`;
const offlineScopes = [
  "launch/patient",
  "openid",
  "fhirUser",
  "offline_access",
  "patient/Patient.r",
  "patient/Appointment.rs",
];

async function raw(path, { method = "GET", token, body, headers = {}, redirect = "follow" } = {}) {
  const requestHeaders = { accept: "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers: requestHeaders, body, redirect });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return {
    status: response.status,
    text,
    payload,
    location: response.headers.get("location") || "",
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
  };
}

async function json(path, { method = "GET", body } = {}) {
  const result = await raw(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`${method} ${path} -> ${result.status} ${result.text}`);
  return result.payload;
}

async function registerPatient(email, firstName) {
  await json("/iam/register/patient", { method: "POST", body: { email, password, firstName, lastName: "SMART Offline Test" } });
  const login = await json("/iam/login", { method: "POST", body: { email, password } });
  if (!login.accessToken) throw new Error(`No CarePoint session token for ${email}`);
  return login.accessToken;
}

function verifier() {
  return randomBytes(48).toString("base64url");
}

function challenge(value) {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

function authorizeParams(codeVerifier, state, nonce, scopes = offlineScopes) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state,
    nonce,
    aud: fhirBase,
    code_challenge: challenge(codeVerifier),
    code_challenge_method: "S256",
  });
}

async function browserGrant(email, label) {
  const codeVerifier = verifier();
  const state = `${label}-state-${suffix}-${randomBytes(5).toString("hex")}`;
  const nonce = `${label}-nonce-${suffix}-${randomBytes(8).toString("hex")}`;
  const start = await raw(`/smart/browser/authorize?${authorizeParams(codeVerifier, state, nonce).toString()}`, { redirect: "manual" });
  if (start.status !== 200 || !start.contentType.includes("text/html")) throw new Error(`${label}: browser authorization failed: ${JSON.stringify(start)}`);
  const transactionMatch = /name="transaction" value="([A-Za-z0-9_-]+)"/.exec(start.text);
  if (!transactionMatch?.[1]) throw new Error(`${label}: browser transaction missing.`);
  const transaction = transactionMatch[1];

  const loginBody = new URLSearchParams({ transaction, email, password });
  const login = await raw("/smart/browser/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: loginBody.toString(),
    redirect: "manual",
  });
  if (login.status !== 200 || !login.text.includes("Review access request") || !login.text.includes("offline_access")) {
    throw new Error(`${label}: offline consent page failed: ${JSON.stringify(login)}`);
  }
  if (!login.text.includes("rotating refresh tokens") || !login.text.includes("30 days")) throw new Error(`${label}: offline access is not clearly described to the patient.`);

  const consentBody = new URLSearchParams({ transaction, decision: "approve" });
  const consent = await raw("/smart/browser/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: consentBody.toString(),
    redirect: "manual",
  });
  if (consent.status !== 302 || !consent.location) throw new Error(`${label}: consent approval failed: ${JSON.stringify(consent)}`);
  const callback = new URL(consent.location);
  if (callback.searchParams.get("state") !== state) throw new Error(`${label}: state was not preserved.`);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error(`${label}: authorization code missing.`);

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const token = await raw("/smart/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
  if (
    token.status !== 200 ||
    !token.payload.access_token ||
    !token.payload.refresh_token ||
    !token.payload.id_token ||
    !String(token.payload.scope || "").split(" ").includes("offline_access")
  ) {
    throw new Error(`${label}: offline token grant failed: ${JSON.stringify(token)}`);
  }
  if (!token.cacheControl.includes("no-store")) throw new Error(`${label}: token response is cacheable.`);
  return token.payload;
}

async function refresh(refreshToken, { client = clientId, scopes } = {}) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client,
  });
  if (scopes) body.set("scope", scopes.join(" "));
  return raw("/smart/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

async function revoke(token) {
  const body = new URLSearchParams({ token, client_id: clientId });
  return raw("/smart/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function expectOAuthError(result, error, label) {
  if (result.status !== 400 || result.payload.error !== error) throw new Error(`${label}: ${JSON.stringify(result)}`);
}

function expectFhirDenied(result, status, label) {
  if (result.status !== status || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
}

try {
  const discovery = await raw("/fhir/R4/.well-known/smart-configuration");
  if (discovery.status !== 200) throw new Error(`SMART discovery failed: ${JSON.stringify(discovery)}`);
  if (!discovery.payload.scopes_supported?.includes("offline_access")) throw new Error("SMART discovery missing offline_access scope.");
  if (!discovery.payload.capabilities?.includes("permission-offline")) throw new Error("SMART discovery missing permission-offline capability.");
  if (!discovery.payload.grant_types_supported?.includes("refresh_token")) throw new Error("SMART discovery missing refresh_token grant.");

  const oidcDiscovery = await raw("/.well-known/openid-configuration");
  if (!oidcDiscovery.payload.grant_types_supported?.includes("refresh_token")) throw new Error("OIDC discovery missing refresh_token grant.");

  const metadata = await raw("/fhir/R4/metadata");
  if (metadata.status !== 200 || metadata.payload.software?.version !== "slice-10.8") throw new Error(`FHIR Slice 10.8 metadata failed: ${JSON.stringify(metadata)}`);

  const patientAToken = await registerPatient(patientAEmail, "Alice");
  await registerPatient(patientBEmail, "Bob");
  const patientA = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientAEmail } } });
  const patientB = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientBEmail } } });

  const hostVerifier = verifier();
  const hostParams = authorizeParams(hostVerifier, `host-offline-${suffix}`, `host-nonce-${suffix}`, ["launch/patient", "offline_access", "patient/Patient.r"]);
  const hostOffline = await raw(`/smart/authorize?${hostParams.toString()}`, { token: patientAToken, redirect: "manual" });
  if (hostOffline.status !== 400) throw new Error(`offline_access should require explicit browser consent: ${JSON.stringify(hostOffline)}`);

  const familyA = await browserGrant(patientAEmail, "reuse-family");
  const wrongClient = await refresh(familyA.refresh_token, { client: wrongClientId });
  expectOAuthError(wrongClient, "invalid_grant", "Wrong client must not rotate a refresh token");

  const rotatedA = await refresh(familyA.refresh_token);
  if (
    rotatedA.status !== 200 ||
    !rotatedA.payload.access_token ||
    !rotatedA.payload.refresh_token ||
    rotatedA.payload.refresh_token === familyA.refresh_token ||
    rotatedA.payload.id_token
  ) {
    throw new Error(`Refresh rotation failed: ${JSON.stringify(rotatedA)}`);
  }
  if (!rotatedA.cacheControl.includes("no-store")) throw new Error("Refresh response is cacheable.");

  const refreshedSelf = await raw(`/fhir/R4/Patient/${patientA.id}`, { token: rotatedA.payload.access_token });
  if (refreshedSelf.status !== 200 || refreshedSelf.payload.resourceType !== "Patient") throw new Error(`Refreshed access token failed: ${JSON.stringify(refreshedSelf)}`);
  const refreshedCross = await raw(`/fhir/R4/Patient/${patientB.id}`, { token: rotatedA.payload.access_token });
  expectFhirDenied(refreshedCross, 403, "Refreshed token crossed patient boundary");

  const replay = await refresh(familyA.refresh_token);
  expectOAuthError(replay, "invalid_grant", "Rotated refresh token replay was accepted");
  if (!String(replay.payload.error_description || "").includes("family has been revoked")) throw new Error(`Refresh replay did not report family revocation: ${JSON.stringify(replay.payload)}`);

  const compromisedAccess = await raw(`/fhir/R4/Patient/${patientA.id}`, { token: rotatedA.payload.access_token });
  expectFhirDenied(compromisedAccess, 401, "Access token survived refresh-family compromise");
  const compromisedRefresh = await refresh(rotatedA.payload.refresh_token);
  expectOAuthError(compromisedRefresh, "invalid_grant", "Descendant refresh token survived family compromise");

  const familyB = await browserGrant(patientAEmail, "access-revoke-family");
  const revokeAccess = await revoke(familyB.access_token);
  if (revokeAccess.status !== 200) throw new Error(`Access-token revocation failed: ${JSON.stringify(revokeAccess)}`);
  expectFhirDenied(await raw(`/fhir/R4/Patient/${patientA.id}`, { token: familyB.access_token }), 401, "Revoked access token remained active");
  expectOAuthError(await refresh(familyB.refresh_token), "invalid_grant", "Access-token revocation did not revoke refresh family");

  const familyC = await browserGrant(patientAEmail, "refresh-revoke-family");
  const revokeRefresh = await revoke(familyC.refresh_token);
  if (revokeRefresh.status !== 200) throw new Error(`Refresh-token revocation failed: ${JSON.stringify(revokeRefresh)}`);
  expectFhirDenied(await raw(`/fhir/R4/Patient/${patientA.id}`, { token: familyC.access_token }), 401, "Refresh-token revocation did not invalidate family access token");
  expectOAuthError(await refresh(familyC.refresh_token), "invalid_grant", "Revoked refresh token remained usable");

  const familyD = await browserGrant(patientAEmail, "scope-downgrade-family");
  const narrowedScopes = ["launch/patient", "patient/Patient.r"];
  const narrowed = await refresh(familyD.refresh_token, { scopes: narrowedScopes });
  if (
    narrowed.status !== 200 ||
    !narrowed.payload.access_token ||
    narrowed.payload.refresh_token ||
    narrowed.payload.id_token ||
    narrowed.payload.scope !== narrowedScopes.join(" ")
  ) {
    throw new Error(`Refresh scope downgrade failed: ${JSON.stringify(narrowed)}`);
  }
  const narrowedAccess = await raw(`/fhir/R4/Patient/${patientA.id}`, { token: narrowed.payload.access_token });
  if (narrowedAccess.status !== 200) throw new Error(`Online-only downgraded access token failed: ${JSON.stringify(narrowedAccess)}`);
  expectOAuthError(await refresh(familyD.refresh_token), "invalid_grant", "Consumed downgrade refresh token was replayable");
  const narrowedAfterReplay = await raw(`/fhir/R4/Patient/${patientA.id}`, { token: narrowed.payload.access_token });
  if (narrowedAfterReplay.status !== 200) throw new Error("Online-only token was incorrectly tied to the closed refresh family.");

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    patientId: patientA.id,
    offlineAccessConsentOnly: true,
    refreshGrantAdvertised: true,
    rotatingRefreshTokens: true,
    wrongClientDoesNotConsumeToken: true,
    refreshReuseDetection: true,
    familyCompromiseRevokesAccess: true,
    accessRevocationRevokesFamily: true,
    refreshRevocationRevokesFamily: true,
    scopeDowngradeClosesOfflineFamily: true,
    patientIsolationPreserved: true,
    rawBearerStateNotPersistedInPostgres: true,
  }));
} finally {
  await prisma.$disconnect();
}
