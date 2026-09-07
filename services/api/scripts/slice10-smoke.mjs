const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";

async function raw(path, { method = "GET", token, body } = {}) {
  const headers = { accept: "application/fhir+json", "content-type": "application/json" };
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
  const result = await raw(path, options);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${options.method || "GET"} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  }
  return result;
}

async function login(email, password) {
  const result = await request("/iam/login", { method: "POST", body: { email, password } });
  if (!result.accessToken) throw new Error(`login did not return access token for ${email}`);
  return result.accessToken;
}

const metadata = await raw("/fhir/R4/metadata");
if (metadata.status !== 200 || metadata.payload.resourceType !== "CapabilityStatement" || metadata.payload.fhirVersion !== "4.0.1") {
  throw new Error(`FHIR metadata failed: ${JSON.stringify(metadata)}`);
}
if (!metadata.contentType.includes("application/fhir+json")) throw new Error(`FHIR content type missing: ${metadata.contentType}`);

const patientPassword = "CarePoint-Patient#2026";
const patientAToken = await login("patient-a-slice2@carepoint.test", patientPassword);
const patientBToken = await login("patient-b-slice2@carepoint.test", patientPassword);
const doctorToken = await login("doctor-slice2@carepoint.test", "CarePoint-Doctor#2026");

const timelineA = await request("/clinical/timeline", { token: patientAToken });
const timelineB = await request("/clinical/timeline", { token: patientBToken });
const patientAId = timelineA.patientId;
const patientBId = timelineB.patientId;
if (!patientAId || !patientBId || patientAId === patientBId) throw new Error("Slice 2 patient identities are not available for FHIR smoke.");

const patientSelf = await raw(`/fhir/R4/Patient/${encodeURIComponent(patientAId)}`, { token: patientAToken });
if (patientSelf.status !== 200 || patientSelf.payload.resourceType !== "Patient" || patientSelf.payload.id !== patientAId) {
  throw new Error(`FHIR Patient self read failed: ${JSON.stringify(patientSelf)}`);
}

const crossPatient = await raw(`/fhir/R4/Patient/${encodeURIComponent(patientAId)}`, { token: patientBToken });
if (crossPatient.status !== 403 || crossPatient.payload.resourceType !== "OperationOutcome") {
  throw new Error(`Expected FHIR Patient cross-access OperationOutcome 403, got ${JSON.stringify(crossPatient)}`);
}

const services = await request("/services/search?q=Cardiology");
const providerId = services[0]?.provider?.id;
if (!providerId) throw new Error(`Slice 2 doctor provider not found: ${JSON.stringify(services)}`);
const practitioner = await raw(`/fhir/R4/Practitioner/${encodeURIComponent(providerId)}`);
if (practitioner.status !== 200 || practitioner.payload.resourceType !== "Practitioner" || practitioner.payload.id !== providerId) {
  throw new Error(`FHIR Practitioner read failed: ${JSON.stringify(practitioner)}`);
}
if (JSON.stringify(practitioner.payload).includes("CI-MED-0001")) throw new Error("Public FHIR Practitioner leaked provider license details.");

const appointmentsB = await request("/bookings/me", { token: patientBToken });
const ownedAppointment = appointmentsB.find((item) => item.providerId === providerId) || appointmentsB[0];
if (!ownedAppointment?.id) throw new Error(`Patient B appointment not found: ${JSON.stringify(appointmentsB)}`);

const appointment = await raw(`/fhir/R4/Appointment/${encodeURIComponent(ownedAppointment.id)}`, { token: patientBToken });
if (appointment.status !== 200 || appointment.payload.resourceType !== "Appointment" || appointment.payload.id !== ownedAppointment.id) {
  throw new Error(`FHIR Appointment participant read failed: ${JSON.stringify(appointment)}`);
}
if (!Array.isArray(appointment.payload.participant) || appointment.payload.participant.length !== 2) {
  throw new Error(`FHIR Appointment participants missing: ${JSON.stringify(appointment.payload)}`);
}

const doctorAppointment = await raw(`/fhir/R4/Appointment/${encodeURIComponent(ownedAppointment.id)}`, { token: doctorToken });
if (doctorAppointment.status !== 200) throw new Error(`Assigned practitioner could not read FHIR Appointment: ${JSON.stringify(doctorAppointment)}`);

const wrongPatientAppointment = await raw(`/fhir/R4/Appointment/${encodeURIComponent(ownedAppointment.id)}`, { token: patientAToken });
if (wrongPatientAppointment.status !== 403 || wrongPatientAppointment.payload.resourceType !== "OperationOutcome") {
  throw new Error(`Expected FHIR Appointment cross-patient 403, got ${JSON.stringify(wrongPatientAppointment)}`);
}

const search = await raw(`/fhir/R4/Appointment?patient=${encodeURIComponent(`Patient/${patientBId}`)}`, { token: patientBToken });
if (search.status !== 200 || search.payload.resourceType !== "Bundle" || search.payload.type !== "searchset" || search.payload.total < 1) {
  throw new Error(`FHIR Appointment search failed: ${JSON.stringify(search)}`);
}
if (!search.payload.entry?.every((entry) => entry.resource?.resourceType === "Appointment")) {
  throw new Error(`FHIR Appointment search returned unexpected resources: ${JSON.stringify(search.payload)}`);
}

const crossSearch = await raw(`/fhir/R4/Appointment?patient=${encodeURIComponent(patientBId)}`, { token: patientAToken });
if (crossSearch.status !== 403 || crossSearch.payload.resourceType !== "OperationOutcome") {
  throw new Error(`Expected cross-patient FHIR search 403, got ${JSON.stringify(crossSearch)}`);
}

console.log(JSON.stringify({
  status: "passed",
  fhirVersion: metadata.payload.fhirVersion,
  patientId: patientBId,
  practitionerId: providerId,
  appointmentId: ownedAppointment.id,
  appointmentSearchTotal: search.payload.total,
  crossPatientStatus: crossPatient.status,
  crossAppointmentStatus: wrongPatientAppointment.status,
}));
