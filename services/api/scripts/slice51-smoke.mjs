import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.CAREPOINT_API_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

async function raw(path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function request(path, options = {}) {
  const response = await raw(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}
async function login(email, password) {
  const result = await request('/iam/login', { method: 'POST', body: { email, password } });
  if (!result.accessToken) throw new Error(`No access token for ${email}`);
  return result.accessToken;
}

async function main() {
  const doctorAToken = await login('doctor-clinical-a@carepoint.test', 'CarePoint-Clinical-Doctor#2026');
  const doctorBToken = await login('doctor-clinical-b@carepoint.test', 'CarePoint-Clinical-Doctor#2026');
  const patientToken = await login('patient-clinical@carepoint.test', 'CarePoint-Clinical-Patient#2026');
  const adminToken = await login('admin-ci@carepoint.test', 'CarePoint-CI-Admin#2026');

  const doctorA = await prisma.user.findUnique({ where: { email: 'doctor-clinical-a@carepoint.test' }, include: { provider: true } });
  const doctorB = await prisma.user.findUnique({ where: { email: 'doctor-clinical-b@carepoint.test' }, include: { provider: true } });
  const patient = await prisma.user.findUnique({ where: { email: 'patient-clinical@carepoint.test' }, include: { patientProfile: true } });
  if (!doctorA?.provider?.id || !doctorB?.provider?.id || !patient?.patientProfile?.id) throw new Error('Slice 5.1 prerequisite fixtures missing.');

  const appointmentA = await prisma.appointment.findFirst({
    where: { providerId: doctorA.provider.id, patientId: patient.patientProfile.id, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });
  if (!appointmentA) throw new Error('Completed clinical encounter not found.');

  const beforeCount = await prisma.clinicalDocument.count();
  const rejected = await raw(`/clinical-documents/appointments/${appointmentA.id}/upload`, {
    method: 'POST', token: doctorAToken, body: {
      kind: 'CLINICAL_ATTACHMENT', mediaType: 'text/plain', fileName: 'scanner-test.txt',
      contentBase64: Buffer.from('CAREPOINT-MOCK-MALWARE').toString('base64'),
    },
  });
  if (rejected.status !== 400) throw new Error(`Expected malware scanner rejection 400, got ${rejected.status}.`);
  if (await prisma.clinicalDocument.count() !== beforeCount) throw new Error('Rejected upload reached persistence.');

  const binaryMarker = 'SLICE51-PRIVATE-BINARY-PHI';
  const metadataMarker = 'SLICE51-PRIVATE-METADATA-PHI';
  const document = await request(`/clinical-documents/appointments/${appointmentA.id}/upload`, {
    method: 'POST', token: doctorAToken, body: {
      kind: 'IMAGING_REPORT', mediaType: 'text/plain', fileName: 'slice51-private.txt', title: metadataMarker,
      contentBase64: Buffer.from(binaryMarker).toString('base64'),
    },
  });
  const stored = await prisma.clinicalDocument.findUnique({ where: { id: document.id } });
  if (!stored?.objectKey || JSON.stringify(stored).includes(binaryMarker) || JSON.stringify(stored).includes(metadataMarker)) throw new Error('Document PHI leaked to PostgreSQL.');
  const encryptedObject = await readFile(join(process.env.DOCUMENT_STORAGE_LOCAL_ROOT || '/tmp/carepoint-documents', stored.objectKey), 'utf8');
  if (encryptedObject.includes(binaryMarker)) throw new Error('Document PHI leaked to object storage.');

  const authorList = await request(`/clinical-documents/patients/${patient.patientProfile.id}`, { token: doctorAToken });
  if (authorList.accessBasis !== 'TREATMENT_RELATIONSHIP') throw new Error(`Expected treatment relationship to outrank authorship, got ${authorList.accessBasis}.`);

  const report = await request(`/diagnostic-reports/appointments/${appointmentA.id}`, {
    method: 'POST', token: doctorAToken, body: { type: 'IMAGING', documentId: document.id, findings: 'SYNTHETIC-SLICE51-FINDING', impression: 'SYNTHETIC-SLICE51-IMPRESSION' },
  });
  if (report.status !== 'DRAFT') throw new Error('Diagnostic report did not start in DRAFT.');

  const serviceB = await prisma.service.create({ data: {
    providerId: doctorB.provider.id,
    name: 'Slice 5.1 relationship fixture',
    labels: { en: 'Relationship fixture', ar: 'اختبار علاقة', fr: 'Test relation', es: 'Prueba de relación' },
    currency: 'USD',
  }});
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.appointment.create({ data: {
    patientId: patient.patientProfile.id,
    providerId: doctorB.provider.id,
    serviceId: serviceB.id,
    modality: 'CLINIC',
    status: 'CONFIRMED',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
  }});

  const doctorBDrafts = await request(`/diagnostic-reports/patients/${patient.patientProfile.id}`, { token: doctorBToken });
  if (doctorBDrafts.accessBasis !== 'TREATMENT_RELATIONSHIP') throw new Error('Second provider treatment relationship was not recognized.');
  if (doctorBDrafts.items?.some((item) => item.id === report.id)) throw new Error('Draft diagnostic report leaked cross-provider.');
  const directDraft = await raw(`/diagnostic-reports/${report.id}`, { token: doctorBToken });
  if (directDraft.status !== 403) throw new Error(`Expected direct cross-provider DRAFT denial 403, got ${directDraft.status}.`);

  const finalized = await request(`/diagnostic-reports/${report.id}/finalize`, { method: 'POST', token: doctorAToken, body: {} });
  if (finalized.status !== 'FINAL' || !finalized.attestation?.payloadDigest) throw new Error('Diagnostic report final attestation failed.');
  const doctorBFinal = await request(`/diagnostic-reports/patients/${patient.patientProfile.id}`, { token: doctorBToken });
  if (!doctorBFinal.items?.some((item) => item.id === report.id)) throw new Error('Final report was not available to treatment-related provider.');

  const patientBefore = await request('/clinical-documents/me', { token: patientToken });
  if (patientBefore.items?.some((item) => item.id === document.id)) throw new Error('Unreleased document leaked to patient.');
  await request(`/clinical-documents/${document.id}/release`, { method: 'POST', token: doctorAToken, body: {} });

  const download = await raw(`/clinical-documents/${document.id}/download`, { token: patientToken });
  if (download.status !== 200) throw new Error(`Private download failed with ${download.status}.`);
  if (!download.headers.get('cache-control')?.includes('no-store')) throw new Error('Private download is missing no-store cache control.');
  if (download.headers.get('x-content-type-options') !== 'nosniff') throw new Error('Private download is missing nosniff header.');
  if (await download.text() !== binaryMarker) throw new Error('Private binary download content mismatch.');
  const adminDownload = await raw(`/clinical-documents/${document.id}/download`, { token: adminToken });
  if (adminDownload.status !== 403) throw new Error(`Expected Admin private download denial 403, got ${adminDownload.status}.`);

  const pacsSecret = 'SLICE51-INTERNAL-PACS-REFERENCE';
  const reference = await request(`/clinical-documents/appointments/${appointmentA.id}/reference`, {
    method: 'POST', token: doctorAToken, body: { title: 'Synthetic imaging study', externalReference: pacsSecret },
  });
  await request(`/clinical-documents/${reference.id}/release`, { method: 'POST', token: doctorAToken, body: {} });
  const referenceView = await request(`/clinical-documents/${reference.id}/content`, { token: patientToken });
  if (referenceView.metadata?.externalReference !== undefined) throw new Error('Raw PACS reference leaked through API response.');
  if (referenceView.dicomweb?.proxyRequired !== true) throw new Error('DICOMweb proxy descriptor missing.');

  const { DicomWebService } = await import('../dist/modules/documents/dicomweb.service.js');
  const previous = { node: process.env.NODE_ENV, provider: process.env.DICOMWEB_PROVIDER, base: process.env.DICOMWEB_BASE_URL };
  process.env.NODE_ENV = 'production';
  process.env.DICOMWEB_PROVIDER = 'dicomweb';
  process.env.DICOMWEB_BASE_URL = 'https://pacs.example.test/dicomweb/';
  const dicom = new DicomWebService();
  const normalized = dicom.normalizeReference({ studyInstanceUid: '1.2.840.10008.5.1.4.1.1.2' });
  if (!normalized.startsWith('https://pacs.example.test/dicomweb/studies/')) throw new Error('DICOMweb UID normalization failed.');
  let outsideRejected = false;
  try { dicom.normalizeReference({ externalReference: 'https://untrusted.example.test/studies/1.2.3' }); } catch { outsideRejected = true; }
  if (!outsideRejected) throw new Error('DICOMweb allowlist accepted an external origin.');
  process.env.NODE_ENV = previous.node;
  if (previous.provider === undefined) delete process.env.DICOMWEB_PROVIDER; else process.env.DICOMWEB_PROVIDER = previous.provider;
  if (previous.base === undefined) delete process.env.DICOMWEB_BASE_URL; else process.env.DICOMWEB_BASE_URL = previous.base;

  console.log(JSON.stringify({
    status: 'passed', malwareRejectedBeforePersistence: true, encryptedAtRest: true,
    treatmentRelationshipPrecedence: true, crossProviderDraftDenied: true,
    privateDownload: true, adminPhiDenied: true, pacsReferenceProtected: true, dicomwebAllowlist: true,
  }));
}

try { await main(); } finally { await prisma.$disconnect(); }
