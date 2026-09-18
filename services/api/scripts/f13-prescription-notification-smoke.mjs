import { PrescriptionNotificationService } from '../dist/modules/orders/prescription-notification.service.js';

const principal = { role: 'DOCTOR', accountId: 'f13-doctor-account' };
const signedOrder = { id: 'f13-rx-1', type: 'PRESCRIPTION', patientId: 'f13-patient-1' };

function harness({ failNotification = false, missingPatient = false } = {}) {
  const notificationCalls = [];
  const auditCalls = [];
  const prisma = {
    patientProfile: {
      findUnique: async ({ where }) => !missingPatient && where.id === 'f13-patient-1' ? { userId: 'f13-patient-account' } : null,
    },
  };
  const notifications = {
    notifyAccount: async (input) => {
      if (failNotification) throw new Error('synthetic notification failure');
      notificationCalls.push(input);
      return { id: 'f13-notification' };
    },
  };
  const audit = {
    write: async (input) => { auditCalls.push(input); },
  };
  const service = new PrescriptionNotificationService(prisma, notifications, audit);
  return { service, notificationCalls, auditCalls };
}

async function signedCase() {
  const test = harness();
  await test.service.notifySigned(principal, signedOrder);
  if (test.notificationCalls.length !== 1) throw new Error('Expected one signed-prescription notification.');
  const event = test.notificationCalls[0];
  if (event.accountId !== 'f13-patient-account' || event.type !== 'CLINICAL_UPDATE' || event.entityType !== 'CLINICAL_ORDER' || event.entityId !== signedOrder.id) {
    throw new Error('Signed prescription notification identity is incorrect.');
  }
  if (event.safeTitleKey !== 'notification.clinical.prescription.title' || event.safeBodyKey !== 'notification.clinical.prescription.body') {
    throw new Error('Signed prescription safe-template contract is incorrect.');
  }
  if (JSON.stringify(event).includes('medicine') || JSON.stringify(event).includes('dosage')) throw new Error('Prescription PHI leaked into notification input.');
  if (test.auditCalls.length !== 1 || test.auditCalls[0].result !== 'SUCCESS') throw new Error('Signed notification success audit is missing.');
}

async function cancelledCase() {
  const test = harness();
  await test.service.notifyCancelled(principal, signedOrder);
  if (test.notificationCalls.length !== 1) throw new Error('Expected one cancelled-prescription notification.');
  const event = test.notificationCalls[0];
  if (event.safeTitleKey !== 'notification.clinical.prescription.cancelled.title' || event.safeBodyKey !== 'notification.clinical.prescription.cancelled.body') {
    throw new Error('Cancelled prescription safe-template contract is incorrect.');
  }
  if (!event.dedupeKey.endsWith(':prescription-cancelled')) throw new Error('Cancelled prescription dedupe key is incorrect.');
}

async function failureDoesNotMutateClinicalOutcomeCase() {
  const test = harness({ failNotification: true });
  await test.service.notifySigned(principal, signedOrder);
  if (test.notificationCalls.length !== 0) throw new Error('Failed notification was recorded as delivered.');
  if (test.auditCalls.length !== 1 || test.auditCalls[0].result !== 'FAILED') throw new Error('Notification failure was not audited as FAILED.');
  if (JSON.stringify(test.auditCalls[0]).includes('medicine') || JSON.stringify(test.auditCalls[0]).includes('dosage')) throw new Error('Prescription PHI leaked into failure audit.');
}

async function missingPatientFailsClosedCase() {
  const test = harness({ missingPatient: true });
  await test.service.notifySigned(principal, signedOrder);
  if (test.notificationCalls.length !== 0) throw new Error('Notification was attempted without a patient account.');
  if (test.auditCalls.length !== 1 || test.auditCalls[0].result !== 'FAILED') throw new Error('Missing patient notification target was not audited.');
}

async function nonPrescriptionIgnoredCase() {
  const test = harness();
  await test.service.notifySigned(principal, { ...signedOrder, type: 'LABORATORY' });
  if (test.notificationCalls.length !== 0 || test.auditCalls.length !== 0) throw new Error('Non-prescription order entered F13 notification flow.');
}

await signedCase();
await cancelledCase();
await failureDoesNotMutateClinicalOutcomeCase();
await missingPatientFailsClosedCase();
await nonPrescriptionIgnoredCase();
console.log(JSON.stringify({ status: 'passed', phiNeutral: true, signed: true, cancelled: true, auxiliaryFailureSafe: true }));
