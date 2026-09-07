import { PrismaClient } from "@prisma/client";
import { createSign, randomBytes, randomUUID } from "node:crypto";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const fhirBase = process.env.SMART_FHIR_BASE_URL || `${base}/fhir/R4`;
const tokenEndpoint = `${base}/smart/token`;
const assertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const clientId = "slice109-backend-client";
const keyId = "slice109-backend-key";
const privateKeyB64 = process.env.SMART_BACKEND_PRIVATE_KEY_B64;
if (!privateKeyB64) throw new Error("SMART_BACKEND_PRIVATE_KEY_B64 is required for Slice 10.11 smoke testing.");
const privateKey = Buffer.from(privateKeyB64, "base64").toString("utf8");
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const password = `Cp!${suffix}BulkFilter9Aa`;
const syntheticUserIds = [];

async function raw(path, { method = "GET", token, body, headers = {} } = {}) {
  const requestHeaders = { accept: "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const url = /^https?:\/\//.test(path) ? path : base + path;
  const response = await fetch(url, { method, headers: requestHeaders, body });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return {
    status: response.status,
    text,
    payload,
    contentType: response.headers.get("content-type") || "",
    contentLocation: response.headers.get("content-location") || "",
    retryAfter: response.headers.get("retry-after") || "",
    progress: response.headers.get("x-progress") || "",
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
  const email = `bulk-1011-${label.toLowerCase()}-${suffix}@carepoint.test`;
  await json("/iam/register/patient", { method: "POST", body: { email, password, firstName: label, lastName: "Bulk Filter" } });
  const patient = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email } } });
  return { email, patient };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assertion(audience) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS384", kid: keyId, typ: "JWT" };
  const claims = {
    iss: clientId,
    sub: clientId,
    aud: audience,
    iat: now,
    exp: now + 240,
    jti: `bulk-1011-${suffix}-${randomBytes(18).toString("base64url")}`,
  };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput, "ascii");
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
}

async function backendToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    scope: "system/Patient.rs system/Appointment.rs",
    client_assertion_type: assertionType,
    client_assertion: assertion(tokenEndpoint),
  });
  const result = await raw("/smart/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (result.status !== 200 || !result.payload.access_token) throw new Error(`Slice 10.11 backend token failed: ${JSON.stringify(result)}`);
  return result.payload.access_token;
}

async function kickoff(token, params) {
  const query = params instanceof URLSearchParams ? params.toString() : String(params || "");
  return raw(`/fhir/R4/$export${query ? `?${query}` : ""}`, {
    token,
    headers: { accept: "application/fhir+json", prefer: "respond-async" },
  });
}

async function waitForManifest(contentLocation, token) {
  for (let i = 0; i < 40; i += 1) {
    const status = await raw(contentLocation, { token, headers: { accept: "application/json" } });
    if (status.status === 200) return status.payload;
    if (status.status !== 202) throw new Error(`Slice 10.11 polling failed: ${JSON.stringify(status)}`);
    if (!status.retryAfter || !status.progress) throw new Error(`Slice 10.11 polling guidance missing: ${JSON.stringify(status)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Slice 10.11 export did not complete within the polling window.");
}

function expectOutcome(result, status, label) {
  if (result.status !== status || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
}

function ndjson(text) {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function downloadAll(outputs, token) {
  const resources = [];
  for (const output of outputs) {
    const result = await raw(output.url, { token, headers: { accept: "application/fhir+ndjson" } });
    if (result.status !== 200 || !result.contentType.includes("application/fhir+ndjson")) throw new Error(`NDJSON chunk download failed: ${JSON.stringify(result)}`);
    resources.push(...ndjson(result.text));
  }
  return resources;
}

async function createSyntheticPatients(count) {
  const users = [];
  const patients = [];
  for (let i = 0; i < count; i += 1) {
    const userId = randomUUID();
    const patientId = randomUUID();
    syntheticUserIds.push(userId);
    users.push({
      id: userId,
      email: `bulk-1011-scale-${suffix}-${i}@carepoint.test`,
      passwordHash: "slice-10.11-not-used-for-login",
      role: "PATIENT",
      status: "ACTIVE",
    });
    patients.push({
      id: patientId,
      userId,
      firstName: `Scale${i}`,
      lastName: "Bulk",
    });
  }
  await prisma.user.createMany({ data: users });
  await prisma.patientProfile.createMany({ data: patients });
  return patients.map((patient) => patient.id);
}

try {
  const metadata = await raw("/fhir/R4/metadata");
  if (metadata.status !== 200 || metadata.payload.software?.version !== "slice-10.11") throw new Error(`FHIR Slice 10.11 metadata failed: ${JSON.stringify(metadata)}`);
  const operation = metadata.payload.rest?.[0]?.operation?.find((item) => item.name === "export");
  if (!operation || !String(operation.documentation || "").includes("_typeFilter")) throw new Error("CapabilityStatement does not advertise Slice 10.11 _typeFilter support.");

  const token = await backendToken();
  const alice = await registerPatient("Alice");
  const bob = await registerPatient("Bob");
  const carol = await registerPatient("Carol");
  const provider = await prisma.provider.create({ data: { class: "DOCTOR", displayName: `Bulk 1011 Doctor ${suffix}`, status: "ACTIVE" } });
  const service = await prisma.service.create({ data: { providerId: provider.id, name: `Bulk 1011 Service ${suffix}` } });
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const aliceAppointment = await prisma.appointment.create({
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
  await prisma.appointment.create({
    data: {
      patientId: bob.patient.id,
      providerId: provider.id,
      serviceId: service.id,
      modality: "CLINIC",
      status: "CANCELLED",
      startsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      endsAt: new Date(startsAt.getTime() + 90 * 60 * 1000),
      cancellationReason: "Slice 10.11 filter control",
    },
  });

  const unknownFilter = new URLSearchParams({ _type: "Patient", _typeFilter: "Patient?name=Alice" });
  expectOutcome(await kickoff(token, unknownFilter), 400, "Unsupported Patient _typeFilter search parameter was accepted");

  const mismatchedFilter = new URLSearchParams({ _type: "Patient", _typeFilter: "Appointment?status=booked" });
  expectOutcome(await kickoff(token, mismatchedFilter), 400, "_typeFilter outside the exported resource set was accepted");

  const duplicateFilter = new URLSearchParams({ _type: "Patient" });
  duplicateFilter.append("_typeFilter", `Patient?_id=${alice.patient.id}`);
  duplicateFilter.append("_typeFilter", `Patient?_id=${bob.patient.id}`);
  expectOutcome(await kickoff(token, duplicateFilter), 400, "Duplicate Patient _typeFilter was accepted");

  const filteredParams = new URLSearchParams({ _type: "Patient,Appointment" });
  filteredParams.append("_typeFilter", `Patient?_id=${alice.patient.id},${bob.patient.id},${carol.patient.id}`);
  filteredParams.append("_typeFilter", `Appointment?patient=Patient/${alice.patient.id}&status=booked`);
  const filteredKickoff = await kickoff(token, filteredParams);
  if (filteredKickoff.status !== 202 || !filteredKickoff.contentLocation.startsWith(`${fhirBase}/$export-status/`)) {
    throw new Error(`Filtered bulk export kickoff failed: ${JSON.stringify(filteredKickoff)}`);
  }
  const filteredManifest = await waitForManifest(filteredKickoff.contentLocation, token);
  if (filteredManifest.requiresAccessToken !== true || !String(filteredManifest.request || "").includes("_typeFilter")) {
    throw new Error(`Filtered manifest did not preserve the normalized request: ${JSON.stringify(filteredManifest)}`);
  }
  if (String(filteredManifest.request).includes("access_token") || String(filteredManifest.request).includes("Bearer")) {
    throw new Error("Filtered manifest request leaked bearer credentials.");
  }
  const filteredPatientOutputs = filteredManifest.output?.filter((item) => item.type === "Patient") ?? [];
  const filteredAppointmentOutputs = filteredManifest.output?.filter((item) => item.type === "Appointment") ?? [];
  if (filteredPatientOutputs.length !== 1 || filteredAppointmentOutputs.length !== 1) {
    throw new Error(`Filtered export produced unexpected output partitions: ${JSON.stringify(filteredManifest.output)}`);
  }
  const filteredPatients = await downloadAll(filteredPatientOutputs, token);
  const filteredPatientIds = new Set(filteredPatients.map((resource) => resource.id));
  if (filteredPatients.length !== 3 || ![alice.patient.id, bob.patient.id, carol.patient.id].every((id) => filteredPatientIds.has(id))) {
    throw new Error(`Patient _typeFilter returned an incorrect subset: ${JSON.stringify(filteredPatients)}`);
  }
  const filteredAppointments = await downloadAll(filteredAppointmentOutputs, token);
  if (filteredAppointments.length !== 1 || filteredAppointments[0]?.id !== aliceAppointment.id || filteredAppointments[0]?.status !== "booked") {
    throw new Error(`Appointment _typeFilter returned an incorrect subset: ${JSON.stringify(filteredAppointments)}`);
  }

  const syntheticPatientIds = await createSyntheticPatients(1005);
  const scaleParams = new URLSearchParams({ _type: "Patient" });
  const scaleKickoff = await kickoff(token, scaleParams);
  if (scaleKickoff.status !== 202 || !scaleKickoff.contentLocation) throw new Error(`Scale export kickoff failed: ${JSON.stringify(scaleKickoff)}`);
  const scaleManifest = await waitForManifest(scaleKickoff.contentLocation, token);
  const patientChunks = scaleManifest.output?.filter((item) => item.type === "Patient") ?? [];
  if (patientChunks.length < 2) throw new Error(`Patient export was not partitioned into multiple files: ${JSON.stringify(scaleManifest.output)}`);
  if (!patientChunks.every((item) => Number.isInteger(item.count) && item.count > 0 && item.count <= 1000)) {
    throw new Error(`Patient chunk count exceeded the deterministic 1000-resource bound: ${JSON.stringify(patientChunks)}`);
  }
  const chunkNames = patientChunks.map((item) => String(item.url).split("/").at(-1));
  if (!chunkNames.every((name, index) => name === `Patient-${String(index + 1).padStart(5, "0")}.ndjson`)) {
    throw new Error(`Patient chunk names are not deterministic: ${JSON.stringify(chunkNames)}`);
  }
  const scaleResources = await downloadAll(patientChunks, token);
  const scaleIds = new Set(scaleResources.map((resource) => resource.id));
  if (!syntheticPatientIds.every((id) => scaleIds.has(id))) throw new Error("Partitioned Patient export omitted one or more source resources.");

  const filteredCancel = await raw(filteredKickoff.contentLocation, { method: "DELETE", token });
  if (filteredCancel.status !== 202) throw new Error(`Filtered export cleanup failed: ${JSON.stringify(filteredCancel)}`);
  const scaleCancel = await raw(scaleKickoff.contentLocation, { method: "DELETE", token });
  if (scaleCancel.status !== 202) throw new Error(`Scale export cleanup failed: ${JSON.stringify(scaleCancel)}`);

  const completedAudits = await prisma.auditEvent.findMany({
    where: { action: "FHIR_BULK_EXPORT_COMPLETED" },
    orderBy: { occurredAt: "desc" },
    take: 20,
  });
  if (!completedAudits.some((event) => JSON.stringify(event.metadata || {}).includes("typeFilters"))) {
    throw new Error("Slice 10.11 filtered export completion metadata was not audited.");
  }

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    strictTypeFilter: true,
    repeatedTypeFilterParameters: true,
    unsupportedFiltersRejected: true,
    patientIdSubset: true,
    appointmentPatientStatusSubset: true,
    normalizedManifestRequest: true,
    deterministicChunking: true,
    maxResourcesPerFile: 1000,
    partitionedPatientFiles: patientChunks.length,
    syntheticPatientsValidated: syntheticPatientIds.length,
    bearerLeakFree: true,
    audited: true,
  }));
} finally {
  if (syntheticUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: syntheticUserIds } } }).catch(() => undefined);
  }
  await prisma.$disconnect();
}
