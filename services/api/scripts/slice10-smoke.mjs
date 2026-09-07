import { PrismaClient } from "@prisma/client";
import { hashPasswordAsync } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const patientPassword = "CarePoint-Fhir-Patient-Test";
const doctorPassword = "CarePoint-Fhir-Doctor-Test";
const patientAEmail = `fhir-patient-a-${suffix}@carepoint.test`;
const patientBEmail = `fhir-patient-b-${suffix}@carepoint.test`;
const doctorEmail = `fhir-doctor-${suffix}@carepoint.test`;

async function raw(path, { method = "GET", token, body, accept = "application/fhir+json" } = {}) {
  const headers = { accept, "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload, contentType: response.headers.get("content-type") || "" };
}

async function request(path, options = {}) {
  const result = await raw(path, { ...options, accept: "application/json" });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${options.method || "GET"} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function login(email, password) {
  const result = await request("/iam/login", { method: "POST", body: { email, password } });
  if (!result.accessToken) throw new Error(`login did not return access token for ${email}`);
  return result.accessToken;
}

async function registerPatient(email, firstName) {
  await request("/iam/register/patient", {
    method: "POST",
    body: { email, password: patientPassword, firstName, lastName: "FHIR Test" },
  });
  return login(email, patientPassword);
}

try {
  const metadata = await raw("/fhir/R4/metadata");
  if (metadata.status !== 200 || metadata.payload.resourceType !== "CapabilityStatement" || metadata.payload.fhirVersion !== "4.0.1") {
    throw new Error(`FHIR metadata failed: ${JSON.stringify(metadata)}`);
  }
  if (!metadata.contentType.includes("application/fhir+json")) throw new Error(`FHIR content type missing: ${metadata.contentType}`);

  const patientAToken = await registerPatient(patientAEmail, "Alice");
  const patientBToken = await registerPatient(patientBEmail, "Bob");
  const patientA = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientAEmail } } });
  const patientB = await prisma.patientProfile.findFirstOrThrow({ where: { user: { email: patientBEmail } } });

  const doctorUser = await prisma.user.create({
    data: { email: doctorEmail, passwordHash: await hashPasswordAsync(doctorPassword), role: "DOCTOR" },
  });
  const provider = await prisma.provider.create({
    data: { userId: doctorUser.id, class: "DOCTOR", displayName: "FHIR Test Doctor", status: "ACTIVE" },
  });
  const doctorToken = await login(doctorEmail, doctorPassword);

  const service = await request("/provider/services", {
    method: "POST",
    token: doctorToken,
    body: {
      labels: { en: "FHIR Test Consultation", ar: "استشارة اختبار FHIR", fr: "Consultation de test FHIR", es: "Consulta de prueba FHIR" },
      currency: "USD",
      modalities: [{ modality: "CLINIC", durationMinutes: 30, priceMinor: 5000 }],
    },
  });

  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patientB.id,
      providerId: provider.id,
      serviceId: service.id,
      idempotencyKey: `fhir-${suffix}-appointment`,
      modality: "CLINIC",
      status: "CONFIRMED",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
    },
  });

  const patientSelf = await raw(`/fhir/R4/Patient/${encodeURIComponent(patientA.id)}`, { token: patientAToken });
  if (patientSelf.status !== 200 || patientSelf.payload.resourceType !== "Patient" || patientSelf.payload.id !== patientA.id) {
    throw new Error(`FHIR Patient self read failed: ${JSON.stringify(patientSelf)}`);
  }

  const crossPatient = await raw(`/fhir/R4/Patient/${encodeURIComponent(patientA.id)}`, { token: patientBToken });
  if (crossPatient.status !== 403 || crossPatient.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected FHIR Patient cross-access OperationOutcome 403, got ${JSON.stringify(crossPatient)}`);
  }

  const practitioner = await raw(`/fhir/R4/Practitioner/${encodeURIComponent(provider.id)}`);
  if (practitioner.status !== 200 || practitioner.payload.resourceType !== "Practitioner" || practitioner.payload.id !== provider.id) {
    throw new Error(`FHIR Practitioner read failed: ${JSON.stringify(practitioner)}`);
  }
  if (JSON.stringify(practitioner.payload).includes("passwordHash") || JSON.stringify(practitioner.payload).includes(doctorEmail)) {
    throw new Error("Public FHIR Practitioner leaked private account data.");
  }

  const patientAppointment = await raw(`/fhir/R4/Appointment/${encodeURIComponent(appointment.id)}`, { token: patientBToken });
  if (patientAppointment.status !== 200 || patientAppointment.payload.resourceType !== "Appointment" || patientAppointment.payload.id !== appointment.id) {
    throw new Error(`FHIR Appointment participant read failed: ${JSON.stringify(patientAppointment)}`);
  }
  if (!Array.isArray(patientAppointment.payload.participant) || patientAppointment.payload.participant.length !== 2) {
    throw new Error(`FHIR Appointment participants missing: ${JSON.stringify(patientAppointment.payload)}`);
  }

  const doctorAppointment = await raw(`/fhir/R4/Appointment/${encodeURIComponent(appointment.id)}`, { token: doctorToken });
  if (doctorAppointment.status !== 200) throw new Error(`Assigned practitioner could not read FHIR Appointment: ${JSON.stringify(doctorAppointment)}`);

  const wrongPatientAppointment = await raw(`/fhir/R4/Appointment/${encodeURIComponent(appointment.id)}`, { token: patientAToken });
  if (wrongPatientAppointment.status !== 403 || wrongPatientAppointment.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected FHIR Appointment cross-patient 403, got ${JSON.stringify(wrongPatientAppointment)}`);
  }

  const search = await raw(`/fhir/R4/Appointment?patient=${encodeURIComponent(`Patient/${patientB.id}`)}`, { token: patientBToken });
  if (search.status !== 200 || search.payload.resourceType !== "Bundle" || search.payload.type !== "searchset" || search.payload.total !== 1) {
    throw new Error(`FHIR Appointment search failed: ${JSON.stringify(search)}`);
  }
  if (!search.payload.entry?.every((entry) => entry.resource?.resourceType === "Appointment")) {
    throw new Error(`FHIR Appointment search returned unexpected resources: ${JSON.stringify(search.payload)}`);
  }

  const crossSearch = await raw(`/fhir/R4/Appointment?patient=${encodeURIComponent(patientB.id)}`, { token: patientAToken });
  if (crossSearch.status !== 403 || crossSearch.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected cross-patient FHIR search 403, got ${JSON.stringify(crossSearch)}`);
  }

  console.log(JSON.stringify({
    status: "passed",
    fhirVersion: metadata.payload.fhirVersion,
    patientId: patientB.id,
    practitionerId: provider.id,
    appointmentId: appointment.id,
    appointmentSearchTotal: search.payload.total,
    crossPatientStatus: crossPatient.status,
    crossAppointmentStatus: wrongPatientAppointment.status,
  }));
} finally {
  await prisma.$disconnect();
}
