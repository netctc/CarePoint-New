import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
async function createApprovedDoctor(adminToken, specialtyId) {
  const email = 'doctor-documents@carepoint.test';
  const password = 'CarePoint-Documents-Doctor#2026';
  await request('/iam/accounts', { method: 'POST', token: adminToken, body: { email, password, role: 'DOCTOR' } });
  const token = await login(email, password);
  const onboarding = await request('/onboarding/doctors', { method: 'POST', token, body: { specialtyId } });
  const credential = await request(`/onboarding/${onboarding.id}/credentials`, { method: 'POST', token, body: { type: 'medical-license', number: 'DOC-SLICE5', issuer: 'CarePoint CI', validUntil: '2035-12-31' } });
  await request(`/onboarding/${onboarding.id}/submit`, { method: 'POST', token });
  await request(`/onboarding/${onboarding.id}/credentials/${credential.id}/review`, { method: 'POST', token: adminToken, body: { state: 'VERIFIED', note: 'CI verified' } });
  await request(`/onboarding/${onboarding.id}/approve`, { method: 'POST', token: adminToken });
  const user = await prisma.user.findUnique({ where: { email }, include: { provider: true } });
  if (!user?.provider?.id) throw new Error('Approved document doctor provider profile missing.');
  return { token, providerId: user.provider.id };
}
async function main() {
  const adminToken = await login('admin-ci@carepoint.test', 'CarePoint-CI-Admin#2026');
  const specialties = await request('/doctors/specialties');
  const specialty = specialties.items?.[0];
  if (!specialty?.id) throw new Error('No specialty available for Slice 5 smoke test.');
  const doctor = await createApprovedDoctor(adminToken, specialty.id);

  const service = await request('/provider/services', { method: 'POST', token: doctor.token, body: {
    labels: { en: 'Document Review', ar: 'مراجعة مستند', fr: 'Revue de document', es: 'Revisión documental' },
    currency: 'USD', modalities: [{ modality: 'CLINIC', durationMinutes: 30, priceMinor: 5000 }],
  }});
  const target = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const date = target.toISOString().slice(0, 10);
  const weekday = target.getUTCDay();
  const rule = await request('/provider/availability/rules', { method: 'POST', token: doctor.token, body: {
    serviceId: service.id, modality: 'CLINIC', timezone: 'UTC', weekday, startMinute: 720, endMinute: 750, intervalMinutes: 30, slotCapacity: 1, effectiveFrom: date, effectiveUntil: date,
  }});
  await request('/provider/availability/generate', { method: 'POST', token: doctor.token, body: { fromDate: date, toDate: date, ruleId: rule.id } });
  const slots = await request(`/availability?serviceId=${service.id}&modality=CLINIC&from=${encodeURIComponent(date + 'T00:00:00.000Z')}&to=${encodeURIComponent(date + 'T23:59:59.999Z')}`);
  if (!slots[0]?.id) throw new Error('Slice 5 slot not generated.');

  const patientEmail = 'patient-documents@carepoint.test';
  const patientPassword = 'CarePoint-Documents-Patient#2026';
  await request('/iam/register/patient', { method: 'POST', body: { email: patientEmail, password: patientPassword, firstName: 'Document', lastName: 'Patient' } });
  const patientToken = await login(patientEmail, patientPassword);
  const appointment = await request('/bookings', { method: 'POST', token: patientToken, body: { slotId: slots[0].id, idempotencyKey: 'slice5-document-booking-0001' } });

  const binaryMarker = 'SLICE5-BINARY-PHI-MARKER-NEVER-PLAINTEXT';
  const metadataMarker = 'SLICE5-METADATA-PHI-MARKER-NEVER-PLAINTEXT';
  const uploaded = await request(`/clinical-documents/appointments/${appointment.id}/upload`, { method: 'POST', token: doctor.token, body: {
    kind: 'IMAGING_REPORT', mediaType: 'text/plain', fileName: `${metadataMarker}.txt`, title: metadataMarker,
    contentBase64: Buffer.from(binaryMarker, 'utf8').toString('base64'),
  }});
  if (uploaded.releasedToPatient !== false) throw new Error('Provider document should not be released by default.');
  const stored = await prisma.clinicalDocument.findUnique({ where: { id: uploaded.id } });
  if (!stored?.objectKey) throw new Error('Encrypted document object key missing.');
  const dbDump = JSON.stringify(stored);
  if (dbDump.includes(binaryMarker) || dbDump.includes(metadataMarker)) throw new Error('Clinical document PHI leaked into plaintext database columns.');
  const storageRoot = process.env.DOCUMENT_STORAGE_LOCAL_ROOT || '/tmp/carepoint-documents';
  const encryptedObject = await readFile(join(storageRoot, stored.objectKey), 'utf8');
  if (encryptedObject.includes(binaryMarker)) throw new Error('Clinical document binary leaked into plaintext object storage.');
  const patientBefore = await request('/clinical-documents/me', { token: patientToken });
  if (patientBefore.items?.some((item) => item.id === uploaded.id)) throw new Error('Unreleased provider document leaked to patient list.');
  const adminDenied = await raw(`/clinical-documents/${uploaded.id}/content`, { token: adminToken });
  if (adminDenied.status !== 403) throw new Error(`Expected Admin document PHI denial 403, got ${adminDenied.status}.`);

  const reportMarker = 'SLICE5-DIAGNOSTIC-MARKER-NEVER-PLAINTEXT';
  const report = await request(`/diagnostic-reports/appointments/${appointment.id}`, { method: 'POST', token: doctor.token, body: {
    type: 'IMAGING', documentId: uploaded.id, findings: reportMarker, impression: 'TEST-IMPRESSION-SLICE5', method: 'TEST-METHOD',
  }});
  if (report.status !== 'DRAFT') throw new Error('Diagnostic report did not start as DRAFT.');
  const reportStored = await prisma.diagnosticReport.findUnique({ where: { id: report.id } });
  if (!reportStored || JSON.stringify(reportStored).includes(reportMarker)) throw new Error('Diagnostic report PHI leaked into plaintext persistence.');
  const patientReportsBefore = await request('/diagnostic-reports/me', { token: patientToken });
  if (patientReportsBefore.items?.length) throw new Error('Draft diagnostic report leaked to patient.');

  const finalized = await request(`/diagnostic-reports/${report.id}/finalize`, { method: 'POST', token: doctor.token, body: {} });
  if (finalized.status !== 'FINAL' || !finalized.attestation?.payloadDigest) throw new Error('Diagnostic report finalization/attestation failed.');
  const patientReportsFinal = await request('/diagnostic-reports/me', { token: patientToken });
  if (patientReportsFinal.items?.length) throw new Error('Final but unreleased diagnostic report leaked to patient.');
  const released = await request(`/diagnostic-reports/${report.id}/release`, { method: 'POST', token: doctor.token, body: {} });
  if (released.status !== 'RELEASED') throw new Error('Diagnostic report release failed.');

  const patientReports = await request('/diagnostic-reports/me', { token: patientToken });
  const releasedReport = patientReports.items?.find((item) => item.id === report.id);
  if (!releasedReport?.data?.findings?.includes(reportMarker)) throw new Error('Released diagnostic report was not decrypted for patient.');
  const patientDocs = await request('/clinical-documents/me', { token: patientToken });
  if (!patientDocs.items?.some((item) => item.id === uploaded.id && item.releasedToPatient === true)) throw new Error('Attached diagnostic document was not released with report.');
  const content = await request(`/clinical-documents/${uploaded.id}/content`, { token: patientToken });
  if (Buffer.from(content.contentBase64, 'base64').toString('utf8') !== binaryMarker) throw new Error('Released document content failed authenticated decryption.');
  if (content.metadata?.title !== metadataMarker) throw new Error('Encrypted document metadata failed authenticated decryption.');

  const referenceMarker = 'SLICE5-OPAQUE-PACS-REFERENCE-NEVER-PLAINTEXT';
  const reference = await request(`/clinical-documents/appointments/${appointment.id}/reference`, { method: 'POST', token: doctor.token, body: { title: 'Imaging reference', externalReference: referenceMarker } });
  const referenceStored = await prisma.clinicalDocument.findUnique({ where: { id: reference.id } });
  if (!referenceStored || JSON.stringify(referenceStored).includes(referenceMarker)) throw new Error('External diagnostic reference leaked into plaintext persistence.');
  await request(`/clinical-documents/${reference.id}/release`, { method: 'POST', token: doctor.token, body: {} });
  const referenceView = await request(`/clinical-documents/${reference.id}/content`, { token: patientToken });
  if (referenceView.metadata?.externalReference !== referenceMarker) throw new Error('Released encrypted imaging reference failed decryption.');

  const patientUploadMarker = 'SLICE5-PATIENT-UPLOAD-MARKER';
  const patientUpload = await request('/clinical-documents/me/upload', { method: 'POST', token: patientToken, body: {
    mediaType: 'text/plain', fileName: 'patient-upload.txt', title: 'Patient upload', contentBase64: Buffer.from(patientUploadMarker).toString('base64'),
  }});
  if (!patientUpload.releasedToPatient || patientUpload.kind !== 'PATIENT_UPLOAD') throw new Error('Patient upload lifecycle failed.');

  console.log(JSON.stringify({ status: 'passed', documentId: uploaded.id, reportId: report.id, encryptedBlobAtRest: true, encryptedMetadataAtRest: true, adminPhiDenied: true, patientReleaseGate: true }));
}

try { await main(); } finally { await prisma.$disconnect(); }
