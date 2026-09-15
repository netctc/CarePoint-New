import { DocumentsService } from '../dist/modules/documents/documents.service.js';

const reportTemplate = () => ({
  id: 'f12-report-1',
  patientId: 'f12-patient-1',
  providerId: 'f12-provider-1',
  encounterRef: 'f12-appointment-1',
  documentId: 'f12-document-1',
  type: 'IMAGING',
  status: 'FINAL',
  algorithm: 'AES-256-GCM',
  keyId: 'test-key',
  wrappedKey: 'wrapped',
  iv: 'iv',
  ciphertext: 'ciphertext',
  payloadDigest: 'digest-1',
  signatureAlgorithm: 'HMAC-SHA256',
  signatureKeyId: 'signing-key',
  signature: 'signature',
  finalizedAt: new Date('2026-09-11T20:00:00Z'),
  releasedAt: null,
  createdAt: new Date('2026-09-11T19:00:00Z'),
});

function harness({ failNotification = false } = {}) {
  let report = reportTemplate();
  const notificationCalls = [];
  const auditCalls = [];
  let wakeCount = 0;
  let documentReleased = false;

  const tx = {
    patientProfile: {
      findUnique: async ({ where }) => where.id === report.patientId ? { userId: 'f12-patient-account' } : null,
    },
    diagnosticReport: {
      updateMany: async ({ where, data }) => {
        if (where.id !== report.id || where.status !== report.status) return { count: 0 };
        report = { ...report, ...data };
        return { count: 1 };
      },
    },
    clinicalDocument: {
      updateMany: async ({ where, data }) => {
        if (where.id === report.documentId && where.status === 'AVAILABLE' && data.releasedToPatient === true) {
          documentReleased = true;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };

  const prisma = {
    provider: {
      findUnique: async () => ({ id: 'f12-provider-1', class: 'DOCTOR', status: 'ACTIVE' }),
    },
    diagnosticReport: {
      findUnique: async ({ where }) => where.id === report.id ? { ...report } : null,
    },
    $transaction: async (callback) => {
      const snapshot = { report: { ...report }, documentReleased };
      try {
        return await callback(tx);
      } catch (error) {
        report = snapshot.report;
        documentReleased = snapshot.documentReleased;
        throw error;
      }
    },
  };

  const audit = { write: async (value) => { auditCalls.push(value); } };
  const storage = {};
  const envelope = {
    decryptMetadata: async () => ({ findings: 'F12-SENSITIVE-FINDING', impression: 'F12-SENSITIVE-IMPRESSION' }),
  };
  const attestation = {
    verify: async () => true,
    digest: () => 'digest-1',
  };
  const scanner = {};
  const dicomweb = {};
  const notifications = {
    enqueueAccountInTransaction: async (actualTx, input) => {
      if (actualTx !== tx) throw new Error('Notification was not enqueued in the release transaction.');
      if (failNotification) throw new Error('synthetic notification failure');
      notificationCalls.push(input);
      return { id: 'notification-1' };
    },
    wakeOutbox: () => { wakeCount += 1; },
  };

  const service = new DocumentsService(prisma, audit, storage, envelope, attestation, scanner, dicomweb, notifications);
  return {
    service,
    state: () => ({ report: { ...report }, documentReleased, notificationCalls: [...notificationCalls], auditCalls: [...auditCalls], wakeCount }),
  };
}

async function successCase() {
  const test = harness();
  const result = await test.service.releaseDiagnosticReport({ role: 'DOCTOR', accountId: 'f12-doctor-account' }, 'f12-report-1');
  const state = test.state();
  if (state.report.status !== 'RELEASED' || result.status !== 'RELEASED') throw new Error('Diagnostic report was not released.');
  if (!state.documentReleased) throw new Error('Attached document was not released in the same transaction.');
  if (state.notificationCalls.length !== 1) throw new Error(`Expected one notification enqueue, got ${state.notificationCalls.length}.`);
  const event = state.notificationCalls[0];
  if (event.accountId !== 'f12-patient-account' || event.type !== 'CLINICAL_UPDATE' || event.entityType !== 'DIAGNOSTIC_REPORT' || event.entityId !== 'f12-report-1') throw new Error('Diagnostic notification identity contract is incorrect.');
  if (event.safeTitleKey !== 'notification.clinical.diagnostic-report.title' || event.safeBodyKey !== 'notification.clinical.diagnostic-report.body') throw new Error('Diagnostic notification safe-template contract is incorrect.');
  const serialized = JSON.stringify(event);
  if (serialized.includes('F12-SENSITIVE-FINDING') || serialized.includes('F12-SENSITIVE-IMPRESSION')) throw new Error('Diagnostic PHI leaked into notification input.');
  if (state.wakeCount !== 1) throw new Error('Notification outbox was not woken exactly once after commit.');
  if (state.auditCalls.length !== 1 || JSON.stringify(state.auditCalls[0]).includes('F12-SENSITIVE')) throw new Error('Release audit is missing or contains diagnostic PHI.');
}

async function rollbackCase() {
  const test = harness({ failNotification: true });
  let rejected = false;
  try {
    await test.service.releaseDiagnosticReport({ role: 'DOCTOR', accountId: 'f12-doctor-account' }, 'f12-report-1');
  } catch (error) {
    rejected = String(error).includes('synthetic notification failure');
  }
  if (!rejected) throw new Error('Synthetic notification failure did not abort diagnostic release.');
  const state = test.state();
  if (state.report.status !== 'FINAL' || state.report.releasedAt !== null) throw new Error('Failed notification did not roll back report release.');
  if (state.documentReleased) throw new Error('Failed notification did not roll back attached-document release.');
  if (state.wakeCount !== 0) throw new Error('Outbox was woken for a rolled-back release.');
  if (state.auditCalls.length !== 0) throw new Error('Success audit was emitted for a rolled-back release.');
}

await successCase();
await rollbackCase();
console.log(JSON.stringify({ status: 'passed', atomicRelease: true, phiNeutralNotification: true, rollbackVerified: true }));
