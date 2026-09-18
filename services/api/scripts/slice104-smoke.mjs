import { PrismaClient } from "@prisma/client";
import { hashPasswordAsync } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const patientPassword = `Cp!${suffix}Patient9Aa`;
const doctorPassword = `Cp!${suffix}Doctor9Aa`;
const patientAEmail = `fhir-image-a-${suffix}@carepoint.test`;
const patientBEmail = `fhir-image-b-${suffix}@carepoint.test`;
const doctorEmail = `fhir-image-doctor-${suffix}@carepoint.test`;
const studyUid = `1.2.826.0.1.3680043.10.543.${Date.now()}`;
const seriesUid = `${studyUid}.1`;

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
  await request("/iam/register/patient", { method: "POST", body: { email, password: patientPassword, firstName, lastName: "FHIR Imaging Test" } });
  return login(email, patientPassword);
}

function expectOperationOutcome(result, expectedStatus, label) {
  if (result.status !== expectedStatus || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
}

function assertNoPacsLeak(payload, label) {
  const serialized = JSON.stringify(payload);
  for (const marker of ["pacs.carepoint.test", "/dicomweb/", "externalReference"]) {
    if (serialized.includes(marker)) throw new Error(`${label} leaked PACS routing data: ${serialized}`);
  }
}

try {
  const metadata = await raw("/fhir/R4/metadata");
  const softwareVersion = metadata.payload.software?.version;
  const versionMatch = typeof softwareVersion === "string" ? /^slice-10\.(\d+)$/.exec(softwareVersion) : null;
  if (metadata.status !== 200 || metadata.payload.resourceType !== "CapabilityStatement" || !versionMatch || Number(versionMatch[1]) < 4) throw new Error(`FHIR metadata failed: ${JSON.stringify(metadata)}`);
  const resources = metadata.payload.rest?.[0]?.resource?.map((resource) => resource.type) || [];
  if (!resources.includes("ImagingStudy")) throw new Error("FHIR metadata does not advertise ImagingStudy.");

  const patientAToken = await registerPatient(patientAEmail, "Alice");
  const patientBToken = await registerPatient(patientBEmail, "Bob");
  const patientA = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientAEmail } } });
  const patientB = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientBEmail } } });

  const doctorUser = await prisma.user.create({ data: { email: doctorEmail, passwordHash: await hashPasswordAsync(doctorPassword), role: "DOCTOR" } });
  const provider = await prisma.provider.create({ data: { userId: doctorUser.id, class: "DOCTOR", displayName: "FHIR Imaging Doctor", status: "ACTIVE" } });
  const doctorToken = await login(doctorEmail, doctorPassword);

  const service = await request("/provider/services", {
    method: "POST", token: doctorToken,
    body: { labels: { en: "FHIR Imaging Consultation", ar: "استشارة تصوير", fr: "Consultation imagerie", es: "Consulta de imagen" }, currency: "USD", modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 8500 }] },
  });
  const startsAt = new Date(Date.now() + 2 * 86400000);
  const appointment = await prisma.appointment.create({ data: { patientId: patientB.id, providerId: provider.id, serviceId: service.id, idempotencyKey: `fhir-image-${suffix}`, modality: "CLINIC", status: "CONFIRMED", startsAt, endsAt: new Date(startsAt.getTime() + 1800000) } });

  const outsideReference = await raw(`/clinical-documents/appointments/${appointment.id}/reference`, {
    method: "POST", token: doctorToken, accept: "application/json",
    body: { title: "Outside PACS reference", externalReference: `https://untrusted.example.test/dicomweb/studies/${studyUid}` },
  });
  if (outsideReference.status !== 400) throw new Error(`DICOMweb allowlist should reject outside origin: ${JSON.stringify(outsideReference)}`);

  const reference = await request(`/clinical-documents/appointments/${appointment.id}/reference`, {
    method: "POST", token: doctorToken,
    body: { title: "Slice 10.4 synthetic CT study", description: "Synthetic study-level DICOM reference", studyInstanceUid: studyUid },
  });

  const doctorStudy = await raw(`/fhir/R4/ImagingStudy/${reference.id}`, { token: doctorToken });
  if (doctorStudy.status !== 200 || doctorStudy.payload.resourceType !== "ImagingStudy" || doctorStudy.payload.status !== "available") throw new Error(`Doctor ImagingStudy failed: ${JSON.stringify(doctorStudy)}`);
  if (doctorStudy.payload.identifier?.[0]?.system !== "urn:dicom:uid" || doctorStudy.payload.identifier?.[0]?.value !== `urn:oid:${studyUid}`) throw new Error(`DICOM study UID mapping failed: ${JSON.stringify(doctorStudy.payload.identifier)}`);
  if (doctorStudy.payload.subject?.reference !== `Patient/${patientB.id}` || doctorStudy.payload.encounter?.reference !== `Encounter/${appointment.id}`) throw new Error(`ImagingStudy relationships failed: ${JSON.stringify(doctorStudy.payload)}`);
  if (doctorStudy.payload.description !== "Slice 10.4 synthetic CT study") throw new Error(`ImagingStudy description mapping failed: ${JSON.stringify(doctorStudy.payload)}`);
  assertNoPacsLeak(doctorStudy.payload, "Doctor ImagingStudy");

  expectOperationOutcome(await raw(`/fhir/R4/ImagingStudy/${reference.id}`, { token: patientBToken }), 403, "unreleased patient ImagingStudy should be denied");
  expectOperationOutcome(await raw(`/fhir/R4/ImagingStudy/${reference.id}`, { token: patientAToken }), 403, "cross-patient ImagingStudy should be denied");

  const documentReference = await raw(`/fhir/R4/DocumentReference/${reference.id}`, { token: doctorToken });
  if (documentReference.status !== 200 || documentReference.payload.resourceType !== "DocumentReference") throw new Error(`Imaging DocumentReference failed: ${JSON.stringify(documentReference)}`);
  if (documentReference.payload.content?.[0]?.attachment?.url !== undefined) throw new Error(`External imaging DocumentReference exposed a direct retrieval URL: ${JSON.stringify(documentReference.payload)}`);
  assertNoPacsLeak(documentReference.payload, "Imaging DocumentReference");

  const seriesReference = await request(`/clinical-documents/appointments/${appointment.id}/reference`, {
    method: "POST", token: doctorToken,
    body: { title: "Series-scoped synthetic reference", studyInstanceUid: studyUid, seriesInstanceUid: seriesUid },
  });
  const seriesStudy = await raw(`/fhir/R4/ImagingStudy/${seriesReference.id}`, { token: doctorToken });
  expectOperationOutcome(seriesStudy, 409, "series-scoped reference should not fabricate a study representation");

  await request(`/clinical-documents/${reference.id}/release`, { method: "POST", token: doctorToken, body: {} });
  const patientStudy = await raw(`/fhir/R4/ImagingStudy/${reference.id}`, { token: patientBToken });
  if (patientStudy.status !== 200 || patientStudy.payload.identifier?.[0]?.value !== `urn:oid:${studyUid}`) throw new Error(`Released patient ImagingStudy failed: ${JSON.stringify(patientStudy)}`);
  assertNoPacsLeak(patientStudy.payload, "Patient ImagingStudy");
  expectOperationOutcome(await raw(`/fhir/R4/ImagingStudy/${reference.id}`, { token: patientAToken }), 403, "released study should remain cross-patient denied");

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    patientId: patientB.id,
    practitionerId: provider.id,
    appointmentId: appointment.id,
    imagingStudyId: reference.id,
    dicomStudyUid: studyUid,
    patientReleaseGate: true,
    crossPatientDenied: true,
    pacsRouteNotExposed: true,
    dicomwebAllowlist: true,
    studyScopeEnforced: true,
  }));
} finally {
  await prisma.$disconnect();
}
