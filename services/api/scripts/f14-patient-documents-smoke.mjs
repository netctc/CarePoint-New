import { createHash } from 'node:crypto';
import { PatientDocumentCentreService } from '../dist/modules/documents/patient-document-centre.service.js';

const body = Buffer.from('F14 secure document body', 'utf8');
const digest = createHash('sha256').update(body).digest('hex');

const documentTemplate = () => ({
  id: 'f14-document-1',
  patientId: 'f14-patient-1',
  providerId: 'f14-provider-1',
  encounterRef: 'f14-appointment-1',
  orderId: 'f14-order-1',
  kind: 'LAB_REPORT',
  status: 'AVAILABLE',
  storageMode: 'ENCRYPTED_BLOB',
  storageProvider: 'F14-SECRET-STORAGE',
  objectKey: 'F14-SECRET-OBJECT-KEY',
  mediaType: 'text/plain',
  byteLength: body.length,
  contentDigest: digest,
  blobAlgorithm: 'AES-256-GCM',
  blobKeyId: 'F14-SECRET-BLOB-KEY',
  blobWrappedKey: 'F14-SECRET-WRAPPED-KEY',
  blobIv: 'F14-SECRET-BLOB-IV',
  metadataAlgorithm: 'AES-256-GCM',
  metadataKeyId: 'F14-SECRET-META-KEY',
  metadataWrappedKey: 'F14-SECRET-META-WRAPPED',
  metadataIv: 'F14-SECRET-META-IV',
  metadataCiphertext: 'F14-SECRET-META-CIPHERTEXT',
  releasedToPatient: true,
  createdByAccountId: 'f14-provider-account',
  releasedAt: new Date('2026-09-12T06:00:00Z'),
  removedAt: null,
  createdAt: new Date('2026-09-12T05:00:00Z'),
  updatedAt: new Date('2026-09-12T06:00:00Z'),
});

function harness() {
  const document = documentTemplate();
  const grants = [];
  const auditCalls = [];
  const prisma = {
    patientProfile: {
      findUnique: async ({ where }) => where.userId === 'f14-patient-account' ? { id: 'f14-patient-1' } : null,
    },
    clinicalDocument: {
      findMany: async ({ where }) => where.patientId === document.patientId ? [{ ...document }] : [],
      findFirst: async ({ where }) => where.id === document.id && where.patientId === document.patientId ? { ...document } : null,
    },
    clinicalDocumentDownloadGrant: {
      create: async ({ data }) => {
        const row = { id: `grant-${grants.length + 1}`, consumedAt: null, createdAt: new Date(), ...data };
        grants.push(row);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const row = grants.find((item) => item.tokenHash === where.tokenHash && item.documentId === where.documentId && item.accountId === where.accountId && item.consumedAt == null && item.expiresAt > where.expiresAt.gt);
        if (!row) return { count: 0 };
        row.consumedAt = data.consumedAt;
        return { count: 1 };
      },
    },
  };
  const audit = { write: async (value) => { auditCalls.push(value); } };
  const storage = { get: async (objectKey) => {
    if (objectKey !== document.objectKey) throw new Error('Unexpected object key.');
    return 'f14-ciphertext';
  } };
  const envelope = {
    decryptMetadata: async () => ({
      fileName: 'released-result.txt',
      title: 'Released result',
      description: 'Patient-safe description',
      externalReference: 'F14-SECRET-EXTERNAL-REFERENCE',
    }),
    decryptBytes: async () => Uint8Array.from(body),
  };
  const service = new PatientDocumentCentreService(prisma, audit, storage, envelope);
  return { service, grants, auditCalls };
}

async function safeListCase() {
  const test = harness();
  const result = await test.service.list({ role: 'PATIENT', accountId: 'f14-patient-account' }, { q: 'released', kind: 'LAB_REPORT', limit: 20 });
  if (result.items.length !== 1 || result.items[0].id !== 'f14-document-1') throw new Error('Patient document centre did not return the released owned document.');
  const serialized = JSON.stringify(result);
  for (const forbidden of ['F14-SECRET-STORAGE', 'F14-SECRET-OBJECT-KEY', 'F14-SECRET-BLOB-KEY', 'F14-SECRET-WRAPPED-KEY', 'F14-SECRET-META-KEY', 'F14-SECRET-META-WRAPPED', digest, 'F14-SECRET-EXTERNAL-REFERENCE']) {
    if (serialized.includes(forbidden)) throw new Error(`Patient document DTO leaked internal storage material: ${forbidden}`);
  }
  if (result.items[0].downloadable !== true || result.items[0].source !== 'CARE_TEAM') throw new Error('Patient document DTO omitted safe download/source indicators.');
}

async function singleUseCase() {
  const test = harness();
  const principal = { role: 'PATIENT', accountId: 'f14-patient-account' };
  const issued = await test.service.issueDownloadGrant(principal, 'f14-document-1');
  if (!issued.token || issued.token.length < 40) throw new Error('Download grant did not return a strong opaque token.');
  if (test.grants.length !== 1 || test.grants[0].tokenHash === issued.token || test.grants[0].tokenHash.length !== 64) throw new Error('Raw download token was persisted instead of a hash.');
  const downloaded = await test.service.consumeDownloadGrant(principal, 'f14-document-1', { token: issued.token });
  if (downloaded.bytes.toString('utf8') !== body.toString('utf8') || downloaded.fileName !== 'released-result.txt') throw new Error('One-time secure download returned unexpected content.');
  let rejected = false;
  try {
    await test.service.consumeDownloadGrant(principal, 'f14-document-1', { token: issued.token });
  } catch (error) {
    rejected = String(error).includes('already consumed');
  }
  if (!rejected) throw new Error('Consumed download token was reusable.');
}

async function failClosedCase() {
  const test = harness();
  let wrongRole = false;
  try {
    await test.service.list({ role: 'DOCTOR', accountId: 'f14-patient-account' }, {});
  } catch (error) {
    wrongRole = String(error).includes('patient account');
  }
  if (!wrongRole) throw new Error('Patient document centre accepted a non-patient principal.');
  const principal = { role: 'PATIENT', accountId: 'f14-patient-account' };
  await test.service.issueDownloadGrant(principal, 'f14-document-1');
  let invalid = false;
  try {
    await test.service.consumeDownloadGrant(principal, 'f14-document-1', { token: 'A'.repeat(43) });
  } catch (error) {
    invalid = String(error).includes('invalid, expired or already consumed');
  }
  if (!invalid) throw new Error('Invalid download token did not fail closed.');
}

await safeListCase();
await singleUseCase();
await failClosedCase();
console.log(JSON.stringify({ status: 'passed', safePatientDto: true, hashedGrant: true, singleUse: true, failClosed: true }));
