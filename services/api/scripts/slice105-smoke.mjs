import { PrismaClient } from "@prisma/client";
import { hashPasswordAsync } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const patientPassword = `Cp!${suffix}Patient9Aa`;
const doctorPassword = `Cp!${suffix}Doctor9Aa`;
const patientAEmail = `fhir-search-a-${suffix}@carepoint.test`;
const patientBEmail = `fhir-search-b-${suffix}@carepoint.test`;
const doctorEmail = `fhir-search-doctor-${suffix}@carepoint.test`;

async function raw(path, { method = "GET", token, body, accept = "application/fhir+json" } = {}) {
  const headers = { accept, "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json().catch(() => ({}));
  return {
    status: response.status,
    payload,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    pragma: response.headers.get("pragma") || "",
    nosniff: response.headers.get("x-content-type-options") || "",
    vary: response.headers.get("vary") || "",
  };
}

async function request(path, options = {}) {
  const result = await raw(path, { ...options, accept: "application/json" });
  if (result.status < 200 || result.status >= 300) throw new Error(`${options.method || "GET"} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function login(email, password) {
  const result = await request("/iam/login", { method: "POST", body: { email, password } });
  if (!result.accessToken) throw new Error(`No access token for ${email}`);
  return result.accessToken;
}

async function registerPatient(email, firstName) {
  await request("/iam/register/patient", { method: "POST", body: { email, password: patientPassword, firstName, lastName: "FHIR Search Test" } });
  return login(email, patientPassword);
}

function expectOperationOutcome(result, status, label) {
  if (result.status !== status || result.payload.resourceType !== "OperationOutcome") throw new Error(`${label}: ${JSON.stringify(result)}`);
  if (!result.cacheControl.includes("no-store") || result.nosniff !== "nosniff") throw new Error(`${label}: hardened error headers missing.`);
}

function expectSearchBundle(result, label) {
  if (result.status !== 200 || result.payload.resourceType !== "Bundle" || result.payload.type !== "searchset") throw new Error(`${label}: ${JSON.stringify(result)}`);
  if (!result.cacheControl.includes("no-store") || result.pragma !== "no-cache" || result.nosniff !== "nosniff") throw new Error(`${label}: hardened response headers missing.`);
  return result.payload;
}

try {
  const metadata = await raw("/fhir/R4/metadata");
  const softwareVersion = metadata.payload.software?.version;
  const versionMatch = typeof softwareVersion === "string" ? /^slice-10\.(\d+)$/.exec(softwareVersion) : null;
  if (metadata.status !== 200 || metadata.payload.resourceType !== "CapabilityStatement" || !versionMatch || Number(versionMatch[1]) < 5) throw new Error(`FHIR metadata failed: ${JSON.stringify(metadata)}`);
  if (!metadata.cacheControl.includes("no-store") || metadata.nosniff !== "nosniff") throw new Error("FHIR metadata hardening headers missing.");
  const capabilities = new Map((metadata.payload.rest?.[0]?.resource || []).map((resource) => [resource.type, resource]));
  for (const type of ["Appointment", "DiagnosticReport", "DocumentReference"]) {
    const capability = capabilities.get(type);
    if (!capability?.interaction?.some((interaction) => interaction.code === "search-type")) throw new Error(`${type} search-type capability missing.`);
  }
  if (!capabilities.get("Appointment")?.searchParam?.some((item) => item.name === "status")) throw new Error("Appointment status search parameter missing.");

  const patientAToken = await registerPatient(patientAEmail, "Alice");
  const patientBToken = await registerPatient(patientBEmail, "Bob");
  const patientA = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientAEmail } } });
  const patientB = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientBEmail } } });

  const doctorUser = await prisma.user.create({ data: { email: doctorEmail, passwordHash: await hashPasswordAsync(doctorPassword), role: "DOCTOR" } });
  const provider = await prisma.provider.create({ data: { userId: doctorUser.id, class: "DOCTOR", displayName: "FHIR Search Doctor", status: "ACTIVE" } });
  const doctorToken = await login(doctorEmail, doctorPassword);
  const service = await request("/provider/services", {
    method: "POST",
    token: doctorToken,
    body: { labels: { en: "FHIR Search Consultation", ar: "بحث FHIR", fr: "Recherche FHIR", es: "Busqueda FHIR" }, currency: "USD", modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 5000 }] },
  });

  const startBase = Date.now() + 86400000;
  const appointmentStatuses = ["CONFIRMED", "CANCELLED", "COMPLETED"];
  const appointments = [];
  for (let i = 0; i < appointmentStatuses.length; i += 1) {
    const startsAt = new Date(startBase + i * 3600000);
    appointments.push(await prisma.appointment.create({ data: {
      patientId: patientB.id,
      providerId: provider.id,
      serviceId: service.id,
      idempotencyKey: `fhir-search-${suffix}-${i}`,
      modality: "CLINIC",
      status: appointmentStatuses[i],
      startsAt,
      endsAt: new Date(startsAt.getTime() + 1800000),
      ...(appointmentStatuses[i] === "CANCELLED" ? { cancellationReason: "Synthetic search fixture" } : {}),
    } }));
  }

  const appointmentPage1 = expectSearchBundle(await raw(`/fhir/R4/Appointment?patient=Patient/${patientB.id}&_count=1&_offset=0`, { token: patientBToken }), "Appointment page 1");
  if (appointmentPage1.total !== 3 || appointmentPage1.entry?.length !== 1 || !appointmentPage1.link?.some((link) => link.relation === "next" && link.url.includes("_offset=1"))) throw new Error(`Appointment pagination failed: ${JSON.stringify(appointmentPage1)}`);
  const firstAppointmentId = appointmentPage1.entry[0].resource.id;
  const appointmentPage2 = expectSearchBundle(await raw(`/fhir/R4/Appointment?patient=${patientB.id}&_count=1&_offset=1`, { token: patientBToken }), "Appointment page 2");
  if (appointmentPage2.entry?.length !== 1 || appointmentPage2.entry[0].resource.id === firstAppointmentId || !appointmentPage2.link?.some((link) => link.relation === "previous")) throw new Error(`Appointment page continuity failed: ${JSON.stringify(appointmentPage2)}`);
  const booked = expectSearchBundle(await raw(`/fhir/R4/Appointment?patient=${patientB.id}&status=booked`, { token: patientBToken }), "Appointment status filter");
  if (booked.total !== 1 || booked.entry?.[0]?.resource?.status !== "booked") throw new Error(`Appointment status filter failed: ${JSON.stringify(booked)}`);
  expectOperationOutcome(await raw(`/fhir/R4/Appointment?patient=${patientB.id}&_count=101`, { token: patientBToken }), 400, "count limit");
  expectOperationOutcome(await raw(`/fhir/R4/Appointment?patient=${patientB.id}&unexpected=1`, { token: patientBToken }), 400, "unsupported search parameter");
  expectOperationOutcome(await raw(`/fhir/R4/Appointment?patient=${patientB.id}`, { token: patientAToken }), 403, "cross-patient appointment search");

  const documentIds = [];
  const reportIds = [];
  for (let i = 0; i < 2; i += 1) {
    const document = await request(`/clinical-documents/appointments/${appointments[0].id}/upload`, {
      method: "POST",
      token: doctorToken,
      body: { kind: "IMAGING_REPORT", mediaType: "text/plain", fileName: `slice105-${suffix}-${i}.txt`, title: `Slice 10.5 document ${i}`, contentBase64: Buffer.from(`SLICE105-${suffix}-${i}`).toString("base64") },
    });
    await request(`/clinical-documents/${document.id}/release`, { method: "POST", token: doctorToken, body: {} });
    documentIds.push(document.id);
    const report = await request(`/diagnostic-reports/appointments/${appointments[0].id}`, {
      method: "POST",
      token: doctorToken,
      body: { type: "IMAGING", documentId: document.id, findings: `Synthetic paginated finding ${i}`, impression: `Synthetic impression ${i}` },
    });
    await request(`/diagnostic-reports/${report.id}/finalize`, { method: "POST", token: doctorToken, body: {} });
    await request(`/diagnostic-reports/${report.id}/release`, { method: "POST", token: doctorToken, body: {} });
    reportIds.push(report.id);
  }

  const documentsPage1 = expectSearchBundle(await raw(`/fhir/R4/DocumentReference?patient=Patient/${patientB.id}&status=current&_count=1&_offset=0`, { token: patientBToken }), "DocumentReference page 1");
  if (documentsPage1.total !== 2 || documentsPage1.entry?.length !== 1 || !documentsPage1.link?.some((link) => link.relation === "next")) throw new Error(`DocumentReference pagination failed: ${JSON.stringify(documentsPage1)}`);
  const superseded = expectSearchBundle(await raw(`/fhir/R4/DocumentReference?patient=${patientB.id}&status=superseded`, { token: patientBToken }), "DocumentReference empty status");
  if (superseded.total !== 0 || (superseded.entry?.length || 0) !== 0) throw new Error(`DocumentReference status semantics failed: ${JSON.stringify(superseded)}`);
  expectOperationOutcome(await raw(`/fhir/R4/DocumentReference?patient=${patientB.id}`, { token: patientAToken }), 403, "cross-patient document search");

  const reportsPage1 = expectSearchBundle(await raw(`/fhir/R4/DiagnosticReport?patient=Patient/${patientB.id}&status=final&_count=1&_offset=0`, { token: patientBToken }), "DiagnosticReport page 1");
  if (reportsPage1.total !== 2 || reportsPage1.entry?.length !== 1 || reportsPage1.entry[0].resource.status !== "final" || !reportsPage1.link?.some((link) => link.relation === "next")) throw new Error(`DiagnosticReport pagination failed: ${JSON.stringify(reportsPage1)}`);
  const preliminary = expectSearchBundle(await raw(`/fhir/R4/DiagnosticReport?patient=${patientB.id}&status=preliminary`, { token: patientBToken }), "DiagnosticReport patient release filter");
  if (preliminary.total !== 0) throw new Error(`Patient diagnostic release gate failed: ${JSON.stringify(preliminary)}`);
  expectOperationOutcome(await raw(`/fhir/R4/DiagnosticReport?patient=${patientB.id}&status=bogus`, { token: patientBToken }), 400, "invalid diagnostic status");
  expectOperationOutcome(await raw(`/fhir/R4/DiagnosticReport?patient=${patientB.id}`, { token: patientAToken }), 403, "cross-patient diagnostic search");

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    patientId: patientB.id,
    appointmentTotal: appointmentPage1.total,
    documentReferenceTotal: documentsPage1.total,
    diagnosticReportTotal: reportsPage1.total,
    paginationLinks: true,
    strictParameters: true,
    patientIsolation: true,
    noStoreHeaders: true,
  }));
} finally {
  await prisma.$disconnect();
}
