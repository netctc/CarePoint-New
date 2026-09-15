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

async function createApprovedDoctor(adminToken, suffix, specialtyId) {
  const email = `doctor-clinical-${suffix}@carepoint.test`;
  const password = 'CarePoint-Clinical-Doctor#2026';
  await request('/iam/accounts', { method: 'POST', token: adminToken, body: { email, password, role: 'DOCTOR' } });
  const token = await login(email, password);
  const onboarding = await request('/onboarding/doctors', { method: 'POST', token, body: { specialtyId } });
  const credential = await request(`/onboarding/${onboarding.id}/credentials`, {
    method: 'POST', token, body: { type: 'medical-license', number: `CLINICAL-${suffix}`, issuer: 'CarePoint CI', validUntil: '2035-12-31' },
  });
  await request(`/onboarding/${onboarding.id}/submit`, { method: 'POST', token });
  await request(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, { method: 'POST', token: adminToken, body: { state: 'VERIFIED', note: 'CI verified' } });
  await request(`/onboarding/${onboarding.id}/approve`, { method: 'POST', token: adminToken });
  const user = await prisma.user.findUnique({ where: { email }, include: { provider: true } });
  if (!user?.provider?.id) throw new Error('Approved doctor provider profile was not created.');
  return { token, providerId: user.provider.id };
}

async function main() {
  const adminToken = await login('admin-ci@carepoint.test', 'CarePoint-CI-Admin#2026');
  const specialties = await request('/doctors/specialties');
  const specialty = specialties.items?.[0];
  if (!specialty?.id) throw new Error('No specialty available for Slice 3.1 smoke test.');
  const doctorA = await createApprovedDoctor(adminToken, 'a', specialty.id);
  const doctorB = await createApprovedDoctor(adminToken, 'b', specialty.id);

  const service = await request('/provider/services', {
    method: 'POST', token: doctorA.token, body: {
      labels: { en: 'Clinical Follow-up', ar: 'متابعة سريرية', fr: 'Suivi clinique', es: 'Seguimiento clínico' },
      currency: 'USD', modalities: [{ modality: 'CLINIC', durationMinutes: 30, priceMinor: 6000 }],
    },
  });

  const target = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = target.toISOString().slice(0, 10);
  const weekday = target.getUTCDay();
  const rule = await request('/provider/availability/rules', {
    method: 'POST', token: doctorA.token, body: {
      serviceId: service.id, modality: 'CLINIC', timezone: 'UTC', weekday,
      startMinute: 600, endMinute: 630, intervalMinutes: 30, slotCapacity: 1,
      effectiveFrom: date, effectiveUntil: date,
    },
  });
  await request('/provider/availability/generate', { method: 'POST', token: doctorA.token, body: { fromDate: date, toDate: date, ruleId: rule.id } });
  const slots = await request(`/availability?serviceId=${service.id}&modality=CLINIC&from=${encodeURIComponent(date + 'T00:00:00.000Z')}&to=${encodeURIComponent(date + 'T23:59:59.999Z')}`);
  if (!slots[0]?.id) throw new Error('Clinical smoke slot not generated.');

  const patientEmail = 'patient-clinical@carepoint.test';
  const patientPassword = 'CarePoint-Clinical-Patient#2026';
  await request('/iam/register/patient', { method: 'POST', body: { email: patientEmail, password: patientPassword, firstName: 'Clinical', lastName: 'Patient' } });
  const patientToken = await login(patientEmail, patientPassword);
  const appointment = await request('/bookings', { method: 'POST', token: patientToken, body: { slotId: slots[0].id, idempotencyKey: 'slice31-clinical-booking-0001' } });
  if (appointment.status !== 'CONFIRMED') throw new Error('Clinical appointment was not confirmed.');

  const marker = 'PHI-MARKER-SLICE31-NEVER-PLAINTEXT';
  const written = await request(`/clinical/appointments/${appointment.id}/records`, {
    method: 'POST', token: doctorA.token, body: {
      chiefComplaint: 'Follow-up for intermittent palpitations',
      subjective: `Patient describes mild intermittent palpitations. ${marker}`,
      objective: 'Alert, comfortable, no acute distress.',
      assessment: 'Stable for outpatient follow-up.',
      plan: 'Continue monitoring and return if symptoms worsen.',
      vitals: { heartRateBpm: 78, oxygenSaturationPct: 98, systolicMmHg: 118, diastolicMmHg: 76 },
      diagnoses: [{ codeSystem: 'ICD-10', code: 'R00.2', display: 'Palpitations', status: 'ACTIVE' }],
      medications: [{ name: 'Example medication', dose: '10 mg', frequency: 'once daily' }],
    },
  });
  if (written.revision !== 1 || !written.id) throw new Error('Clinical record revision was not created.');

  const stored = await prisma.clinicalRecord.findUnique({ where: { id: written.id } });
  if (!stored) throw new Error('Clinical record not persisted.');
  const storageDump = JSON.stringify(stored);
  if (storageDump.includes(marker) || stored.ciphertext.includes(marker)) throw new Error('PHI marker leaked into plaintext persistence.');
  if (stored.algorithm !== 'AES-256-GCM' || !stored.wrappedKey || !stored.iv) throw new Error('Clinical record envelope is incomplete.');

  const doctorView = await request(`/clinical/appointments/${appointment.id}`, { token: doctorA.token });
  if (!doctorView.latestRecord?.data?.subjective?.includes(marker)) throw new Error('Author provider could not decrypt own clinical record.');
  const patientTimeline = await request('/clinical/timeline', { token: patientToken });
  if (!patientTimeline.items?.[0]?.latestRecord?.data?.subjective?.includes(marker)) throw new Error('Patient timeline did not decrypt the clinical record.');

  const patient = await prisma.user.findUnique({ where: { email: patientEmail }, include: { patientProfile: true } });
  if (!patient?.patientProfile?.id) throw new Error('Patient profile missing.');
  const denied = await raw(`/clinical/patients/${patient.patientProfile.id}/timeline`, { token: doctorB.token });
  if (denied.status !== 403) throw new Error(`Expected second doctor to be denied before consent, got ${denied.status}.`);

  await request('/consents', { method: 'POST', token: patientToken, body: { providerId: doctorB.providerId, scope: 'CLINICAL_RECORD_READ', version: 'clinical-record-v1' } });
  const consentView = await request(`/clinical/patients/${patient.patientProfile.id}/timeline`, { token: doctorB.token });
  if (consentView.accessBasis !== 'PATIENT_CONSENT' || !consentView.items?.[0]?.latestRecord?.data?.subjective?.includes(marker)) throw new Error('Consent-authorized cross-provider timeline failed.');

  const finalized = await request(`/clinical/appointments/${appointment.id}/finalize`, { method: 'POST', token: doctorA.token });
  if (!finalized.finalized || finalized.appointment.status !== 'COMPLETED') throw new Error('Encounter finalization did not complete appointment.');
  const immutable = await raw(`/clinical/appointments/${appointment.id}/records`, { method: 'POST', token: doctorA.token, body: { assessment: 'Should not be writable after finalization.' } });
  if (immutable.status !== 409) throw new Error(`Expected immutable finalized encounter to reject writes with 409, got ${immutable.status}.`);

  console.log(JSON.stringify({ status: 'passed', appointmentId: appointment.id, clinicalRecordId: written.id, crossProviderBasis: consentView.accessBasis, encryptedAtRest: true }));
}

try { await main(); } finally { await prisma.$disconnect(); }
