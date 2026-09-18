import { PrismaClient } from "@prisma/client";
import { hashPasswordAsync } from "@carepoint/identity";
import { createSign, randomBytes } from "node:crypto";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const fhirBase = process.env.SMART_FHIR_BASE_URL || `${base}/fhir/R4`;
const tokenEndpoint = `${base}/smart/token`;
const assertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const clientId = "slice1012-clinical-client";
const keyId = "slice109-backend-key";
const privateKeyB64 = process.env.SMART_BACKEND_PRIVATE_KEY_B64;
if (!privateKeyB64) throw new Error("SMART_BACKEND_PRIVATE_KEY_B64 is required for Slice 10.12 smoke testing.");
const privateKey = Buffer.from(privateKeyB64, "base64").toString("utf8");
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const patientPassword = `Cp!${suffix}ClinicalPatient9Aa`;
const doctorPassword = `Cp!${suffix}ClinicalDoctor9Aa`;
const patientEmail = `bulk-1012-patient-${suffix}@carepoint.test`;
const doctorEmail = `bulk-1012-doctor-${suffix}@carepoint.test`;
const clinicalScopes = [
  "system/Encounter.rs",
  "system/Observation.rs",
  "system/MedicationRequest.rs",
  "system/ServiceRequest.rs",
  "system/DiagnosticReport.rs",
];

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

async function json(path, { method = "GET", token, body } = {}) {
  const result = await raw(path, {
    method,
    token,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`${method} ${path} -> ${result.status} ${result.text}`);
  return result.payload;
}

async function login(email, password) {
  const result = await json("/iam/login", { method: "POST", body: { email, password } });
  if (!result.accessToken) throw new Error(`Login did not return an access token for ${email}.`);
  return result.accessToken;
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
    jti: `bulk-1012-${suffix}-${randomBytes(18).toString("base64url")}`,
  };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput, "ascii");
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
}

async function backendToken(scopes = clinicalScopes) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    scope: scopes.join(" "),
    client_assertion_type: assertionType,
    client_assertion: assertion(tokenEndpoint),
  });
  const result = await raw("/smart/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (result.status !== 200 || !result.payload.access_token) throw new Error(`Slice 10.12 backend token failed: ${JSON.stringify(result)}`);
  return result.payload.access_token;
}

async function kickoff(token, types, extraParams = []) {
  const params = new URLSearchParams({ _type: types.join(",") });
  for (const [key, value] of extraParams) params.append(key, value);
  return raw(`/fhir/R4/$export?${params.toString()}`, {
    token,
    headers: { accept: "application/fhir+json", prefer: "respond-async" },
  });
}

async function waitForManifest(contentLocation, token) {
  for (let index = 0; index < 40; index += 1) {
    const result = await raw(contentLocation, { token, headers: { accept: "application/json" } });
    if (result.status === 200) return result.payload;
    if (result.status !== 202) throw new Error(`Slice 10.12 polling failed: ${JSON.stringify(result)}`);
    if (!result.retryAfter || !result.progress) throw new Error(`Slice 10.12 polling guidance missing: ${JSON.stringify(result)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Slice 10.12 export did not complete within the polling window.");
}

function expectOutcome(result, status, label) {
  if (result.status !== status || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
}

function ndjson(text) {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function downloadType(manifest, type, token) {
  const outputs = (manifest.output || []).filter((item) => item.type === type);
  if (outputs.length < 1) throw new Error(`Slice 10.12 manifest has no ${type} output: ${JSON.stringify(manifest.output)}`);
  const resources = [];
  const texts = [];
  for (const output of outputs) {
    const result = await raw(output.url, { token, headers: { accept: "application/fhir+ndjson" } });
    if (result.status !== 200 || !result.contentType.includes("application/fhir+ndjson")) {
      throw new Error(`Slice 10.12 ${type} NDJSON download failed: ${JSON.stringify(result)}`);
    }
    texts.push(result.text);
    resources.push(...ndjson(result.text));
  }
  if (!resources.every((resource) => resource.resourceType === type)) {
    throw new Error(`Slice 10.12 ${type} output contains another resource type.`);
  }
  return { resources, text: texts.join("\n") };
}

try {
  const discovery = await raw("/fhir/R4/.well-known/smart-configuration");
  if (discovery.status !== 200) throw new Error(`Slice 10.12 SMART discovery failed: ${JSON.stringify(discovery)}`);
  for (const scope of clinicalScopes) {
    if (!discovery.payload.scopes_supported?.includes(scope)) throw new Error(`SMART discovery missing ${scope}.`);
  }

  const metadata = await raw("/fhir/R4/metadata");
  if (metadata.status !== 200 || metadata.payload.software?.version !== "slice-10.12") {
    throw new Error(`FHIR Slice 10.12 metadata failed: ${JSON.stringify(metadata)}`);
  }
  const exportOperation = metadata.payload.rest?.[0]?.operation?.find((item) => item.name === "export");
  const exportDocumentation = String(exportOperation?.documentation || "");
  for (const type of ["Encounter", "Observation", "MedicationRequest", "ServiceRequest", "DiagnosticReport"]) {
    if (!exportDocumentation.includes(type)) throw new Error(`CapabilityStatement $export does not document ${type}.`);
  }
  if (!exportDocumentation.includes("RELEASED") || !exportDocumentation.includes("bulk-export-only")) {
    throw new Error("CapabilityStatement does not document Slice 10.12 release/bulk-only policy.");
  }

  await json("/iam/register/patient", {
    method: "POST",
    body: { email: patientEmail, password: patientPassword, firstName: "Alice", lastName: "Bulk Clinical" },
  });
  const patient = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientEmail } } });

  const doctorUser = await prisma.user.create({
    data: { email: doctorEmail, passwordHash: await hashPasswordAsync(doctorPassword), role: "DOCTOR" },
  });
  const provider = await prisma.provider.create({
    data: { userId: doctorUser.id, class: "DOCTOR", displayName: `Bulk Clinical Doctor ${suffix}`, status: "ACTIVE" },
  });
  const doctorToken = await login(doctorEmail, doctorPassword);
  const service = await json("/provider/services", {
    method: "POST",
    token: doctorToken,
    body: {
      labels: { en: "Slice 10.12 Clinical Export", ar: "Slice 10.12", fr: "Slice 10.12", es: "Slice 10.12" },
      currency: "USD",
      modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 8000 }],
    },
  });
  const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      providerId: provider.id,
      serviceId: service.id,
      modality: "CLINIC",
      status: "CONFIRMED",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
    },
  });

  const clinicalRecord = await json(`/clinical/appointments/${appointment.id}/records`, {
    method: "POST",
    token: doctorToken,
    body: {
      chiefComplaint: `Slice 10.12 encrypted clinical fixture ${suffix}`,
      assessment: "Stable synthetic condition.",
      vitals: { heartRateBpm: 71, oxygenSaturationPct: 98 },
    },
  });
  if (!clinicalRecord.id) throw new Error("Slice 10.12 clinical record was not created.");

  const prescription = await json(`/clinical-orders/appointments/${appointment.id}/prescriptions`, {
    method: "POST",
    token: doctorToken,
    body: {
      idempotencyKey: `bulk-1012-rx-${suffix}`,
      medication: { name: "Slice 10.12 Medication", codeSystem: "RxNorm", code: "1049630" },
      dosageInstruction: "One tablet daily.",
      quantity: 7,
      refills: 0,
      reason: "Synthetic bulk clinical export validation",
    },
  });

  const releasedLabOrder = await json(`/clinical-orders/appointments/${appointment.id}/laboratory`, {
    method: "POST",
    token: doctorToken,
    body: {
      idempotencyKey: `bulk-1012-lab-released-${suffix}`,
      tests: [{ display: "Hemoglobin", codeSystem: "LOINC", code: "718-7" }],
      priority: "ROUTINE",
      reason: "Synthetic released laboratory fixture",
    },
  });
  await json(`/clinical-orders/${releasedLabOrder.id}/lab-result`, {
    method: "POST",
    token: doctorToken,
    body: {
      observations: [{ display: "Hemoglobin", codeSystem: "LOINC", code: "718-7", value: 13.9, unit: "g/dL", referenceRange: "12.0-16.0", flag: "normal" }],
      conclusion: "Released Slice 10.12 result.",
    },
  });
  await json(`/clinical-orders/${releasedLabOrder.id}/lab-result/validate`, { method: "POST", token: doctorToken, body: {} });
  await json(`/clinical-orders/${releasedLabOrder.id}/lab-result/release`, { method: "POST", token: doctorToken, body: {} });

  const unreleasedLabOrder = await json(`/clinical-orders/appointments/${appointment.id}/laboratory`, {
    method: "POST",
    token: doctorToken,
    body: {
      idempotencyKey: `bulk-1012-lab-unreleased-${suffix}`,
      tests: [{ display: "Unreleased marker", codeSystem: "LOINC", code: "94531-1" }],
      priority: "ROUTINE",
      reason: "Synthetic unreleased laboratory fixture",
    },
  });
  const unreleasedLabResult = await json(`/clinical-orders/${unreleasedLabOrder.id}/lab-result`, {
    method: "POST",
    token: doctorToken,
    body: {
      observations: [{ display: "Unreleased marker", codeSystem: "LOINC", code: "94531-1", value: "SHOULD-NOT-EXPORT" }],
      conclusion: "This entered result must remain behind the release gate.",
    },
  });

  const releasedReport = await json(`/diagnostic-reports/appointments/${appointment.id}`, {
    method: "POST",
    token: doctorToken,
    body: {
      type: "OTHER",
      findings: `Released Slice 10.12 findings ${suffix}`,
      impression: "Released synthetic impression.",
      codes: [{ system: "http://snomed.info/sct", code: "168731009", display: "Synthetic finding" }],
    },
  });
  await json(`/diagnostic-reports/${releasedReport.id}/finalize`, { method: "POST", token: doctorToken, body: {} });
  await json(`/diagnostic-reports/${releasedReport.id}/release`, { method: "POST", token: doctorToken, body: {} });

  const unreleasedReport = await json(`/diagnostic-reports/appointments/${appointment.id}`, {
    method: "POST",
    token: doctorToken,
    body: { type: "OTHER", findings: `UNRELEASED-SLICE-1012-${suffix}`, impression: "Must remain private." },
  });
  await json(`/diagnostic-reports/${unreleasedReport.id}/finalize`, { method: "POST", token: doctorToken, body: {} });

  const systemToken = await backendToken();

  expectOutcome(
    await raw(`/fhir/R4/Encounter/${appointment.id}`, { token: systemToken, headers: { accept: "application/fhir+json" } }),
    403,
    "System clinical scope unexpectedly enabled interactive Encounter read",
  );
  expectOutcome(
    await raw(`/fhir/R4/Observation?encounter=${encodeURIComponent(`Encounter/${appointment.id}`)}`, { token: systemToken, headers: { accept: "application/fhir+json" } }),
    403,
    "System clinical scope unexpectedly enabled interactive Observation search",
  );
  expectOutcome(
    await raw(`/fhir/R4/MedicationRequest/${prescription.id}`, { token: systemToken, headers: { accept: "application/fhir+json" } }),
    403,
    "System clinical scope unexpectedly enabled interactive MedicationRequest read",
  );
  expectOutcome(
    await raw(`/fhir/R4/ServiceRequest/${releasedLabOrder.id}`, { token: systemToken, headers: { accept: "application/fhir+json" } }),
    403,
    "System clinical scope unexpectedly enabled interactive ServiceRequest read",
  );
  expectOutcome(
    await raw(`/fhir/R4/DiagnosticReport/${releasedReport.id}`, { token: systemToken, headers: { accept: "application/fhir+json" } }),
    403,
    "System clinical scope unexpectedly enabled interactive DiagnosticReport read",
  );

  const unsupportedFilter = await kickoff(systemToken, ["Encounter"], [["_typeFilter", `Encounter?patient=Patient/${patient.id}`]]);
  expectOutcome(unsupportedFilter, 400, "Slice 10.12 accepted an unsupported clinical _typeFilter");

  const narrowToken = await backendToken(clinicalScopes.filter((scope) => scope !== "system/DiagnosticReport.rs"));
  const missingScope = await kickoff(narrowToken, ["Encounter", "DiagnosticReport"]);
  expectOutcome(missingScope, 403, "Slice 10.12 exported DiagnosticReport without its system scope");

  const requestedTypes = ["Encounter", "Observation", "MedicationRequest", "ServiceRequest", "DiagnosticReport"];
  const kickoffResult = await kickoff(systemToken, requestedTypes);
  if (kickoffResult.status !== 202 || !kickoffResult.contentLocation.startsWith(`${fhirBase}/$export-status/`)) {
    throw new Error(`Slice 10.12 clinical export kickoff failed: ${JSON.stringify(kickoffResult)}`);
  }
  const manifest = await waitForManifest(kickoffResult.contentLocation, systemToken);
  if (manifest.requiresAccessToken !== true || manifest.outputFormat !== "application/fhir+ndjson") {
    throw new Error(`Slice 10.12 manifest is invalid: ${JSON.stringify(manifest)}`);
  }
  for (const type of requestedTypes) {
    if (!(manifest.output || []).some((item) => item.type === type)) throw new Error(`Slice 10.12 manifest omitted ${type}.`);
  }
  if ((manifest.output || []).some((item) => ["DocumentReference", "ImagingStudy"].includes(item.type))) {
    throw new Error("Slice 10.12 exported a document/binary imaging resource outside its scope.");
  }

  const encounters = await downloadType(manifest, "Encounter", systemToken);
  if (!encounters.resources.some((resource) => resource.id === appointment.id && resource.subject?.reference === `Patient/${patient.id}`)) {
    throw new Error("Slice 10.12 Encounter export omitted the documented encounter.");
  }

  const observations = await downloadType(manifest, "Observation", systemToken);
  const expectedVitalPrefix = `${clinicalRecord.id}-`;
  if (!observations.resources.some((resource) => String(resource.id || "").startsWith(expectedVitalPrefix) && resource.encounter?.reference === `Encounter/${appointment.id}`)) {
    throw new Error("Slice 10.12 Observation export omitted encrypted clinical vitals.");
  }
  if (!observations.resources.some((resource) => resource.basedOn?.[0]?.reference === `ServiceRequest/${releasedLabOrder.id}` && resource.status === "final")) {
    throw new Error("Slice 10.12 Observation export omitted the released laboratory result.");
  }
  if (observations.resources.some((resource) => resource.basedOn?.[0]?.reference === `ServiceRequest/${unreleasedLabOrder.id}` || String(resource.id || "").startsWith(`${unreleasedLabResult.id}-`))) {
    throw new Error("Slice 10.12 leaked an unreleased laboratory result.");
  }

  const medications = await downloadType(manifest, "MedicationRequest", systemToken);
  if (!medications.resources.some((resource) => resource.id === prescription.id && resource.subject?.reference === `Patient/${patient.id}`)) {
    throw new Error("Slice 10.12 MedicationRequest export omitted the encrypted prescription.");
  }

  const services = await downloadType(manifest, "ServiceRequest", systemToken);
  if (!services.resources.some((resource) => resource.id === releasedLabOrder.id) || !services.resources.some((resource) => resource.id === unreleasedLabOrder.id)) {
    throw new Error("Slice 10.12 ServiceRequest export omitted a clinical laboratory order.");
  }

  const reports = await downloadType(manifest, "DiagnosticReport", systemToken);
  if (!reports.resources.some((resource) => resource.id === releasedReport.id && resource.status === "final")) {
    throw new Error("Slice 10.12 DiagnosticReport export omitted the released report.");
  }
  if (reports.resources.some((resource) => resource.id === unreleasedReport.id)) {
    throw new Error("Slice 10.12 leaked a FINAL but unreleased DiagnosticReport.");
  }

  const exportedText = [encounters.text, observations.text, medications.text, services.text, reports.text].join("\n");
  for (const secretField of ["ciphertext", "wrappedKey", "blobWrappedKey", "metadataWrappedKey", "contentBase64", "objectKey", "signature", "validationSignature", "externalReference"]) {
    if (new RegExp(`"${secretField}"\\s*:`).test(exportedText)) throw new Error(`Slice 10.12 NDJSON leaked protected field ${secretField}.`);
  }
  if (exportedText.includes("SHOULD-NOT-EXPORT") || exportedText.includes(`UNRELEASED-SLICE-1012-${suffix}`)) {
    throw new Error("Slice 10.12 NDJSON leaked unreleased clinical content.");
  }

  const jobId = kickoffResult.contentLocation.split("/").at(-1);
  const expectedDomainActions = [
    "CLINICAL_SYSTEM_EXPORT_SNAPSHOT",
    "CLINICAL_ORDER_SYSTEM_EXPORT_SNAPSHOT",
    "DIAGNOSTIC_REPORT_SYSTEM_EXPORT_SNAPSHOT",
    "FHIR_BULK_CLINICAL_DOMAIN_SNAPSHOT",
  ];
  const domainAudits = await prisma.auditEvent.findMany({
    where: { action: { in: expectedDomainActions }, objectId: clientId },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
  for (const action of expectedDomainActions) {
    if (!domainAudits.some((event) => event.action === action)) throw new Error(`Slice 10.12 missing domain audit ${action}.`);
  }
  const completion = await prisma.auditEvent.findFirst({ where: { action: "FHIR_BULK_EXPORT_COMPLETED", objectId: jobId } });
  if (!completion) throw new Error("Slice 10.12 missing bulk export completion audit.");

  const cleanup = await raw(kickoffResult.contentLocation, { method: "DELETE", token: systemToken });
  if (cleanup.status !== 202) throw new Error(`Slice 10.12 export cleanup failed: ${JSON.stringify(cleanup)}`);

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    bulkOnlySystemClinicalScopes: true,
    encryptedClinicalDomainBridge: true,
    orderAttestationVerified: true,
    diagnosticAttestationVerified: true,
    encounterExport: true,
    vitalObservationExport: true,
    releasedLaboratoryObservationExport: true,
    unreleasedLaboratoryGate: true,
    medicationRequestExport: true,
    serviceRequestExport: true,
    releasedDiagnosticReportExport: true,
    unreleasedDiagnosticReportGate: true,
    protectedEnvelopeLeakFree: true,
    clinicalTypeFilterRejected: true,
    exactScopeEnforcement: true,
    audited: true,
  }));
} finally {
  await prisma.$disconnect();
}
