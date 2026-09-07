import { PrismaClient } from "@prisma/client";
import { hashPasswordAsync } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const patientPassword = `Cp!${suffix}Patient9Aa`;
const doctorPassword = `Cp!${suffix}Doctor9Aa`;
const patientAEmail = `fhir-doc-a-${suffix}@carepoint.test`;
const patientBEmail = `fhir-doc-b-${suffix}@carepoint.test`;
const doctorEmail = `fhir-doc-doctor-${suffix}@carepoint.test`;

async function raw(path, { method = "GET", token, body, accept = "application/fhir+json" } = {}) {
  const headers = { accept, "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function request(path, options = {}) {
  const result = await raw(path, { ...options, accept: "application/json" });
  if (result.status < 200 || result.status >= 300) throw new Error(`${options.method || "GET"} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function login(email, password) {
  const result = await request("/iam/login", { method: "POST", body: { email, password } });
  if (!result.accessToken) throw new Error(`login did not return access token for ${email}`);
  return result.accessToken;
}

async function registerPatient(email, firstName) {
  await request("/iam/register/patient", { method: "POST", body: { email, password: patientPassword, firstName, lastName: "FHIR Document Test" } });
  return login(email, patientPassword);
}

function expectDenied(result, label) {
  if (result.status !== 403 || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
}

try {
  const metadata = await raw("/fhir/R4/metadata");
  if (metadata.status !== 200 || metadata.payload.resourceType !== "CapabilityStatement" || metadata.payload.software?.version !== "slice-10.3") throw new Error(`FHIR metadata failed: ${JSON.stringify(metadata)}`);
  const resources = metadata.payload.rest?.[0]?.resource?.map((resource) => resource.type) || [];
  for (const type of ["DiagnosticReport", "DocumentReference"]) if (!resources.includes(type)) throw new Error(`FHIR metadata does not advertise ${type}.`);

  const patientAToken = await registerPatient(patientAEmail, "Alice");
  const patientBToken = await registerPatient(patientBEmail, "Bob");
  const patientA = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientAEmail } } });
  const patientB = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientBEmail } } });

  const doctorUser = await prisma.user.create({ data: { email: doctorEmail, passwordHash: await hashPasswordAsync(doctorPassword), role: "DOCTOR" } });
  const provider = await prisma.provider.create({ data: { userId: doctorUser.id, class: "DOCTOR", displayName: "FHIR Diagnostic Doctor", status: "ACTIVE" } });
  const doctorToken = await login(doctorEmail, doctorPassword);

  const service = await request("/provider/services", {
    method: "POST", token: doctorToken,
    body: { labels: { en: "FHIR Diagnostic Consultation", ar: "استشارة تشخيص", fr: "Consultation diagnostique", es: "Consulta diagnostica" }, currency: "USD", modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 7500 }] },
  });
  const startsAt = new Date(Date.now() + 86400000);
  const appointment = await prisma.appointment.create({ data: { patientId: patientB.id, providerId: provider.id, serviceId: service.id, idempotencyKey: `fhir-doc-${suffix}`, modality: "CLINIC", status: "CONFIRMED", startsAt, endsAt: new Date(startsAt.getTime() + 1800000) } });

  const binaryMarker = `SLICE103-BINARY-${suffix}`;
  const document = await request(`/clinical-documents/appointments/${appointment.id}/upload`, {
    method: "POST", token: doctorToken,
    body: { kind: "IMAGING_REPORT", mediaType: "text/plain", fileName: `slice103-${suffix}.txt`, title: "Slice 10.3 synthetic imaging report", contentBase64: Buffer.from(binaryMarker).toString("base64") },
  });

  const doctorDocument = await raw(`/fhir/R4/DocumentReference/${document.id}`, { token: doctorToken });
  if (doctorDocument.status !== 200 || doctorDocument.payload.resourceType !== "DocumentReference" || doctorDocument.payload.docStatus !== "preliminary") throw new Error(`Doctor DocumentReference failed: ${JSON.stringify(doctorDocument)}`);
  if (doctorDocument.payload.subject?.reference !== `Patient/${patientB.id}` || doctorDocument.payload.author?.[0]?.reference !== `Practitioner/${provider.id}` || doctorDocument.payload.context?.encounter?.[0]?.reference !== `Encounter/${appointment.id}`) throw new Error(`DocumentReference relationships failed: ${JSON.stringify(doctorDocument.payload)}`);
  if (doctorDocument.payload.content?.[0]?.attachment?.url !== `/api/v1/clinical-documents/${document.id}/download`) throw new Error(`DocumentReference attachment URL failed: ${JSON.stringify(doctorDocument.payload.content)}`);
  if (JSON.stringify(doctorDocument.payload).includes(binaryMarker) || JSON.stringify(doctorDocument.payload).includes("contentBase64")) throw new Error("DocumentReference embedded document content.");
  expectDenied(await raw(`/fhir/R4/DocumentReference/${document.id}`, { token: patientBToken }), "unreleased patient document should be denied");
  expectDenied(await raw(`/fhir/R4/DocumentReference/${document.id}`, { token: patientAToken }), "cross-patient document should be denied");

  const reportMarker = `SLICE103-DIAGNOSTIC-${suffix}`;
  const report = await request(`/diagnostic-reports/appointments/${appointment.id}`, {
    method: "POST", token: doctorToken,
    body: { type: "IMAGING", documentId: document.id, findings: `Synthetic findings ${reportMarker}`, impression: "No acute synthetic abnormality.", recommendation: "Synthetic follow-up only.", codes: [{ system: "http://snomed.info/sct", code: "168731009", display: "Imaging finding" }] },
  });

  const doctorDraft = await raw(`/fhir/R4/DiagnosticReport/${report.id}`, { token: doctorToken });
  if (doctorDraft.status !== 200 || doctorDraft.payload.resourceType !== "DiagnosticReport" || doctorDraft.payload.status !== "preliminary") throw new Error(`Draft DiagnosticReport failed: ${JSON.stringify(doctorDraft)}`);
  if (doctorDraft.payload.subject?.reference !== `Patient/${patientB.id}` || doctorDraft.payload.encounter?.reference !== `Encounter/${appointment.id}` || doctorDraft.payload.performer?.[0]?.reference !== `Practitioner/${provider.id}`) throw new Error(`DiagnosticReport relationships failed: ${JSON.stringify(doctorDraft.payload)}`);
  if (doctorDraft.payload.presentedForm?.[0]?.url !== `DocumentReference/${document.id}` || !doctorDraft.payload.conclusion?.includes(reportMarker)) throw new Error(`DiagnosticReport content mapping failed: ${JSON.stringify(doctorDraft.payload)}`);
  expectDenied(await raw(`/fhir/R4/DiagnosticReport/${report.id}`, { token: patientBToken }), "draft patient report should be denied");
  expectDenied(await raw(`/fhir/R4/DiagnosticReport/${report.id}`, { token: patientAToken }), "cross-patient report should be denied");

  const finalized = await request(`/diagnostic-reports/${report.id}/finalize`, { method: "POST", token: doctorToken, body: {} });
  if (finalized.status !== "FINAL") throw new Error(`Diagnostic report finalization failed: ${JSON.stringify(finalized)}`);
  const doctorFinal = await raw(`/fhir/R4/DiagnosticReport/${report.id}`, { token: doctorToken });
  if (doctorFinal.status !== 200 || doctorFinal.payload.status !== "final") throw new Error(`Final DiagnosticReport mapping failed: ${JSON.stringify(doctorFinal)}`);
  expectDenied(await raw(`/fhir/R4/DiagnosticReport/${report.id}`, { token: patientBToken }), "final unreleased report should be denied");

  const released = await request(`/diagnostic-reports/${report.id}/release`, { method: "POST", token: doctorToken, body: {} });
  if (released.status !== "RELEASED") throw new Error(`Diagnostic report release failed: ${JSON.stringify(released)}`);
  const patientReport = await raw(`/fhir/R4/DiagnosticReport/${report.id}`, { token: patientBToken });
  if (patientReport.status !== 200 || patientReport.payload.status !== "final" || !patientReport.payload.conclusion?.includes(reportMarker)) throw new Error(`Released patient DiagnosticReport failed: ${JSON.stringify(patientReport)}`);
  const patientDocument = await raw(`/fhir/R4/DocumentReference/${document.id}`, { token: patientBToken });
  if (patientDocument.status !== 200 || patientDocument.payload.docStatus !== "final") throw new Error(`Released patient DocumentReference failed: ${JSON.stringify(patientDocument)}`);
  if (JSON.stringify(patientDocument.payload).includes(binaryMarker) || JSON.stringify(patientDocument.payload).includes("contentBase64")) throw new Error("Released DocumentReference embedded document content.");

  console.log(JSON.stringify({ status: "passed", softwareVersion: metadata.payload.software?.version, patientId: patientB.id, practitionerId: provider.id, appointmentId: appointment.id, diagnosticReportId: report.id, documentReferenceId: document.id, patientReleaseGate: true, crossPatientDenied: true, binaryNotEmbedded: true }));
} finally {
  await prisma.$disconnect();
}
