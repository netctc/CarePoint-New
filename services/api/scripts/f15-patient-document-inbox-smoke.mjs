import { PatientDocumentInboxService } from '../dist/modules/documents/patient-document-inbox.service.js';

const patientAccount = 'patient-account';
const patientId = 'patient-1';
const careDocument = {
  id: 'care-doc', patientId, kind: 'CLINICAL_ATTACHMENT', providerId: 'provider-1', createdByAccountId: 'provider-account',
  status: 'AVAILABLE', releasedToPatient: true,
};
const patientDocument = {
  id: 'patient-doc', patientId, kind: 'PATIENT_UPLOAD', providerId: null, createdByAccountId: patientAccount,
  status: 'AVAILABLE', releasedToPatient: true,
};
const releaseDocument = {
  id: 'release-doc', patientId, kind: 'CLINICAL_ATTACHMENT', providerId: 'provider-1', createdByAccountId: 'provider-account',
  status: 'AVAILABLE', releasedToPatient: false,
};
const labDocument = {
  id: 'lab-doc', patientId, kind: 'LAB_REPORT', providerId: 'provider-1', createdByAccountId: 'provider-account',
  status: 'AVAILABLE', releasedToPatient: false,
};

function harness() {
  const documents = new Map([careDocument, patientDocument, releaseDocument, labDocument].map((row) => [row.id, { ...row }]));
  const receipts = new Map();
  const notifications = [];
  const uploads = [];
  const removals = [];
  const audits = [];

  const receiptKey = (documentId, accountId) => `${documentId}:${accountId}`;
  const prisma = {
    patientClinicalDocumentReceipt: {
      findMany: async ({ where }) => [...receipts.values()].filter((row) => row.accountId === where.accountId && where.documentId.in.includes(row.documentId)),
      findUnique: async ({ where }) => receipts.get(receiptKey(where.documentId_accountId.documentId, where.documentId_accountId.accountId)) ?? null,
      upsert: async ({ where, create, update }) => {
        const key = receiptKey(where.documentId_accountId.documentId, where.documentId_accountId.accountId);
        const current = receipts.get(key);
        const row = current ? { ...current, ...update } : { id: `receipt-${receipts.size + 1}`, createdAt: new Date(), updatedAt: new Date(), acknowledgedAt: null, firstOpenedAt: null, ...create };
        receipts.set(key, row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const key = receiptKey(where.documentId, where.accountId);
        const current = receipts.get(key);
        if (!current || (where.firstOpenedAt === null && current.firstOpenedAt !== null)) return { count: 0 };
        receipts.set(key, { ...current, ...data, updatedAt: new Date() });
        return { count: 1 };
      },
    },
    clinicalDocument: {
      findMany: async ({ where }) => where.id.in.map((id) => documents.get(id)).filter(Boolean),
      findFirst: async ({ where }) => {
        const row = documents.get(where.id);
        if (!row || row.patientId !== where.patientId || row.status !== where.status || row.releasedToPatient !== where.releasedToPatient) return null;
        return { id: row.id, kind: row.kind, providerId: row.providerId, createdByAccountId: row.createdByAccountId };
      },
      // Prisma query results are snapshots. Return a copy so the later
      // releaseDocument mutation cannot retroactively alter the pre-release
      // state used by releaseProviderDocument's notification decision.
      findUnique: async ({ where }) => {
        const row = documents.get(where.id);
        return row ? { ...row } : null;
      },
    },
    patientProfile: {
      findUnique: async ({ where }) => {
        if (where.userId === patientAccount) return { id: patientId };
        if (where.id === patientId) return { userId: patientAccount };
        return null;
      },
    },
  };
  const audit = { write: async (row) => { audits.push(row); } };
  const notificationService = { notifyAccount: async (row) => { notifications.push(row); return { id: `n-${notifications.length}` }; } };
  const documentService = {
    patientUpload: async (_principal, input) => { uploads.push(input); return { id: 'uploaded-note', kind: 'PATIENT_UPLOAD', releasedToPatient: true }; },
    removeDocument: async (_principal, id) => { removals.push(id); return { id, status: 'REMOVED' }; },
    releaseDocument: async (_principal, id) => {
      const row = documents.get(id);
      if (!row) throw new Error('not found');
      row.releasedToPatient = true;
      return { id, releasedToPatient: true };
    },
  };
  const centre = {
    list: async () => ({ accessBasis: 'PATIENT_SELF', truncated: false, items: [
      { id: careDocument.id, kind: careDocument.kind, source: 'CARE_TEAM', downloadable: true, metadata: { title: 'Care document' } },
      { id: patientDocument.id, kind: patientDocument.kind, source: 'PATIENT', downloadable: true, metadata: { title: 'Patient note' } },
    ] }),
    consumeDownloadGrant: async (_principal, id) => ({ bytes: Buffer.from(`content:${id}`), mediaType: 'text/plain', fileName: `${id}.txt` }),
  };
  const service = new PatientDocumentInboxService(prisma, audit, notificationService, documentService, centre);
  return { service, receipts, notifications, uploads, removals, audits };
}

const principal = { role: 'PATIENT', accountId: patientAccount };

async function listAndReceiptCase() {
  const test = harness();
  const initial = await test.service.list(principal, {});
  const patient = initial.items.find((row) => row.id === patientDocument.id);
  const care = initial.items.find((row) => row.id === careDocument.id);
  if (!patient?.patientRemovable || care?.patientRemovable) throw new Error('Patient-removal ownership projection is incorrect.');
  if ('objectKey' in patient || 'contentDigest' in patient || 'storageProvider' in patient) throw new Error('Sensitive storage metadata leaked into inbox DTO.');

  await test.service.consumeDownloadGrant(principal, careDocument.id, { token: 'opaque' });
  const opened = await test.service.list(principal, { focusDocumentId: careDocument.id });
  if (opened.items[0].id !== careDocument.id || opened.items[0].opened !== true || !opened.items[0].firstOpenedAt) throw new Error('First-open receipt was not persisted/focused.');
  const acknowledged = await test.service.acknowledge(principal, careDocument.id);
  if (!acknowledged.acknowledgedAt) throw new Error('Document acknowledgement was not persisted.');
}

async function personalNoteCase() {
  const test = harness();
  await test.service.uploadPersonalText(principal, { title: 'My note', category: 'History', description: 'Context', content: 'Patient supplied text' });
  if (test.uploads.length !== 1) throw new Error('Patient note did not reuse the encrypted upload pipeline.');
  const input = test.uploads[0];
  if (input.mediaType !== 'text/plain' || Buffer.from(input.contentBase64, 'base64').toString('utf8') !== 'Patient supplied text') throw new Error('Patient note payload was not encoded correctly.');
  if (!String(input.description).includes('Category: History')) throw new Error('Patient note category was not retained in encrypted metadata.');
  await test.service.removeOwnUpload(principal, patientDocument.id);
  if (test.removals[0] !== patientDocument.id) throw new Error('Owned patient upload was not removable.');
  let denied = false;
  try { await test.service.removeOwnUpload(principal, careDocument.id); } catch { denied = true; }
  if (!denied) throw new Error('Provider-authored document was removable by Patient inbox.');
}

async function notificationCase() {
  const test = harness();
  await test.service.releaseProviderDocument({ role: 'DOCTOR', accountId: 'provider-account' }, releaseDocument.id);
  if (test.notifications.length !== 1) throw new Error('Generic provider document release did not enqueue one notification.');
  const event = test.notifications[0];
  if (event.accountId !== patientAccount || event.type !== 'CLINICAL_UPDATE' || event.entityType !== 'CLINICAL_DOCUMENT' || event.entityId !== releaseDocument.id) throw new Error('Document notification identity is incorrect.');
  if (event.safeTitleKey !== 'notification.clinical.document.title' || event.safeBodyKey !== 'notification.clinical.document.body') throw new Error('Document notification safe-template contract is incorrect.');
  const serialized = JSON.stringify(event);
  if (serialized.includes('Care document') || serialized.includes('Patient note')) throw new Error('Document metadata leaked into notification payload.');
  await test.service.releaseProviderDocument({ role: 'DOCTOR', accountId: 'provider-account' }, labDocument.id);
  if (test.notifications.length !== 1) throw new Error('Dedicated laboratory document lifecycle was double-notified.');
}

await listAndReceiptCase();
await personalNoteCase();
await notificationCase();
console.log(JSON.stringify({ status: 'passed', patientInbox: true, receipts: true, personalNotes: true, genericReleaseNotification: true }));
