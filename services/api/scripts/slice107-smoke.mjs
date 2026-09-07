import { PrismaClient } from "@prisma/client";
import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const fhirBase = process.env.SMART_FHIR_BASE_URL || `${base}/fhir/R4`;
const clientId = "slice107-browser-client";
const redirectUri = "https://smart-browser.carepoint.test/callback";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const password = `Cp!${suffix}BrowserPatient9Aa`;
const patientAEmail = `smart-browser-a-${suffix}@carepoint.test`;
const patientBEmail = `smart-browser-b-${suffix}@carepoint.test`;

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
    pragma: response.headers.get("pragma") || "",
    csp: response.headers.get("content-security-policy") || "",
    frame: response.headers.get("x-frame-options") || "",
    referrer: response.headers.get("referrer-policy") || "",
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
  await json("/iam/register/patient", { method: "POST", body: { email, password, firstName, lastName: "SMART Browser Test" } });
}

function verifier() {
  return randomBytes(48).toString("base64url");
}

function challenge(value) {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

function authorizationParams(codeVerifier, state, nonce) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "launch/patient openid fhirUser patient/Patient.r patient/Appointment.rs",
    state,
    nonce,
    aud: fhirBase,
    code_challenge: challenge(codeVerifier),
    code_challenge_method: "S256",
  });
}

async function beginBrowser(codeVerifier, state, nonce) {
  const result = await raw(`/smart/browser/authorize?${authorizationParams(codeVerifier, state, nonce).toString()}`, { redirect: "manual" });
  if (result.status !== 200 || !result.contentType.includes("text/html")) throw new Error(`Browser authorize page failed: ${JSON.stringify(result)}`);
  assertHtmlSecurity(result, "authorization page");
  if (!result.text.includes("Slice 10.7 SMART Browser Test App") || !result.text.includes("CarePoint SMART authorization")) throw new Error("Browser authorization page does not identify CarePoint/client.");
  const match = /name="transaction" value="([A-Za-z0-9_-]+)"/.exec(result.text);
  if (!match) throw new Error("SMART browser transaction handle missing from login page.");
  return match[1];
}

async function browserLogin(transaction, email) {
  const body = new URLSearchParams({ transaction, email, password });
  const result = await raw("/smart/browser/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
  if (result.status !== 200 || !result.contentType.includes("text/html") || !result.text.includes("Review access request")) {
    throw new Error(`SMART browser login/consent failed: ${JSON.stringify(result)}`);
  }
  assertHtmlSecurity(result, "consent page");
  for (const scope of ["openid", "fhirUser", "patient/Patient.r", "patient/Appointment.rs"]) {
    if (!result.text.includes(scope)) throw new Error(`Consent page missing requested scope ${scope}.`);
  }
}

async function consent(transaction, decision) {
  const body = new URLSearchParams({ transaction, decision });
  return raw("/smart/browser/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
}

async function exchange(code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  return raw("/smart/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function assertHtmlSecurity(result, label) {
  if (!result.cacheControl.includes("no-store") || result.pragma !== "no-cache") throw new Error(`${label}: browser response is cacheable.`);
  if (result.frame !== "DENY" || !result.csp.includes("frame-ancestors 'none'") || !result.csp.includes("form-action 'self'")) throw new Error(`${label}: anti-clickjacking/CSP headers missing.`);
  if (result.referrer !== "no-referrer") throw new Error(`${label}: referrer policy missing.`);
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function verifyIdToken(idToken, jwks, expected) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("OIDC id_token is not a compact JWT.");
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error(`OIDC JWT header invalid: ${JSON.stringify(header)}`);
  const jwk = jwks.keys?.find((item) => item.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA" || jwk.alg !== "RS256") throw new Error(`Matching RS256 JWK not found: ${JSON.stringify(jwks)}`);
  const verifierInstance = createVerify("RSA-SHA256");
  verifierInstance.update(`${parts[0]}.${parts[1]}`, "ascii");
  verifierInstance.end();
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  if (!verifierInstance.verify(publicKey, Buffer.from(parts[2], "base64url"))) throw new Error("OIDC id_token signature verification failed.");
  if (claims.iss !== base || claims.aud !== clientId || claims.nonce !== expected.nonce) throw new Error(`OIDC core claims mismatch: ${JSON.stringify(claims)}`);
  if (claims.fhirUser !== `${fhirBase}/Patient/${expected.patientId}`) throw new Error(`FHIR user claim mismatch: ${JSON.stringify(claims)}`);
  if (typeof claims.sub !== "string" || claims.sub.length < 20 || typeof claims.auth_time !== "number") throw new Error(`OIDC subject/auth_time invalid: ${JSON.stringify(claims)}`);
  if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("OIDC id_token is already expired.");
  return claims;
}

try {
  const discovery = await raw("/fhir/R4/.well-known/smart-configuration");
  if (discovery.status !== 200) throw new Error(`SMART discovery failed: ${JSON.stringify(discovery)}`);
  if (discovery.payload.authorization_endpoint !== `${base}/smart/browser/authorize`) throw new Error(`Standalone authorization endpoint mismatch: ${JSON.stringify(discovery.payload)}`);
  if (discovery.payload.jwks_uri !== `${base}/smart/jwks`) throw new Error("SMART discovery JWKS URI missing.");
  for (const capability of ["launch-standalone", "context-standalone-patient", "sso-openid-connect", "client-public", "permission-patient", "permission-v2"]) {
    if (!discovery.payload.capabilities?.includes(capability)) throw new Error(`SMART discovery missing ${capability}.`);
  }
  for (const scope of ["openid", "fhirUser", "launch/patient"]) {
    if (!discovery.payload.scopes_supported?.includes(scope)) throw new Error(`SMART discovery missing ${scope}.`);
  }

  const oidcDiscovery = await raw("/.well-known/openid-configuration");
  if (oidcDiscovery.status !== 200 || oidcDiscovery.payload.issuer !== base || oidcDiscovery.payload.jwks_uri !== `${base}/smart/jwks`) throw new Error(`OIDC discovery invalid: ${JSON.stringify(oidcDiscovery)}`);
  if (!oidcDiscovery.payload.id_token_signing_alg_values_supported?.includes("RS256")) throw new Error("OIDC discovery missing RS256.");

  const jwksResult = await raw("/smart/jwks");
  if (jwksResult.status !== 200 || !Array.isArray(jwksResult.payload.keys) || jwksResult.payload.keys.length < 1) throw new Error(`JWKS failed: ${JSON.stringify(jwksResult)}`);

  const metadata = await raw("/fhir/R4/metadata");
  const versionMatch = /^slice-10\.(\d+)$/.exec(String(metadata.payload.software?.version || ""));
  if (metadata.status !== 200 || !versionMatch || Number(versionMatch[1]) < 7) throw new Error(`FHIR Slice 10.7+ metadata failed: ${JSON.stringify(metadata)}`);
  const oauthUris = metadata.payload.rest?.[0]?.security?.extension?.find((item) => item.url === "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris");
  if (!oauthUris?.extension?.some((item) => item.url === "authorize" && item.valueUri === `${base}/smart/browser/authorize`)) throw new Error("FHIR CapabilityStatement does not advertise browser SMART authorization.");

  await registerPatient(patientAEmail, "Alice");
  await registerPatient(patientBEmail, "Bob");
  const patientA = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientAEmail } } });
  const patientB = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientBEmail } } });

  const codeVerifier = verifier();
  const state = `browser-state-${suffix}`;
  const nonce = `browser-nonce-${suffix}-${randomBytes(8).toString("hex")}`;
  const transaction = await beginBrowser(codeVerifier, state, nonce);
  await browserLogin(transaction, patientAEmail);
  const approved = await consent(transaction, "approve");
  if (approved.status !== 302 || !approved.location || !approved.cacheControl.includes("no-store")) throw new Error(`SMART consent approval redirect failed: ${JSON.stringify(approved)}`);
  const callback = new URL(approved.location);
  if (callback.searchParams.get("state") !== state || callback.searchParams.get("error")) throw new Error(`SMART callback state/error invalid: ${approved.location}`);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("SMART browser approval did not issue an authorization code.");

  const token = await exchange(code, codeVerifier);
  if (token.status !== 200 || !token.payload.access_token || !token.payload.id_token || token.payload.patient !== patientA.id) throw new Error(`SMART OIDC token exchange failed: ${JSON.stringify(token)}`);
  if (!token.cacheControl.includes("no-store") || token.payload.refresh_token) throw new Error("SMART browser token response is not minimized/no-store.");
  const claims = verifyIdToken(token.payload.id_token, jwksResult.payload, { nonce, patientId: patientA.id });

  const smartToken = token.payload.access_token;
  const self = await raw(`/fhir/R4/Patient/${patientA.id}`, { token: smartToken });
  if (self.status !== 200 || self.payload.resourceType !== "Patient") throw new Error(`SMART browser Patient read failed: ${JSON.stringify(self)}`);
  const ownAppointments = await raw(`/fhir/R4/Appointment?patient=${patientA.id}`, { token: smartToken });
  if (ownAppointments.status !== 200 || ownAppointments.payload.resourceType !== "Bundle") throw new Error(`SMART browser Appointment search failed: ${JSON.stringify(ownAppointments)}`);
  const crossPatient = await raw(`/fhir/R4/Patient/${patientB.id}`, { token: smartToken });
  if (crossPatient.status !== 403 || crossPatient.payload.resourceType !== "OperationOutcome") throw new Error(`SMART browser cross-patient isolation failed: ${JSON.stringify(crossPatient)}`);

  const codeReplay = await exchange(code, codeVerifier);
  if (codeReplay.status !== 400 || codeReplay.payload.error !== "invalid_grant") throw new Error(`Browser authorization code replay was accepted: ${JSON.stringify(codeReplay)}`);
  const transactionReplay = await consent(transaction, "approve");
  if (transactionReplay.status !== 400 || !transactionReplay.contentType.includes("text/html")) throw new Error(`Consent transaction replay was not rejected: ${JSON.stringify(transactionReplay)}`);

  const denyVerifier = verifier();
  const denyState = `deny-state-${suffix}`;
  const denyNonce = `deny-nonce-${suffix}-${randomBytes(8).toString("hex")}`;
  const denyTransaction = await beginBrowser(denyVerifier, denyState, denyNonce);
  await browserLogin(denyTransaction, patientAEmail);
  const denied = await consent(denyTransaction, "deny");
  if (denied.status !== 302 || !denied.location) throw new Error(`SMART consent denial redirect failed: ${JSON.stringify(denied)}`);
  const deniedCallback = new URL(denied.location);
  if (deniedCallback.searchParams.get("error") !== "access_denied" || deniedCallback.searchParams.get("state") !== denyState || deniedCallback.searchParams.get("code")) throw new Error(`SMART consent denial semantics failed: ${denied.location}`);

  const missingNonce = authorizationParams(verifier(), `missing-nonce-${suffix}`, "temporary-nonce-value");
  missingNonce.delete("nonce");
  const rejectedNonce = await raw(`/smart/browser/authorize?${missingNonce.toString()}`, { redirect: "manual" });
  if (rejectedNonce.status !== 400 || !rejectedNonce.contentType.includes("text/html")) throw new Error(`OIDC launch without nonce should fail safely: ${JSON.stringify(rejectedNonce)}`);

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    patientId: patientA.id,
    standaloneBrowserLaunch: true,
    explicitConsentApproveDeny: true,
    oidcDiscovery: true,
    rs256JwksVerification: true,
    fhirUser: claims.fhirUser,
    pkceS256: true,
    stateAndNonceBinding: true,
    patientIsolation: true,
    codeReplayDenied: true,
    consentReplayDenied: true,
    browserSecurityHeaders: true,
  }));
} finally {
  await prisma.$disconnect();
}
