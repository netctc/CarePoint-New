import { PrismaClient } from "@prisma/client";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const fhirBase = process.env.SMART_FHIR_BASE_URL || `${base}/fhir/R4`;
const tokenEndpoint = `${base}/smart/token`;
const revokeEndpoint = `${base}/smart/revoke`;
const clientId = "slice109-backend-client";
const assertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const keyId = "slice109-backend-key";
const privateKeyB64 = process.env.SMART_BACKEND_PRIVATE_KEY_B64;
if (!privateKeyB64) throw new Error("SMART_BACKEND_PRIVATE_KEY_B64 is required for Slice 10.9 smoke testing.");
const privateKey = Buffer.from(privateKeyB64, "base64").toString("utf8");
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const password = `Cp!${suffix}BackendPatient9Aa`;
const patientAEmail = `smart-backend-a-${suffix}@carepoint.test`;
const patientBEmail = `smart-backend-b-${suffix}@carepoint.test`;

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
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    pragma: response.headers.get("pragma") || "",
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
  await json("/iam/register/patient", { method: "POST", body: { email, password, firstName, lastName: "SMART Backend Test" } });
  return prisma.patientProfile.findFirstOrThrow({ where: { user: { email } } });
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assertion(audience, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS384",
    kid: options.kid || keyId,
    typ: "JWT",
    ...(options.header || {}),
  };
  const claims = {
    iss: options.iss || clientId,
    sub: options.sub || clientId,
    aud: audience,
    iat: options.iat ?? now,
    exp: options.exp ?? now + 240,
    jti: options.jti || `jti-${suffix}-${randomBytes(18).toString("base64url")}`,
    ...(options.claims || {}),
  };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput, "ascii");
  signer.end();
  const signingKey = options.privateKey || privateKey;
  return `${signingInput}.${signer.sign(signingKey).toString("base64url")}`;
}

async function backendToken({ scopes = ["system/Patient.rs", "system/Appointment.rs"], clientAssertion = assertion(tokenEndpoint) } = {}) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    scope: scopes.join(" "),
    client_assertion_type: assertionType,
    client_assertion: clientAssertion,
  });
  return raw("/smart/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

async function revoke(token) {
  const body = new URLSearchParams({
    token,
    client_id: clientId,
    client_assertion_type: assertionType,
    client_assertion: assertion(revokeEndpoint),
  });
  return raw("/smart/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function expectOAuthError(result, error, label) {
  if (result.status !== 400 || result.payload.error !== error) throw new Error(`${label}: ${JSON.stringify(result)}`);
}

function expectFhir(result, status, label) {
  if (result.status !== status || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
}

try {
  const discovery = await raw("/fhir/R4/.well-known/smart-configuration");
  if (discovery.status !== 200) throw new Error(`SMART discovery failed: ${JSON.stringify(discovery)}`);
  for (const capability of ["client-confidential-asymmetric", "permission-system"]) {
    if (!discovery.payload.capabilities?.includes(capability)) throw new Error(`SMART discovery missing ${capability}.`);
  }
  if (!discovery.payload.grant_types_supported?.includes("client_credentials")) throw new Error("SMART discovery missing client_credentials.");
  if (!discovery.payload.token_endpoint_auth_methods_supported?.includes("private_key_jwt")) throw new Error("SMART discovery missing private_key_jwt.");
  if (!discovery.payload.token_endpoint_auth_signing_alg_values_supported?.includes("RS384")) throw new Error("SMART discovery missing RS384 client assertion support.");
  for (const scope of ["system/Patient.rs", "system/Appointment.rs"]) {
    if (!discovery.payload.scopes_supported?.includes(scope)) throw new Error(`SMART discovery missing ${scope}.`);
  }

  const metadata = await raw("/fhir/R4/metadata");
  if (metadata.status !== 200 || metadata.payload.software?.version !== "slice-10.9") throw new Error(`FHIR Slice 10.9 metadata failed: ${JSON.stringify(metadata)}`);
  const patientCapability = metadata.payload.rest?.[0]?.resource?.find((item) => item.type === "Patient");
  if (!patientCapability?.interaction?.some((item) => item.code === "search-type")) throw new Error("CapabilityStatement does not advertise Patient search.");
  const smartSecurity = metadata.payload.rest?.[0]?.security?.service?.[0]?.coding?.[0];
  if (smartSecurity?.code !== "SMART-on-FHIR") throw new Error("CapabilityStatement does not advertise SMART-on-FHIR security service.");

  const patientA = await registerPatient(patientAEmail, "Alice");
  const patientB = await registerPatient(patientBEmail, "Bob");
  const provider = await prisma.provider.create({
    data: { class: "DOCTOR", displayName: `Backend Doctor ${suffix}`, status: "ACTIVE" },
  });
  const service = await prisma.service.create({
    data: { providerId: provider.id, name: `Backend Service ${suffix}` },
  });
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patientA.id,
      providerId: provider.id,
      serviceId: service.id,
      modality: "CLINIC",
      status: "CONFIRMED",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
    },
  });

  const replayAssertion = assertion(tokenEndpoint, { jti: `replay-${suffix}-${randomBytes(16).toString("hex")}` });
  const tokenResult = await backendToken({ clientAssertion: replayAssertion });
  if (
    tokenResult.status !== 200 ||
    !tokenResult.payload.access_token ||
    tokenResult.payload.patient ||
    tokenResult.payload.refresh_token ||
    tokenResult.payload.id_token ||
    tokenResult.payload.expires_in !== 300
  ) throw new Error(`SMART backend token grant failed: ${JSON.stringify(tokenResult)}`);
  if (!tokenResult.cacheControl.includes("no-store") || tokenResult.pragma !== "no-cache") throw new Error("SMART backend token response is cacheable.");
  const systemToken = tokenResult.payload.access_token;

  const replay = await backendToken({ clientAssertion: replayAssertion });
  expectOAuthError(replay, "invalid_client", "Client assertion replay was accepted");

  const readA = await raw(`/fhir/R4/Patient/${patientA.id}`, { token: systemToken });
  if (readA.status !== 200 || readA.payload.resourceType !== "Patient" || readA.payload.id !== patientA.id) throw new Error(`System Patient read failed: ${JSON.stringify(readA)}`);
  const readB = await raw(`/fhir/R4/Patient/${patientB.id}`, { token: systemToken });
  if (readB.status !== 200 || readB.payload.id !== patientB.id) throw new Error(`System scope did not support authorized cross-patient read: ${JSON.stringify(readB)}`);

  const exactPatients = await raw(`/fhir/R4/Patient?_id=${encodeURIComponent(patientA.id)}&_count=5`, { token: systemToken });
  if (exactPatients.status !== 200 || exactPatients.payload.resourceType !== "Bundle" || exactPatients.payload.total !== 1 || exactPatients.payload.entry?.[0]?.resource?.id !== patientA.id) {
    throw new Error(`System Patient _id search failed: ${JSON.stringify(exactPatients)}`);
  }
  const patientPage = await raw("/fhir/R4/Patient?_count=1&_offset=0", { token: systemToken });
  if (patientPage.status !== 200 || patientPage.payload.total < 2 || patientPage.payload.entry?.length !== 1 || !patientPage.payload.link?.some((item) => item.relation === "next")) {
    throw new Error(`System Patient pagination failed: ${JSON.stringify(patientPage)}`);
  }

  const readAppointment = await raw(`/fhir/R4/Appointment/${appointment.id}`, { token: systemToken });
  if (readAppointment.status !== 200 || readAppointment.payload.resourceType !== "Appointment" || readAppointment.payload.id !== appointment.id) {
    throw new Error(`System Appointment read failed: ${JSON.stringify(readAppointment)}`);
  }
  const appointmentSearch = await raw(`/fhir/R4/Appointment?patient=${patientA.id}&status=booked&_count=10`, { token: systemToken });
  if (appointmentSearch.status !== 200 || appointmentSearch.payload.resourceType !== "Bundle" || appointmentSearch.payload.total !== 1 || appointmentSearch.payload.entry?.[0]?.resource?.id !== appointment.id) {
    throw new Error(`System Appointment search failed: ${JSON.stringify(appointmentSearch)}`);
  }

  const nonFhir = await raw("/iam/accounts/me", { token: systemToken });
  if (nonFhir.status !== 403) throw new Error(`SMART system token escaped FHIR routes: ${JSON.stringify(nonFhir)}`);
  const unsupportedResource = await raw("/fhir/R4/Observation?encounter=Encounter/not-used", { token: systemToken });
  expectFhir(unsupportedResource, 403, "SMART system token reached an unregistered FHIR resource");

  const patientOnly = await backendToken({ scopes: ["system/Patient.rs"] });
  if (patientOnly.status !== 200 || !patientOnly.payload.access_token) throw new Error(`Narrow system scope token failed: ${JSON.stringify(patientOnly)}`);
  expectFhir(await raw(`/fhir/R4/Appointment/${appointment.id}`, { token: patientOnly.payload.access_token }), 403, "Narrow system scope accessed Appointment");

  const invalidScope = await backendToken({ scopes: ["system/Observation.rs"] });
  expectOAuthError(invalidScope, "invalid_scope", "Unregistered system scope was accepted");

  const wrongAudience = await backendToken({ clientAssertion: assertion(`${base}/wrong-token-endpoint`) });
  expectOAuthError(wrongAudience, "invalid_client", "Wrong client assertion audience was accepted");

  const { privateKey: wrongPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 0x10001 });
  const wrongSignature = await backendToken({ clientAssertion: assertion(tokenEndpoint, { privateKey: wrongPrivateKey }) });
  expectOAuthError(wrongSignature, "invalid_client", "Unregistered signing key was accepted");

  const browserAttempt = await raw(`/smart/browser/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}`, { redirect: "manual" });
  if (browserAttempt.status !== 400 || !browserAttempt.contentType.includes("text/html")) throw new Error(`Backend client entered browser authorization flow: ${JSON.stringify(browserAttempt)}`);

  const tokenStillValid = await raw(`/fhir/R4/Patient/${patientA.id}`, { token: systemToken });
  if (tokenStillValid.status !== 200) throw new Error("Client assertion replay incorrectly revoked an already-issued backend token.");

  const revoked = await revoke(systemToken);
  if (revoked.status !== 200) throw new Error(`Backend token revocation failed: ${JSON.stringify(revoked)}`);
  expectFhir(await raw(`/fhir/R4/Patient/${patientA.id}`, { token: systemToken }), 401, "Revoked backend token remained active");

  const auditEvents = await prisma.auditEvent.findMany({
    where: {
      OR: [
        { objectId: clientId },
        { action: { in: ["FHIR_SYSTEM_PATIENT_READ", "FHIR_SYSTEM_PATIENT_SEARCH", "FHIR_SYSTEM_APPOINTMENT_READ", "FHIR_SYSTEM_APPOINTMENT_SEARCH"] } },
      ],
    },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
  for (const action of ["SMART_BACKEND_CLIENT_AUTHENTICATED", "SMART_BACKEND_ACCESS_TOKEN_ISSUED", "FHIR_SYSTEM_PATIENT_READ", "FHIR_SYSTEM_APPOINTMENT_SEARCH", "SMART_BACKEND_ACCESS_TOKEN_REVOKED"]) {
    if (!auditEvents.some((event) => event.action === action)) throw new Error(`Expected backend audit event ${action} was not recorded.`);
  }

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    clientId,
    privateKeyJwt: true,
    assertionAlgorithm: "RS384",
    assertionReplayDenied: true,
    systemPatientReadSearch: true,
    systemAppointmentReadSearch: true,
    crossPatientSystemScope: true,
    scopeIsolation: true,
    nonFhirIsolation: true,
    shortLivedAccessTokenSeconds: tokenResult.payload.expires_in,
    refreshTokensIssued: false,
    backendRevocation: true,
    audited: true,
  }));
} finally {
  await prisma.$disconnect();
}
