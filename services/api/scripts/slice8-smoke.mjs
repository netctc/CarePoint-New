import { PrismaClient } from '@prisma/client';

const base = process.env.CAREPOINT_API_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const providerPassword = process.env.SLICE6_DOCTOR_PASSWORD;
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD;
if (!adminPassword || !providerPassword || !patientPassword) throw new Error('Slice 8 CI credentials must be provided through environment variables.');

async function raw(path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function request(path, options = {}) {
  const result = await raw(path, options);
  if (result.status < 200 || result.status >= 300) throw new Error(`${options.method || 'GET'} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function login(email, password) {
  const result = await request('/iam/login', { method: 'POST', body: { email, password } });
  if (!result.accessToken) throw new Error(`No access token for ${email}`);
  return result.accessToken;
}

async function registerPatient(email, firstName) {
  await request('/iam/register/patient', { method: 'POST', body: { email, password: patientPassword, firstName, lastName: 'Transport CI' } });
  const token = await login(email, patientPassword);
  const user = await prisma.user.findUnique({ where: { email }, include: { patientProfile: true } });
  if (!user?.patientProfile) throw new Error(`Patient fixture missing for ${email}`);
  return { token, user, patient: user.patientProfile };
}

async function createProvider(adminToken, email, displayName, family) {
  await request('/iam/accounts', { method: 'POST', token: adminToken, body: { email, password: providerPassword, role: 'OTHER_PROVIDER' } });
  const user = await prisma.user.findUnique({ where: { email } });
  const category = await prisma.providerCategory.findFirst({ where: { family, active: true } });
  if (!user || !category) throw new Error(`Provider fixture prerequisite missing for ${family}`);
  const provider = await prisma.provider.create({
    data: {
      userId: user.id,
      class: 'OTHER_PROVIDER',
      displayName,
      status: 'ACTIVE',
      otherProviderProfile: { create: { categoryId: category.id } },
    },
  });
  return { token: await login(email, providerPassword), user, provider };
}

async function createDoctor(adminToken) {
  const email = 'doctor-slice8@carepoint.test';
  await request('/iam/accounts', { method: 'POST', token: adminToken, body: { email, password: providerPassword, role: 'DOCTOR' } });
  return { token: await login(email, providerPassword), user: await prisma.user.findUniqueOrThrow({ where: { email } }) };
}

async function main() {
  const adminToken = await login('admin-ci@carepoint.test', adminPassword);
  const patientA = await registerPatient('patient-slice8-a@carepoint.test', 'Patient A');
  const patientB = await registerPatient('patient-slice8-b@carepoint.test', 'Patient B');
  const doctor = await createDoctor(adminToken);
  const ambulance = await createProvider(adminToken, 'ambulance-slice8@carepoint.test', 'Slice 8 Emergency Ambulance', 'EMERGENCY_AMBULANCE');
  const groundA = await createProvider(adminToken, 'ground-a-slice8@carepoint.test', 'Slice 8 Ground A', 'MEDICAL_TRANSPORT_GROUND');
  const groundB = await createProvider(adminToken, 'ground-b-slice8@carepoint.test', 'Slice 8 Ground B', 'MEDICAL_TRANSPORT_GROUND');
  const air = await createProvider(adminToken, 'air-slice8@carepoint.test', 'Slice 8 Air', 'MEDICAL_TRANSPORT_AIR');

  const appointmentCountBefore = await prisma.appointment.count();

  const emergencyMarker = 'SLICE8-EMERGENCY-PICKUP-MARKER';
  const emergencyInput = {
    clientRequestId: 'slice8-emergency-0001',
    latitude: 33.8938,
    longitude: 35.5018,
    pickupAddress: emergencyMarker,
    callbackPhone: '+96170000008',
  };
  const emergency = await request('/emergency/ambulance', { method: 'POST', token: patientA.token, body: emergencyInput });
  if (!emergency.emergencyFlow || !emergency.bypassesOrdinaryBooking || emergency.request?.status !== 'REQUESTED') throw new Error('Emergency flow flags/status are invalid.');
  const emergencyRepeat = await request('/emergency/ambulance', { method: 'POST', token: patientA.token, body: emergencyInput });
  if (emergencyRepeat.request?.id !== emergency.request.id) throw new Error('Emergency request idempotency failed.');
  if (await prisma.emergencyAmbulanceRequest.count({ where: { id: emergency.request.id } }) !== 1) throw new Error('Emergency request was not persisted exactly once.');

  const otherPatientEmergency = await raw(`/emergency/ambulance/${emergency.request.id}`, { token: patientB.token });
  if (otherPatientEmergency.status !== 404) throw new Error(`Expected other Patient emergency denial 404, got ${otherPatientEmergency.status}.`);

  const doctorEmergency = await raw('/provider/emergency/ambulance', { token: doctor.token });
  if (doctorEmergency.status !== 403) throw new Error(`Doctor gained emergency responder access (${doctorEmergency.status}).`);
  const wrongEmergencyFamily = await raw('/provider/emergency/ambulance', { token: groundA.token });
  if (wrongEmergencyFamily.status !== 403) throw new Error(`Ground transport provider gained ambulance responder access (${wrongEmergencyFamily.status}).`);

  await request(`/operations/emergency/ambulance/${emergency.request.id}/dispatch`, { method: 'POST', token: adminToken, body: {} });
  const wrongAssignment = await raw(`/operations/emergency/ambulance/${emergency.request.id}/assign`, {
    method: 'POST', token: adminToken, body: { providerId: groundA.provider.id, etaMinutes: 9 },
  });
  if (wrongAssignment.status !== 400) throw new Error(`Expected wrong-family emergency assignment 400, got ${wrongAssignment.status}.`);

  const assignedEmergency = await request(`/operations/emergency/ambulance/${emergency.request.id}/assign`, {
    method: 'POST', token: adminToken, body: { providerId: ambulance.provider.id, etaMinutes: 8 },
  });
  if (assignedEmergency.status !== 'ASSIGNED' || assignedEmergency.assignedProviderId !== ambulance.provider.id) throw new Error('Emergency assignment failed.');
  const ambulanceJobs = await request('/provider/emergency/ambulance', { token: ambulance.token });
  if (!ambulanceJobs.some((item) => item.id === emergency.request.id)) throw new Error('Assigned ambulance job is missing from responder queue.');

  for (const status of ['EN_ROUTE', 'ARRIVED', 'TRANSPORTING', 'COMPLETED']) {
    const updated = await request(`/provider/emergency/ambulance/${emergency.request.id}/status`, { method: 'POST', token: ambulance.token, body: { status, etaMinutes: status === 'EN_ROUTE' ? 6 : undefined } });
    if (updated.status !== status) throw new Error(`Emergency responder transition to ${status} failed.`);
  }
  const emergencyFinal = await request(`/emergency/ambulance/${emergency.request.id}`, { token: patientA.token });
  if (emergencyFinal.request?.status !== 'COMPLETED' || emergencyFinal.history?.length < 6) throw new Error('Patient emergency history is incomplete.');
  const lateEmergencyCancel = await raw(`/emergency/ambulance/${emergency.request.id}/cancel`, { method: 'POST', token: patientA.token, body: { reason: 'too late' } });
  if (lateEmergencyCancel.status !== 409) throw new Error(`Expected completed emergency cancel conflict 409, got ${lateEmergencyCancel.status}.`);

  const groundMarker = 'SLICE8-GROUND-PICKUP-MARKER';
  const groundInput = {
    clientRequestId: 'slice8-ground-0001',
    mode: 'GROUND',
    scheduledFor: '2031-01-15T10:00:00.000Z',
    pickupLatitude: 33.89,
    pickupLongitude: 35.50,
    pickupAddress: groundMarker,
    destinationLatitude: 33.88,
    destinationLongitude: 35.52,
    destinationAddress: 'SLICE8-GROUND-DESTINATION',
    assistance: 'WHEELCHAIR',
    callbackPhone: '+96170000018',
  };
  const groundRequest = await request('/medical-transport', { method: 'POST', token: patientA.token, body: groundInput });
  const groundRepeat = await request('/medical-transport', { method: 'POST', token: patientA.token, body: groundInput });
  if (groundRepeat.request?.id !== groundRequest.request?.id) throw new Error('Scheduled transport idempotency failed.');

  const doctorTransport = await raw('/provider/medical-transport/available', { token: doctor.token });
  if (doctorTransport.status !== 403) throw new Error(`Doctor gained medical transport responder access (${doctorTransport.status}).`);
  const ambulanceTransport = await raw('/provider/medical-transport/available', { token: ambulance.token });
  if (ambulanceTransport.status !== 403) throw new Error(`Emergency ambulance family gained scheduled transport access (${ambulanceTransport.status}).`);
  const airWrongAccept = await raw(`/provider/medical-transport/${groundRequest.request.id}/accept`, { method: 'POST', token: air.token, body: {} });
  if (airWrongAccept.status !== 404) throw new Error(`Air provider accepted Ground request (${airWrongAccept.status}).`);

  const groundAvailableA = await request('/provider/medical-transport/available', { token: groundA.token });
  if (!groundAvailableA.some((item) => item.id === groundRequest.request.id)) throw new Error('Ground request not visible to eligible Ground provider.');

  const [acceptA, acceptB] = await Promise.all([
    raw(`/provider/medical-transport/${groundRequest.request.id}/accept`, { method: 'POST', token: groundA.token, body: {} }),
    raw(`/provider/medical-transport/${groundRequest.request.id}/accept`, { method: 'POST', token: groundB.token, body: {} }),
  ]);
  const accepts = [acceptA, acceptB];
  const winners = accepts.filter((item) => item.status >= 200 && item.status < 300);
  const conflicts = accepts.filter((item) => item.status === 409);
  if (winners.length !== 1 || conflicts.length !== 1) throw new Error(`Ground transport concurrency invariant failed: ${JSON.stringify(accepts.map(({ status, payload }) => ({ status, payload })))}`);
  const winnerProvider = acceptA.status < 300 ? groundA : groundB;
  const winnerPayload = acceptA.status < 300 ? acceptA.payload : acceptB.payload;
  if (winnerPayload.assignedProviderId !== winnerProvider.provider.id) throw new Error('Ground transport winner assignment mismatch.');

  const invalidSequence = await raw(`/provider/medical-transport/${groundRequest.request.id}/status`, { method: 'POST', token: winnerProvider.token, body: { status: 'ARRIVED' } });
  if (invalidSequence.status !== 409) throw new Error(`Expected transport sequence conflict 409, got ${invalidSequence.status}.`);
  for (const status of ['EN_ROUTE', 'ARRIVED', 'TRANSPORTING', 'COMPLETED']) {
    const updated = await request(`/provider/medical-transport/${groundRequest.request.id}/status`, { method: 'POST', token: winnerProvider.token, body: { status } });
    if (updated.status !== status) throw new Error(`Transport responder transition to ${status} failed.`);
  }

  const cancelled = await request('/medical-transport', {
    method: 'POST', token: patientA.token, body: { ...groundInput, clientRequestId: 'slice8-ground-cancel-0002', scheduledFor: '2031-01-16T10:00:00.000Z' },
  });
  const cancelledResult = await request(`/medical-transport/${cancelled.request.id}/cancel`, { method: 'POST', token: patientA.token, body: { reason: 'Plans changed' } });
  if (cancelledResult.request?.status !== 'CANCELLED') throw new Error('Patient scheduled transport cancellation failed.');

  const airRequest = await request('/medical-transport', {
    method: 'POST', token: patientA.token, body: { ...groundInput, clientRequestId: 'slice8-air-0001', mode: 'AIR', assistance: 'STRETCHER', scheduledFor: '2031-01-17T10:00:00.000Z' },
  });
  const airAvailable = await request('/provider/medical-transport/available', { token: air.token });
  if (!airAvailable.some((item) => item.id === airRequest.request.id)) throw new Error('Air request not visible to eligible Air provider.');
  const acceptedAir = await request(`/provider/medical-transport/${airRequest.request.id}/accept`, { method: 'POST', token: air.token, body: {} });
  if (acceptedAir.assignedProviderId !== air.provider.id) throw new Error('Air transport provider acceptance failed.');

  if (await prisma.appointment.count() !== appointmentCountBefore) throw new Error('Emergency or medical transport created an ordinary Appointment unexpectedly.');

  const patientEvents = await prisma.notificationEvent.findMany({ where: { accountId: patientA.user.id }, orderBy: { createdAt: 'asc' } });
  const notificationJson = JSON.stringify(patientEvents);
  if (!patientEvents.some((item) => item.type === 'EMERGENCY_UPDATE') || !patientEvents.some((item) => item.type === 'TRANSPORT_UPDATE')) throw new Error('Emergency/transport notifications were not persisted.');
  if (notificationJson.includes(emergencyMarker) || notificationJson.includes(groundMarker) || notificationJson.includes('+961700000')) throw new Error('Location or callback PHI leaked into notification persistence.');

  const emergencyAuditCount = await prisma.auditEvent.count({ where: { objectType: 'EMERGENCY_AMBULANCE_REQUEST', objectId: emergency.request.id } });
  const transportAuditCount = await prisma.auditEvent.count({ where: { objectType: 'MEDICAL_TRANSPORT_REQUEST', objectId: groundRequest.request.id } });
  if (emergencyAuditCount < 6 || transportAuditCount < 5) throw new Error('Dispatch audit trail is incomplete.');

  console.log(JSON.stringify({
    status: 'passed',
    persistentEmergency: true,
    emergencyIdempotency: true,
    emergencyFamilyBoundary: true,
    emergencyLifecycle: emergencyFinal.request.status,
    scheduledTransportIdempotency: true,
    transportFamilyBoundary: true,
    concurrentTransportWinner: winnerProvider.provider.id,
    transportConflictStatus: conflicts[0].status,
    groundLifecycle: 'COMPLETED',
    airAssignedProviderId: acceptedAir.assignedProviderId,
    ordinaryAppointmentsCreated: 0,
    phiNeutralNotifications: true,
  }));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
