import { PrismaClient } from "@prisma/client";
import { createSign, randomBytes } from "node:crypto";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const fhirBase = process.env.SMART_FHIR_BASE_URL || `${base}/fhir/R4`;
const tokenEndpoint = `${base}/smart/token`;
const assertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const clientId = "slice109-backend-client";
const otherClientId = "slice1010-other-client";
const keyId = "slice109-backend-key";
const privateKeyB64 = process.env.SMART_BACKEND_PRIVATE_KEY_B64;
if (!privateKeyB64) throw new Error("SMART_BACKEND_PRIVATE_KEY_B64 is required for Slice 10.10 smoke testing.");
const privateKey = Buffer.from(privateKeyB64, "base64").toString("utf8");
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const password = `Cp!${suffix}BulkPatient9Aa`;

async function raw(path, { method = "GET", token, body, headers = {}, redirect = "follow" } = {}) {
  const requestHeaders = { accept: "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const url = /^https?:\/\//.test(path) ? path : base + path;
  const response = await fetch(url, { method, headers: requestHeaders, body, redirect });
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
    contentLocation: response.headers.get("content-location") || "",
    retryAfter: response.headers.get("retry-after") || "",
    progress: response.headers.get("x-progress") || "",
    expires: response.headers.get("expires") || "",
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

async function registerPatient(label) {
  const email = `bulk-${label.toLowerCase()}-${suffix}@carepoint.test`;
  await json("/iam/register/patient", { method: "POST", body: { email, password, firstName: label, lastName: "Bulk Export" } });
  const login = await json("/iam/login", { method: "POST", body: { email, password } });
  const patient = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email } } });
  return { email, patient, accessToken: login.accessToken };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assertion(audience, subject = clientId) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS384", kid: keyId, typ: "JWT" };
  const claims = {
    iss: subject,
    sub: subject,
    aud: audience,
    iat: now,
    exp: now + 240,
    jti: `bulk-${subject}-${suffix}-${randomBytes(18).toString("base64url")}`,
  };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput, "ascii");
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
}

async function backendToken(subject = clientId, scopes = ["system/Patient.rs", "system/Appointment.rs"]) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: subject,
    scope: scopes.join(" "),
    client_assertion_type: assertionType,
    client_assertion: assertion(tokenEndpoint, subject),
  });
  const result = await raw("/smart/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (result.status !== 200 || !result.payload.access_token) throw new Error(`Backend token failed for ${subject}: ${JSON.stringify(result)}`);
  return result.payload.access_token;
}

async function kickoff(token, query = "") {
  return raw(`/fhir/R4/$export${query ? `?${query}` : ""}`, {
    token,
    headers: { accept: "application/fhir+json", prefer: "respond-async" },
  });
}

async function waitForManifest(contentLocation, token) {
  for (let i = 0; i < 30; i += 1) {
    const status = await raw(contentLocation, { token, headers: { accept: "application/json" } });
    if (status.status === 200) return status;
    if (status.status !== 202) throw new Error(`Bulk export polling failed: ${JSON.stringify(status)}`);
    if (!status.retryAfter || !status.progress) throw new Error(`In-progress bulk export did not provide polling guidance: ${JSON.stringify(status)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Bulk export did not complete within the smoke-test polling window.");
}

function ndjson(text) {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function expectFhir(result, status, label) {
  if (result.status !== status || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
}

try {
  const metadata = await raw("/fhir/R4/metadata");
  const softwareVersion = String(metadata.payload.software?.version || "");
  const versionMatch = /^slice-10\.(\d+)$/.exec(softwareVersion);
  if (metadata.status !== 200 || !versionMatch || Number(versionMatch[1]) < 10) throw new Error(`FHIR Slice 10.10+ metadata failed: ${JSON.stringify(metadata)}`);
  const exportOperation = metadata.payload.rest?.[0]?.operation?.find((item) => item.name === "export");
  if (!exportOperation || !String(exportOperation.definition || "").includes("bulkdata")) throw new Error("CapabilityStatement does not advertise Bulk Data $export.");

  const alice = await registerPatient("Alice");
  const bob = await registerPatient("Bob");
  const provider = await prisma.provider.create({ data: { class: "DOCTOR", displayName: `Bulk Doctor ${suffix}`, status: "ACTIVE" } });
  const service = await prisma.service.create({ data: { providerId: provider.id, name: `Bulk Service ${suffix}` } });
  const startsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const appointment = await prisma.appointment.create({
    data: {
      patientId: alice.patient.id,
      providerId: provider.id,
      serviceId: service.id,
      modality: "CLINIC",
      status: "CONFIRMED",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
    },
  });

  const fullToken = await backendToken();
  const patientOnlyToken = await backendToken(clientId, ["system/Patient.rs"]);
  const otherToken = await backendToken(otherClientId);

  const normalPatientAttempt = await raw("/fhir/R4/$export?_type=Patient", {
    token: alice.accessToken,
    headers: { accept: "application/fhir+json", prefer: "respond-async" },
  });
  expectFhir(normalPatientAttempt, 403, "Ordinary patient session started a system bulk export");

  const missingPrefer = await raw("/fhir/R4/$export?_type=Patient", { token: fullToken, headers: { accept: "application/fhir+json" } });
  expectFhir(missingPrefer, 400, "Bulk export without Prefer: respond-async was accepted");

  const unsupportedType = await kickoff(fullToken, "_type=Observation");
  expectFhir(unsupportedType, 400, "Unsupported bulk resource type was accepted");

  const missingScope = await kickoff(patientOnlyToken, "_type=Appointment");
  expectFhir(missingScope, 403, "Patient-only system scope exported Appointment");

  const futureSince = await kickoff(fullToken, `_type=Patient&_since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
  expectFhir(futureSince, 400, "Future _since was accepted");

  const kickoffResult = await kickoff(fullToken, `_type=Patient,Appointment&_outputFormat=${encodeURIComponent("ndjson")}`);
  if (kickoffResult.status !== 202 || !kickoffResult.contentLocation.startsWith(`${fhirBase}/$export-status/`)) {
    throw new Error(`Bulk export kickoff failed: ${JSON.stringify(kickoffResult)}`);
  }
  if (!kickoffResult.cacheControl.includes("no-store")) throw new Error("Bulk export kickoff is cacheable.");

  const foreignStatus = await raw(kickoffResult.contentLocation, { token: otherToken });
  expectFhir(foreignStatus, 403, "Another backend client accessed the export status");
  const narrowStatus = await raw(kickoffResult.contentLocation, { token: patientOnlyToken });
  expectFhir(narrowStatus, 403, "Narrower token accessed a multi-resource export status");

  const completed = await waitForManifest(kickoffResult.contentLocation, fullToken);
  if (!completed.expires || Number.isNaN(Date.parse(completed.expires))) throw new Error("Completed bulk export did not publish an Expires header.");
  const manifest = completed.payload;
  if (manifest.requiresAccessToken !== true || manifest.outputFormat !== "application/fhir+ndjson" || !Array.isArray(manifest.output)) {
    throw new Error(`Bulk export manifest is invalid: ${JSON.stringify(manifest)}`);
  }
  const patientOutput = manifest.output.find((item) => item.type === "Patient");
  const appointmentOutput = manifest.output.find((item) => item.type === "Appointment");
  if (!patientOutput?.url || !appointmentOutput?.url) throw new Error(`Expected Patient and Appointment output files: ${JSON.stringify(manifest)}`);
  if ([patientOutput.url, appointmentOutput.url].some((url) => String(url).includes("access_token") || String(url).includes("Bearer"))) {
    throw new Error("Bulk export manifest leaked bearer credentials in output URLs.");
  }

  expectFhir(await raw(patientOutput.url), 401, "Bulk Patient file was downloadable without authentication");
  expectFhir(await raw(appointmentOutput.url, { token: patientOnlyToken }), 403, "Narrow token downloaded file from a wider export job");

  const patientFile = await raw(patientOutput.url, { token: fullToken, headers: { accept: "application/fhir+ndjson" } });
  if (patientFile.status !== 200 || !patientFile.contentType.includes("application/fhir+ndjson")) throw new Error(`Patient NDJSON download failed: ${JSON.stringify(patientFile)}`);
  const patients = ndjson(patientFile.text);
  if (!patients.every((resource) => resource.resourceType === "Patient") || !patients.some((resource) => resource.id === alice.patient.id) || !patients.some((resource) => resource.id === bob.patient.id)) {
    throw new Error("Patient NDJSON did not contain the expected typed resources.");
  }
  if (!patients.every((resource) => resource.meta?.lastUpdated)) throw new Error("Bulk Patient resources are missing meta.lastUpdated.");

  const appointmentFile = await raw(appointmentOutput.url, { token: fullToken, headers: { accept: "application/fhir+ndjson" } });
  if (appointmentFile.status !== 200 || !appointmentFile.contentType.includes("application/fhir+ndjson")) throw new Error(`Appointment NDJSON download failed: ${JSON.stringify(appointmentFile)}`);
  const appointments = ndjson(appointmentFile.text);
  if (!appointments.every((resource) => resource.resourceType === "Appointment") || !appointments.some((resource) => resource.id === appointment.id)) {
    throw new Error("Appointment NDJSON did not contain the expected appointment.");
  }
  if (!appointments.every((resource) => resource.meta?.lastUpdated)) throw new Error("Bulk Appointment resources are missing meta.lastUpdated.");

  const since = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const charlie = await registerPatient("Charlie");
  const incrementalKickoff = await kickoff(patientOnlyToken, `_type=Patient&_since=${encodeURIComponent(since)}`);
  if (incrementalKickoff.status !== 202 || !incrementalKickoff.contentLocation) throw new Error(`Incremental kickoff failed: ${JSON.stringify(incrementalKickoff)}`);
  const incremental = await waitForManifest(incrementalKickoff.contentLocation, patientOnlyToken);
  const incrementalPatientOutput = incremental.payload.output?.find((item) => item.type === "Patient");
  if (!incrementalPatientOutput?.url) throw new Error(`Incremental Patient output missing: ${JSON.stringify(incremental.payload)}`);
  const incrementalFile = await raw(incrementalPatientOutput.url, { token: patientOnlyToken, headers: { accept: "application/fhir+ndjson" } });
  const incrementalPatients = ndjson(incrementalFile.text);
  if (!incrementalPatients.some((resource) => resource.id === charlie.patient.id) || incrementalPatients.some((resource) => resource.id === alice.patient.id || resource.id === bob.patient.id)) {
    throw new Error(`_since filtering is incorrect: ${incrementalFile.text}`);
  }

  const cancelKickoff = await kickoff(patientOnlyToken, "_type=Patient");
  if (cancelKickoff.status !== 202 || !cancelKickoff.contentLocation) throw new Error(`Cancellation kickoff failed: ${JSON.stringify(cancelKickoff)}`);
  const cancelled = await raw(cancelKickoff.contentLocation, { method: "DELETE", token: patientOnlyToken });
  if (cancelled.status !== 202) throw new Error(`Bulk export cancellation failed: ${JSON.stringify(cancelled)}`);
  expectFhir(await raw(cancelKickoff.contentLocation, { token: patientOnlyToken }), 404, "Cancelled export remained pollable");

  const cleanupMain = await raw(kickoffResult.contentLocation, { method: "DELETE", token: fullToken });
  if (cleanupMain.status !== 202) throw new Error(`Completed export cleanup failed: ${JSON.stringify(cleanupMain)}`);
  const cleanupIncremental = await raw(incrementalKickoff.contentLocation, { method: "DELETE", token: patientOnlyToken });
  if (cleanupIncremental.status !== 202) throw new Error(`Incremental export cleanup failed: ${JSON.stringify(cleanupIncremental)}`);

  const expectedAuditActions = [
    "FHIR_BULK_EXPORT_KICKOFF",
    "FHIR_BULK_EXPORT_COMPLETED",
    "FHIR_BULK_EXPORT_STATUS",
    "FHIR_BULK_EXPORT_FILE_DOWNLOADED",
    "FHIR_BULK_EXPORT_CLIENT_DENIED",
    "FHIR_BULK_EXPORT_CANCELLED",
  ];
  const audit = await prisma.auditEvent.findMany({ where: { action: { in: expectedAuditActions } }, orderBy: { occurredAt: "desc" }, take: 300 });
  for (const action of expectedAuditActions) {
    if (!audit.some((event) => event.action === action)) throw new Error(`Expected bulk-export audit event ${action} was not recorded.`);
  }

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion,
    asynchronousKickoff: true,
    protectedPolling: true,
    sameClientEnforcement: true,
    exactScopeEnforcement: true,
    patientNdjson: true,
    appointmentNdjson: true,
    sinceFiltering: true,
    manifestRequiresAccessToken: true,
    bearerUrlsLeakFree: true,
    cancellation: true,
    expiryHeader: true,
    integrityCheckedOnDownload: true,
    audited: true,
  }));
} finally {
  await prisma.$disconnect();
}
