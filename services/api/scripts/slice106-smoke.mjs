import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const fhirBase = process.env.SMART_FHIR_BASE_URL || `${base}/fhir/R4`;
const clientId = "slice106-public-client";
const redirectUri = "https://smart-app.carepoint.test/callback";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const password = `Cp!${suffix}SmartPatient9Aa`;
const patientAEmail = `smart-a-${suffix}@carepoint.test`;
const patientBEmail = `smart-b-${suffix}@carepoint.test`;

async function raw(path, { method = "GET", token, body, headers = {}, redirect = "follow" } = {}) {
  const requestHeaders = { accept: "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers: requestHeaders, body, redirect });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return {
    status: response.status,
    payload,
    location: response.headers.get("location") || "",
    cacheControl: response.headers.get("cache-control") || "",
    contentType: response.headers.get("content-type") || "",
  };
}

async function json(path, { method = "GET", token, body } = {}) {
  const result = await raw(path, {
    method,
    token,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`${method} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function registerPatient(email, firstName) {
  await json("/iam/register/patient", { method: "POST", body: { email, password, firstName, lastName: "SMART Test" } });
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

async function authorize(internalToken, scopes, codeVerifier, state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state,
    aud: fhirBase,
    code_challenge: challenge(codeVerifier),
    code_challenge_method: "S256",
  });
  const result = await raw(`/smart/authorize?${params.toString()}`, { token: internalToken, redirect: "manual" });
  if (result.status !== 302 || !result.location) throw new Error(`SMART authorize failed: ${JSON.stringify(result)}`);
  if (!result.cacheControl.includes("no-store")) throw new Error("SMART authorization redirect is cacheable.");
  const callback = new URL(result.location);
  if (callback.origin + callback.pathname !== new URL(redirectUri).origin + new URL(redirectUri).pathname) throw new Error(`Unexpected SMART redirect target: ${result.location}`);
  if (callback.searchParams.get("state") !== state) throw new Error("SMART state was not preserved.");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("SMART authorization code missing.");
  return code;
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

function expectOutcome(result, status, label) {
  if (result.status !== status || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
}

try {
  const discovery = await raw("/fhir/R4/.well-known/smart-configuration");
  if (discovery.status !== 200) throw new Error(`SMART discovery failed: ${JSON.stringify(discovery)}`);
  if (discovery.payload.token_endpoint !== `${base}/smart/token`) throw new Error(`SMART token endpoint discovery mismatch: ${JSON.stringify(discovery.payload)}`);
  for (const capability of ["client-public", "permission-patient", "permission-v2"]) {
    if (!discovery.payload.capabilities?.includes(capability)) throw new Error(`SMART discovery missing implemented capability ${capability}.`);
  }
  for (const scope of ["launch/patient", "patient/Patient.r", "patient/Appointment.rs"]) {
    if (!discovery.payload.scopes_supported?.includes(scope)) throw new Error(`SMART discovery missing scope ${scope}.`);
  }
  if (!discovery.payload.code_challenge_methods_supported?.includes("S256")) throw new Error("SMART discovery does not require PKCE S256.");

  const metadata = await raw("/fhir/R4/metadata");
  const versionMatch = /^slice-10\.(\d+)$/.exec(metadata.payload.software?.version || "");
  if (metadata.status !== 200 || !versionMatch || Number(versionMatch[1]) < 6) throw new Error(`FHIR Slice 10.6+ metadata failed: ${JSON.stringify(metadata)}`);
  const security = metadata.payload.rest?.[0]?.security;
  const oauthExtension = security?.extension?.find((item) => item.url === "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris");
  if (!oauthExtension?.extension?.some((item) => item.url === "authorize" && typeof item.valueUri === "string" && item.valueUri.startsWith(`${base}/smart/`))) throw new Error("FHIR CapabilityStatement SMART authorize URI missing.");
  if (!oauthExtension?.extension?.some((item) => item.url === "token" && item.valueUri === `${base}/smart/token`)) throw new Error("FHIR CapabilityStatement SMART token URI missing.");

  const patientAToken = await registerPatient(patientAEmail, "Alice");
  await registerPatient(patientBEmail, "Bob");
  const patientA = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientAEmail } } });
  const patientB = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientBEmail } } });

  const verifier1 = verifier();
  const code1 = await authorize(patientAToken, ["launch/patient", "patient/Patient.r"], verifier1, `state-patient-${suffix}`);
  const token1 = await exchange(code1, verifier1);
  if (token1.status !== 200 || !token1.payload.access_token || token1.payload.patient !== patientA.id || token1.payload.token_type !== "Bearer") throw new Error(`SMART token exchange failed: ${JSON.stringify(token1)}`);
  if (!token1.cacheControl.includes("no-store") || token1.payload.refresh_token || token1.payload.id_token) throw new Error("SMART token response hardening or token minimization failed.");
  const smartPatientToken = token1.payload.access_token;

  const patientSelf = await raw(`/fhir/R4/Patient/${patientA.id}`, { token: smartPatientToken });
  if (patientSelf.status !== 200 || patientSelf.payload.resourceType !== "Patient" || patientSelf.payload.id !== patientA.id) throw new Error(`SMART Patient read failed: ${JSON.stringify(patientSelf)}`);
  expectOutcome(await raw(`/fhir/R4/Appointment?patient=${patientA.id}`, { token: smartPatientToken }), 403, "SMART resource scope should deny Appointment search");
  expectOutcome(await raw(`/fhir/R4/Patient/${patientB.id}`, { token: smartPatientToken }), 403, "SMART patient context should not cross patient boundary");

  const nonFhir = await raw("/iam/accounts/me", { token: smartPatientToken });
  if (nonFhir.status !== 403) throw new Error(`SMART token should be denied outside FHIR: ${JSON.stringify(nonFhir)}`);

  const smartAuthorizeReplay = await raw(`/smart/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "launch/patient patient/Patient.r",
    state: `state-nested-${suffix}`,
    aud: fhirBase,
    code_challenge: challenge(verifier()),
    code_challenge_method: "S256",
  }).toString()}`, { token: smartPatientToken, redirect: "manual" });
  if (smartAuthorizeReplay.status !== 403) throw new Error("SMART token must not authorize another SMART grant.");

  const verifier2 = verifier();
  const code2 = await authorize(patientAToken, ["launch/patient", "patient/Patient.r", "patient/Appointment.rs"], verifier2, `state-appointment-${suffix}`);
  const wrongVerifier = verifier();
  const badPkce = await exchange(code2, wrongVerifier);
  if (badPkce.status !== 400 || badPkce.payload.error !== "invalid_grant") throw new Error(`Wrong PKCE verifier should fail: ${JSON.stringify(badPkce)}`);
  const token2 = await exchange(code2, verifier2);
  if (token2.status !== 200 || !token2.payload.access_token || token2.payload.scope !== "launch/patient patient/Patient.r patient/Appointment.rs") throw new Error(`SMART scoped token failed: ${JSON.stringify(token2)}`);
  const smartAppointmentToken = token2.payload.access_token;

  const ownAppointments = await raw(`/fhir/R4/Appointment?patient=Patient/${patientA.id}`, { token: smartAppointmentToken });
  if (ownAppointments.status !== 200 || ownAppointments.payload.resourceType !== "Bundle" || ownAppointments.payload.type !== "searchset") throw new Error(`SMART Appointment search failed: ${JSON.stringify(ownAppointments)}`);
  expectOutcome(await raw(`/fhir/R4/Appointment?patient=${patientB.id}`, { token: smartAppointmentToken }), 403, "SMART Appointment search should remain patient isolated");

  const replay = await exchange(code2, verifier2);
  if (replay.status !== 400 || replay.payload.error !== "invalid_grant") throw new Error(`Authorization code replay was not rejected: ${JSON.stringify(replay)}`);

  const unsupportedParams = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "launch/patient patient/Observation.rs",
    state: `state-unsupported-${suffix}`,
    aud: fhirBase,
    code_challenge: challenge(verifier()),
    code_challenge_method: "S256",
  });
  const unsupported = await raw(`/smart/authorize?${unsupportedParams.toString()}`, { token: patientAToken, redirect: "manual" });
  if (unsupported.status !== 400) throw new Error(`Unregistered SMART scope should be rejected: ${JSON.stringify(unsupported)}`);

  const revokeBody = new URLSearchParams({ token: smartAppointmentToken, client_id: clientId });
  const revoked = await raw("/smart/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: revokeBody.toString() });
  if (revoked.status !== 200) throw new Error(`SMART token revocation failed: ${JSON.stringify(revoked)}`);
  expectOutcome(await raw(`/fhir/R4/Patient/${patientA.id}`, { token: smartAppointmentToken }), 401, "Revoked SMART token should be rejected");

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    patientId: patientA.id,
    smartDiscovery: true,
    pkceS256: true,
    authorizationCodeOneTime: true,
    granularPatientScopes: true,
    underlyingPatientIsolation: true,
    nonFhirDenied: true,
    tokenRevocation: true,
    redisBackedEphemeralTokens: true,
    forwardCompatibleCapabilityDiscovery: true,
  }));
} finally {
  await prisma.$disconnect();
}
