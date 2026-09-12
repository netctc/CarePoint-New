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
  const advertisedResources = metadata.payload.rest?.[0]?.resource?.map((resource) => resource.type) || [];
  for (const resourceType of ["Patient", "Practitioner", "Appointment", "Encounter", "Observation", "MedicationRequest", "ServiceRequest"]) {
    if (!advertisedResources.includes(resourceType)) throw new Error(`FHIR metadata does not advertise ${resourceType}.`);
  }

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

  const encounterBeforeDocumentation = await raw(`/fhir/R4/Encounter/${encodeURIComponent(appointment.id)}`, { token: patientBToken });
  if (encounterBeforeDocumentation.status !== 404 || encounterBeforeDocumentation.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected undocumented FHIR Encounter to return 404, got ${JSON.stringify(encounterBeforeDocumentation)}`);
  }

  const clinicalRecord = await request(`/clinical/appointments/${appointment.id}/records`, {
    method: "POST",
    token: doctorToken,
    body: {
      chiefComplaint: "FHIR clinical interoperability smoke test",
      objective: "Stable outpatient assessment for interoperability validation.",
      vitals: {
        heartRateBpm: 72,
        oxygenSaturationPct: 99,
        systolicMmHg: 120,
        diastolicMmHg: 80,
      },
    },
  });
  if (!clinicalRecord.id || clinicalRecord.revision !== 1) throw new Error(`Clinical record creation failed: ${JSON.stringify(clinicalRecord)}`);

  const patientEncounter = await raw(`/fhir/R4/Encounter/${encodeURIComponent(appointment.id)}`, { token: patientBToken });
  if (patientEncounter.status !== 200 || patientEncounter.payload.resourceType !== "Encounter" || patientEncounter.payload.id !== appointment.id) {
    throw new Error(`FHIR Encounter patient read failed: ${JSON.stringify(patientEncounter)}`);
  }
  if (patientEncounter.payload.subject?.reference !== `Patient/${patientB.id}`) {
    throw new Error(`FHIR Encounter has incorrect patient reference: ${JSON.stringify(patientEncounter.payload.subject)}`);
  }
  if (patientEncounter.payload.appointment?.[0]?.reference !== `Appointment/${appointment.id}`) {
    throw new Error(`FHIR Encounter has incorrect Appointment reference: ${JSON.stringify(patientEncounter.payload.appointment)}`);
  }
  if (patientEncounter.payload.participant?.[0]?.individual?.reference !== `Practitioner/${provider.id}`) {
    throw new Error(`FHIR Encounter has incorrect Practitioner reference: ${JSON.stringify(patientEncounter.payload.participant)}`);
  }
  if (patientEncounter.payload.status !== "in-progress") throw new Error(`Expected in-progress Encounter before finalization: ${JSON.stringify(patientEncounter.payload)}`);

  const doctorEncounter = await raw(`/fhir/R4/Encounter/${encodeURIComponent(appointment.id)}`, { token: doctorToken });
  if (doctorEncounter.status !== 200) throw new Error(`Assigned practitioner could not read FHIR Encounter: ${JSON.stringify(doctorEncounter)}`);

  const wrongPatientEncounter = await raw(`/fhir/R4/Encounter/${encodeURIComponent(appointment.id)}`, { token: patientAToken });
  if (wrongPatientEncounter.status !== 403 || wrongPatientEncounter.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected FHIR Encounter cross-patient 403, got ${JSON.stringify(wrongPatientEncounter)}`);
  }

  const observations = await raw(`/fhir/R4/Observation?encounter=${encodeURIComponent(`Encounter/${appointment.id}`)}`, { token: patientBToken });
  if (observations.status !== 200 || observations.payload.resourceType !== "Bundle" || observations.payload.type !== "searchset" || observations.payload.total !== 4) {
    throw new Error(`FHIR Observation search failed: ${JSON.stringify(observations)}`);
  }
  for (const entry of observations.payload.entry || []) {
    if (entry.resource?.resourceType !== "Observation") throw new Error(`FHIR Observation bundle contains a non-Observation resource: ${JSON.stringify(entry)}`);
    if (entry.resource.subject?.reference !== `Patient/${patientB.id}`) throw new Error(`FHIR Observation has incorrect patient reference: ${JSON.stringify(entry.resource)}`);
    if (entry.resource.encounter?.reference !== `Encounter/${appointment.id}`) throw new Error(`FHIR Observation has incorrect Encounter reference: ${JSON.stringify(entry.resource)}`);
    if (entry.resource.status !== "preliminary") throw new Error(`Expected preliminary Observation before finalization: ${JSON.stringify(entry.resource)}`);
  }

  const doctorObservations = await raw(`/fhir/R4/Observation?encounter=${encodeURIComponent(appointment.id)}`, { token: doctorToken });
  if (doctorObservations.status !== 200 || doctorObservations.payload.total !== 4) {
    throw new Error(`Assigned practitioner could not search FHIR Observations: ${JSON.stringify(doctorObservations)}`);
  }

  const wrongPatientObservations = await raw(`/fhir/R4/Observation?encounter=${encodeURIComponent(appointment.id)}`, { token: patientAToken });
  if (wrongPatientObservations.status !== 403 || wrongPatientObservations.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected FHIR Observation cross-patient 403, got ${JSON.stringify(wrongPatientObservations)}`);
  }

  const missingObservationSearch = await raw("/fhir/R4/Observation", { token: patientBToken });
  if (missingObservationSearch.status !== 400 || missingObservationSearch.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected missing Observation search parameter to return FHIR 400, got ${JSON.stringify(missingObservationSearch)}`);
  }

  const finalized = await request(`/clinical/appointments/${appointment.id}/finalize`, { method: "POST", token: doctorToken, body: {} });
  if (!finalized.finalized || finalized.appointment?.status !== "COMPLETED") throw new Error(`Clinical encounter finalization failed: ${JSON.stringify(finalized)}`);

  const finishedEncounter = await raw(`/fhir/R4/Encounter/${encodeURIComponent(appointment.id)}`, { token: patientBToken });
  if (finishedEncounter.status !== 200 || finishedEncounter.payload.status !== "finished") {
    throw new Error(`FHIR Encounter did not become finished after clinical finalization: ${JSON.stringify(finishedEncounter)}`);
  }

  const finalObservations = await raw(`/fhir/R4/Observation?encounter=${encodeURIComponent(appointment.id)}`, { token: patientBToken });
  if (finalObservations.status !== 200 || finalObservations.payload.total !== 4 || !finalObservations.payload.entry?.every((entry) => entry.resource?.status === "final")) {
    throw new Error(`FHIR Observations did not become final after encounter finalization: ${JSON.stringify(finalObservations)}`);
  }

  const prescription = await request(`/clinical-orders/appointments/${appointment.id}/prescriptions`, {
    method: "POST",
    token: doctorToken,
    body: {
      idempotencyKey: `fhir-${suffix}-prescription`,
      medication: { name: "Interoperability Test Medication", codeSystem: "RxNorm", code: "1049630", strength: "10 mg", form: "tablet" },
      dosageInstruction: "Take one tablet once daily for the interoperability smoke test.",
      route: "oral",
      frequency: "once daily",
      duration: "7 days",
      quantity: 7,
      refills: 0,
      reason: "Synthetic FHIR interoperability fixture",
    },
  });
  if (prescription.type !== "PRESCRIPTION" || prescription.status !== "SIGNED") throw new Error(`Prescription creation failed: ${JSON.stringify(prescription)}`);

  const patientMedicationRequest = await raw(`/fhir/R4/MedicationRequest/${encodeURIComponent(prescription.id)}`, { token: patientBToken });
  if (patientMedicationRequest.status !== 200 || patientMedicationRequest.payload.resourceType !== "MedicationRequest" || patientMedicationRequest.payload.status !== "active") {
    throw new Error(`FHIR MedicationRequest patient read failed: ${JSON.stringify(patientMedicationRequest)}`);
  }
  if (patientMedicationRequest.payload.subject?.reference !== `Patient/${patientB.id}` || patientMedicationRequest.payload.encounter?.reference !== `Encounter/${appointment.id}`) {
    throw new Error(`FHIR MedicationRequest references are incorrect: ${JSON.stringify(patientMedicationRequest.payload)}`);
  }
  if (patientMedicationRequest.payload.requester?.reference !== `Practitioner/${provider.id}` || patientMedicationRequest.payload.medicationCodeableConcept?.text !== "Interoperability Test Medication") {
    throw new Error(`FHIR MedicationRequest clinical mapping is incorrect: ${JSON.stringify(patientMedicationRequest.payload)}`);
  }

  const doctorMedicationRequest = await raw(`/fhir/R4/MedicationRequest/${encodeURIComponent(prescription.id)}`, { token: doctorToken });
  if (doctorMedicationRequest.status !== 200) throw new Error(`Ordering practitioner could not read FHIR MedicationRequest: ${JSON.stringify(doctorMedicationRequest)}`);

  const wrongPatientMedicationRequest = await raw(`/fhir/R4/MedicationRequest/${encodeURIComponent(prescription.id)}`, { token: patientAToken });
  if (wrongPatientMedicationRequest.status !== 403 || wrongPatientMedicationRequest.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected cross-patient MedicationRequest 403, got ${JSON.stringify(wrongPatientMedicationRequest)}`);
  }

  const labOrder = await request(`/clinical-orders/appointments/${appointment.id}/laboratory`, {
    method: "POST",
    token: doctorToken,
    body: {
      idempotencyKey: `fhir-${suffix}-laboratory`,
      tests: [
        { display: "Hemoglobin", codeSystem: "LOINC", code: "718-7" },
        { display: "Synthetic qualitative marker", codeSystem: "LOINC", code: "94531-1" },
      ],
      priority: "URGENT",
      fasting: false,
      specimen: "venous blood",
      instructions: "Collect according to local laboratory protocol.",
      reason: "Synthetic FHIR interoperability fixture",
    },
  });
  if (labOrder.type !== "LABORATORY" || labOrder.status !== "SIGNED") throw new Error(`Laboratory order creation failed: ${JSON.stringify(labOrder)}`);

  const patientServiceRequest = await raw(`/fhir/R4/ServiceRequest/${encodeURIComponent(labOrder.id)}`, { token: patientBToken });
  if (patientServiceRequest.status !== 200 || patientServiceRequest.payload.resourceType !== "ServiceRequest" || patientServiceRequest.payload.status !== "active") {
    throw new Error(`FHIR ServiceRequest patient read failed: ${JSON.stringify(patientServiceRequest)}`);
  }
  if (patientServiceRequest.payload.subject?.reference !== `Patient/${patientB.id}` || patientServiceRequest.payload.encounter?.reference !== `Encounter/${appointment.id}`) {
    throw new Error(`FHIR ServiceRequest references are incorrect: ${JSON.stringify(patientServiceRequest.payload)}`);
  }
  if (patientServiceRequest.payload.requester?.reference !== `Practitioner/${provider.id}` || patientServiceRequest.payload.priority !== "urgent" || patientServiceRequest.payload.orderDetail?.length !== 2) {
    throw new Error(`FHIR ServiceRequest mapping is incorrect: ${JSON.stringify(patientServiceRequest.payload)}`);
  }

  const wrongPatientServiceRequest = await raw(`/fhir/R4/ServiceRequest/${encodeURIComponent(labOrder.id)}`, { token: patientAToken });
  if (wrongPatientServiceRequest.status !== 403 || wrongPatientServiceRequest.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected cross-patient ServiceRequest 403, got ${JSON.stringify(wrongPatientServiceRequest)}`);
  }

  const labBeforeResult = await raw(`/fhir/R4/Observation?based-on=${encodeURIComponent(`ServiceRequest/${labOrder.id}`)}`, { token: patientBToken });
  if (labBeforeResult.status !== 200 || labBeforeResult.payload.resourceType !== "Bundle" || labBeforeResult.payload.total !== 0) {
    throw new Error(`Unreleased laboratory FHIR search should be empty: ${JSON.stringify(labBeforeResult)}`);
  }

  await request(`/clinical-orders/${labOrder.id}/lab-result`, {
    method: "POST",
    token: doctorToken,
    body: {
      observations: [
        { display: "Hemoglobin", codeSystem: "LOINC", code: "718-7", value: 13.7, unit: "g/dL", referenceRange: "12.0-16.0", flag: "normal" },
        { display: "Synthetic qualitative marker", codeSystem: "LOINC", code: "94531-1", value: "Negative", referenceRange: "Negative", flag: "normal" },
      ],
      conclusion: "Synthetic laboratory result for FHIR interoperability validation.",
    },
  });

  const labAfterEntry = await raw(`/fhir/R4/Observation?based-on=${encodeURIComponent(labOrder.id)}`, { token: patientBToken });
  if (labAfterEntry.status !== 200 || labAfterEntry.payload.total !== 0) {
    throw new Error(`Entered laboratory result leaked through FHIR before release: ${JSON.stringify(labAfterEntry)}`);
  }

  await request(`/clinical-orders/${labOrder.id}/lab-result/validate`, { method: "POST", token: doctorToken, body: {} });
  const labAfterValidation = await raw(`/fhir/R4/Observation?based-on=${encodeURIComponent(labOrder.id)}`, { token: patientBToken });
  if (labAfterValidation.status !== 200 || labAfterValidation.payload.total !== 0) {
    throw new Error(`Validated laboratory result leaked through FHIR before release: ${JSON.stringify(labAfterValidation)}`);
  }

  const releasedLabOrder = await request(`/clinical-orders/${labOrder.id}/lab-result/release`, { method: "POST", token: doctorToken, body: {} });
  if (releasedLabOrder.status !== "FULFILLED" || releasedLabOrder.labResult?.status !== "RELEASED") {
    throw new Error(`Laboratory result release failed: ${JSON.stringify(releasedLabOrder)}`);
  }

  const completedServiceRequest = await raw(`/fhir/R4/ServiceRequest/${encodeURIComponent(labOrder.id)}`, { token: patientBToken });
  if (completedServiceRequest.status !== 200 || completedServiceRequest.payload.status !== "completed") {
    throw new Error(`FHIR ServiceRequest did not become completed after release: ${JSON.stringify(completedServiceRequest)}`);
  }

  const releasedLabObservations = await raw(`/fhir/R4/Observation?based-on=${encodeURIComponent(`ServiceRequest/${labOrder.id}`)}`, { token: patientBToken });
  if (releasedLabObservations.status !== 200 || releasedLabObservations.payload.resourceType !== "Bundle" || releasedLabObservations.payload.total !== 2) {
    throw new Error(`Released laboratory FHIR Observation search failed: ${JSON.stringify(releasedLabObservations)}`);
  }
  for (const entry of releasedLabObservations.payload.entry || []) {
    const resource = entry.resource;
    if (resource?.resourceType !== "Observation" || resource.status !== "final") throw new Error(`Released laboratory entry is not a final Observation: ${JSON.stringify(entry)}`);
    if (resource.subject?.reference !== `Patient/${patientB.id}` || resource.encounter?.reference !== `Encounter/${appointment.id}`) {
      throw new Error(`Released laboratory Observation references are incorrect: ${JSON.stringify(resource)}`);
    }
    if (resource.basedOn?.[0]?.reference !== `ServiceRequest/${labOrder.id}`) throw new Error(`Released laboratory Observation is not linked to its ServiceRequest: ${JSON.stringify(resource)}`);
  }
  const hemoglobin = releasedLabObservations.payload.entry?.find((entry) => entry.resource?.code?.text === "Hemoglobin")?.resource;
  if (hemoglobin?.valueQuantity?.value !== 13.7 || hemoglobin?.valueQuantity?.unit !== "g/dL") {
    throw new Error(`Numeric laboratory value was not mapped correctly: ${JSON.stringify(hemoglobin)}`);
  }

  const wrongPatientLabObservations = await raw(`/fhir/R4/Observation?based-on=${encodeURIComponent(labOrder.id)}`, { token: patientAToken });
  if (wrongPatientLabObservations.status !== 403 || wrongPatientLabObservations.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected cross-patient laboratory Observation 403, got ${JSON.stringify(wrongPatientLabObservations)}`);
  }

  const ambiguousObservationSearch = await raw(`/fhir/R4/Observation?encounter=${encodeURIComponent(appointment.id)}&based-on=${encodeURIComponent(labOrder.id)}`, { token: patientBToken });
  if (ambiguousObservationSearch.status !== 400 || ambiguousObservationSearch.payload.resourceType !== "OperationOutcome") {
    throw new Error(`Expected ambiguous Observation search to return FHIR 400, got ${JSON.stringify(ambiguousObservationSearch)}`);
  }

  console.log(JSON.stringify({
    status: "passed",
    fhirVersion: metadata.payload.fhirVersion,
    patientId: patientB.id,
    practitionerId: provider.id,
    appointmentId: appointment.id,
    clinicalRecordId: clinicalRecord.id,
    prescriptionId: prescription.id,
    laboratoryOrderId: labOrder.id,
    appointmentSearchTotal: search.payload.total,
    vitalObservationCount: finalObservations.payload.total,
    laboratoryObservationCount: releasedLabObservations.payload.total,
    encounterStatus: finishedEncounter.payload.status,
    serviceRequestStatus: completedServiceRequest.payload.status,
    crossPatientStatus: crossPatient.status,
    crossAppointmentStatus: wrongPatientAppointment.status,
    crossEncounterStatus: wrongPatientEncounter.status,
    crossObservationStatus: wrongPatientObservations.status,
    crossMedicationRequestStatus: wrongPatientMedicationRequest.status,
    crossServiceRequestStatus: wrongPatientServiceRequest.status,
    crossLaboratoryObservationStatus: wrongPatientLabObservations.status,
    laboratoryReleaseGate: true,
  }));
} finally {
  await prisma.$disconnect();
}
