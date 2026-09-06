import { PrismaClient } from '@prisma/client';

const base = process.env.CAREPOINT_API_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

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
  if (!result.accessToken) throw new Error(`login did not return access token for ${email}`);
  return result.accessToken;
}

async function main() {
  const doctorToken = await login('doctor-clinical-a@carepoint.test', 'CarePoint-Clinical-Doctor#2026');
  const patientToken = await login('patient-clinical@carepoint.test', 'CarePoint-Clinical-Patient#2026');
  const adminToken = await login('admin-ci@carepoint.test', 'CarePoint-CI-Admin#2026');

  const doctor = await prisma.user.findUnique({ where: { email: 'doctor-clinical-a@carepoint.test' }, include: { provider: true } });
  const patient = await prisma.user.findUnique({ where: { email: 'patient-clinical@carepoint.test' }, include: { patientProfile: true } });
  if (!doctor?.provider?.id || !patient?.patientProfile?.id) throw new Error('Slice 3.1 doctor/patient fixtures are missing.');

  const appointment = await prisma.appointment.findFirst({
    where: { providerId: doctor.provider.id, patientId: patient.patientProfile.id, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });
  if (!appointment) throw new Error('Completed Slice 3.1 appointment not found.');

  const prescriptionMarker = 'ORDER-PHI-SLICE4-NEVER-PLAINTEXT';
  const prescription = await request(`/clinical-orders/appointments/${appointment.id}/prescriptions`, {
    method: 'POST', token: doctorToken, body: {
      idempotencyKey: 'slice4-prescription-0001',
      medication: { name: 'TEST-MEDICATION', codeSystem: 'TEST', code: 'TEST-001', strength: 'TEST-STRENGTH', form: 'TEST-FORM' },
      dosageInstruction: 'TEST-INSTRUCTION-NOT-FOR-CLINICAL-USE',
      frequency: 'TEST-FREQUENCY', duration: 'TEST-DURATION', quantity: 1, refills: 0,
      reason: `Synthetic CI fixture ${prescriptionMarker}`,
    },
  });
  if (prescription.type !== 'PRESCRIPTION' || prescription.status !== 'SIGNED') throw new Error('Prescription was not signed.');
  if (prescription.attestation?.algorithm !== 'HMAC-SHA256' || !prescription.attestation?.payloadDigest) throw new Error('Prescription attestation missing.');

  const storedPrescription = await prisma.clinicalOrder.findUnique({ where: { id: prescription.id } });
  if (!storedPrescription) throw new Error('Prescription was not persisted.');
  if (JSON.stringify(storedPrescription).includes(prescriptionMarker) || storedPrescription.ciphertext.includes(prescriptionMarker)) throw new Error('Prescription PHI leaked into plaintext persistence.');

  const patientOrders = await request('/clinical-orders/me', { token: patientToken });
  const patientPrescription = patientOrders.items?.find((item) => item.id === prescription.id);
  if (!patientPrescription?.data?.reason?.includes(prescriptionMarker)) throw new Error('Patient could not decrypt signed prescription.');

  const adminDenied = await raw(`/clinical-orders/${prescription.id}`, { token: adminToken });
  if (adminDenied.status !== 403) throw new Error(`Expected Admin PHI order access denial, got ${adminDenied.status}.`);

  const labMarker = 'LAB-RESULT-PHI-SLICE4-NEVER-PLAINTEXT';
  const labOrder = await request(`/clinical-orders/appointments/${appointment.id}/laboratory`, {
    method: 'POST', token: doctorToken, body: {
      idempotencyKey: 'slice4-laboratory-0001',
      tests: [
        { display: 'TEST-OBSERVATION-A', codeSystem: 'TEST', code: 'OBS-A' },
        { display: 'TEST-OBSERVATION-B', codeSystem: 'TEST', code: 'OBS-B' },
      ],
      priority: 'ROUTINE', fasting: false, reason: 'Synthetic CI laboratory fixture',
    },
  });
  if (labOrder.type !== 'LABORATORY' || labOrder.status !== 'SIGNED') throw new Error('Laboratory order was not signed.');

  await request(`/clinical-orders/${labOrder.id}/lab-result`, {
    method: 'POST', token: doctorToken, body: {
      observations: [
        { display: 'TEST-OBSERVATION-A', codeSystem: 'TEST', code: 'OBS-A', value: 'TEST-VALUE-A', unit: 'TEST-UNIT', referenceRange: 'TEST-RANGE', flag: 'TEST-FLAG' },
        { display: 'TEST-OBSERVATION-B', codeSystem: 'TEST', code: 'OBS-B', value: 'TEST-VALUE-B', unit: 'TEST-UNIT', referenceRange: 'TEST-RANGE', flag: 'TEST-FLAG' },
      ],
      conclusion: `Synthetic CI result ${labMarker}`,
    },
  });

  const storedResult = await prisma.laboratoryResult.findUnique({ where: { orderId: labOrder.id } });
  if (!storedResult) throw new Error('Laboratory result was not persisted.');
  if (JSON.stringify(storedResult).includes(labMarker) || storedResult.ciphertext.includes(labMarker)) throw new Error('Laboratory PHI leaked into plaintext persistence.');

  const patientBeforeValidation = await request(`/clinical-orders/${labOrder.id}`, { token: patientToken });
  if (patientBeforeValidation.labResult?.status !== 'ENTERED' || patientBeforeValidation.labResult?.data) throw new Error('Entered laboratory result leaked to patient before validation.');

  const validated = await request(`/clinical-orders/${labOrder.id}/lab-result/validate`, { method: 'POST', token: doctorToken });
  if (validated.labResult?.status !== 'VALIDATED' || !validated.labResult?.data?.conclusion?.includes(labMarker)) throw new Error('Provider could not validate/decrypt laboratory result.');

  const patientBeforeRelease = await request(`/clinical-orders/${labOrder.id}`, { token: patientToken });
  if (patientBeforeRelease.labResult?.status !== 'VALIDATED' || patientBeforeRelease.labResult?.data) throw new Error('Validated laboratory result leaked to patient before release.');

  const released = await request(`/clinical-orders/${labOrder.id}/lab-result/release`, { method: 'POST', token: doctorToken });
  if (released.status !== 'FULFILLED' || released.labResult?.status !== 'RELEASED') throw new Error('Laboratory result release did not fulfill the order.');

  const patientAfterRelease = await request(`/clinical-orders/${labOrder.id}`, { token: patientToken });
  if (!patientAfterRelease.labResult?.released || !patientAfterRelease.labResult?.data?.conclusion?.includes(labMarker)) throw new Error('Released laboratory result was not visible/decryptable to patient.');

  const validatedStored = await prisma.laboratoryResult.findUnique({ where: { orderId: labOrder.id } });
  if (!validatedStored?.validationSignature || !validatedStored.validationDigest || !validatedStored.validatedAt) throw new Error('Laboratory validation attestation missing.');

  console.log(JSON.stringify({ status: 'passed', prescriptionId: prescription.id, laboratoryOrderId: labOrder.id, laboratoryResultId: validatedStored.id, encryptedAtRest: true, patientReleaseGate: true, adminPhiDenied: true }));
}

try { await main(); } finally { await prisma.$disconnect(); }
