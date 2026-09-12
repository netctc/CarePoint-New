import { PrismaClient } from '@prisma/client';

const base = process.env.CAREPOINT_API_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();
const doctorPassword = process.env.SLICE6_DOCTOR_PASSWORD;
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD;
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!doctorPassword || !patientPassword || !adminPassword) throw new Error('Slice 6.2 CI passwords must be supplied through environment variables.');

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
async function createCompletedAppointment({ patientId, providerId, serviceId, modality = 'CLINIC', idempotencyKey, startsAt }) {
  const start = new Date(startsAt);
  return prisma.appointment.create({
    data: {
      patientId,
      providerId,
      serviceId,
      modality,
      status: 'COMPLETED',
      startsAt: start,
      endsAt: new Date(start.getTime() + 30 * 60 * 1000),
      idempotencyKey,
    },
  });
}
async function prepareInsurance({ appointmentId, coverageId, patientToken, doctorToken, suffix }) {
  const eligibility = await request(`/insurance/appointments/${appointmentId}/eligibility`, {
    method: 'POST', token: patientToken, body: { coverageId, idempotencyKey: `slice62-eligibility-${suffix}` },
  });
  if (eligibility.status !== 'ELIGIBLE') throw new Error(`Expected ELIGIBLE for ${suffix}, got ${eligibility.status}.`);
  const prior = await request(`/insurance/appointments/${appointmentId}/prior-authorization`, {
    method: 'POST', token: doctorToken, body: { coverageId, eligibilityCheckId: eligibility.id, idempotencyKey: `slice62-prior-${suffix}` },
  });
  if (prior.status !== 'NOT_REQUIRED' && prior.status !== 'APPROVED') throw new Error(`Unexpected prior authorization ${prior.status} for ${suffix}.`);
  return { eligibility, prior };
}

async function main() {
  const doctorToken = await login('doctor-slice2@carepoint.test', doctorPassword);
  const adminToken = await login('admin-ci@carepoint.test', adminPassword);
  const doctor = await prisma.user.findUnique({ where: { email: 'doctor-slice2@carepoint.test' }, include: { provider: true } });
  if (!doctor?.provider?.id) throw new Error('Slice 2 doctor provider fixture missing.');
  const fixtureAppointment = await prisma.appointment.findFirst({ where: { providerId: doctor.provider.id }, orderBy: { createdAt: 'asc' } });
  if (!fixtureAppointment) throw new Error('Appointment fixture missing.');
  const patient = await prisma.patientProfile.findUnique({ where: { id: fixtureAppointment.patientId }, include: { user: true } });
  if (!patient?.user?.email) throw new Error('Patient fixture missing.');
  const patientToken = await login(patient.user.email, patientPassword);

  const coverage = await request('/insurance/me/coverages', {
    method: 'POST',
    token: patientToken,
    body: {
      payerCode: 'CLAIMS-CI',
      payerName: 'CarePoint Claims CI Insurance',
      externalPolicyRef: 'opaque-claims-policy-reference-ci',
      displayLabel: 'Claims CI Health Plan',
      effectiveFrom: '2025-01-01',
      effectiveUntil: '2031-12-31',
    },
  });
  if (!coverage?.id || coverage.externalPolicyRef !== undefined || coverage.policyReferenceStoredExternally !== true) throw new Error('Slice 6.2 coverage fixture was not created with a redacted policy reference.');

  const standardService = await prisma.service.findFirst({ where: { providerId: doctor.provider.id, active: true, modalities: { some: { modality: 'CLINIC', active: true } } }, orderBy: { createdAt: 'asc' } });
  if (!standardService) throw new Error('Active clinic service fixture missing.');
  const standardModality = await prisma.serviceModality.findUnique({ where: { serviceId_modality: { serviceId: standardService.id, modality: 'CLINIC' } } });
  if (!standardModality) throw new Error('Clinic modality fixture missing.');

  const paidAppointment = await createCompletedAppointment({
    patientId: patient.id,
    providerId: doctor.provider.id,
    serviceId: standardService.id,
    idempotencyKey: 'slice62-paid-appointment-0001',
    startsAt: '2030-02-03T09:00:00.000Z',
  });
  const paidInvoice = await prisma.invoice.findUnique({ where: { appointmentId: paidAppointment.id } });
  if (!paidInvoice || paidInvoice.totalMinor !== standardModality.priceMinor) throw new Error('Paid-flow appointment did not create a pricing snapshot/invoice.');
  const paidInsurance = await prepareInsurance({ appointmentId: paidAppointment.id, coverageId: coverage.id, patientToken, doctorToken, suffix: 'paid-0001' });
  if (paidInsurance.eligibility.estimatedInsurerMinor + paidInsurance.eligibility.estimatedPatientMinor !== paidInvoice.totalMinor) throw new Error('Paid-flow eligibility does not reconcile to invoice total.');

  const submitInput = { coverageId: coverage.id, idempotencyKey: 'slice62-claim-paid-0001' };
  const submitted = await request(`/provider/revenue-cycle/appointments/${paidAppointment.id}/claims`, { method: 'POST', token: doctorToken, body: submitInput });
  if (submitted.status !== 'SUBMITTED' || submitted.version !== 1) throw new Error('Claim submission did not create version 1 SUBMITTED claim.');
  const submitRetry = await request(`/provider/revenue-cycle/appointments/${paidAppointment.id}/claims`, { method: 'POST', token: doctorToken, body: submitInput });
  if (submitRetry.id !== submitted.id) throw new Error('Claim submission idempotency returned a different claim.');

  const patientSubmitDenied = await raw(`/provider/revenue-cycle/appointments/${paidAppointment.id}/claims`, { method: 'POST', token: patientToken, body: submitInput });
  if (patientSubmitDenied.status !== 403) throw new Error(`Patient unexpectedly submitted provider claim: HTTP ${patientSubmitDenied.status}.`);

  const adjudicated = await request(`/provider/revenue-cycle/claims/${submitted.id}/refresh`, { method: 'POST', token: doctorToken });
  if (adjudicated.claim?.status !== 'ADJUDICATED' || adjudicated.claim?.reconciliationStatus !== 'RECONCILED') throw new Error('Claim did not reach reconciled ADJUDICATED state.');
  if (!adjudicated.eob || adjudicated.eob.billedMinor !== paidInvoice.totalMinor || adjudicated.eob.insurerPaidMinor + adjudicated.eob.patientResponsibilityMinor !== adjudicated.eob.allowedMinor) throw new Error('Adjudicated EOB amounts are invalid.');
  const reconciledInvoice = await prisma.invoice.findUnique({ where: { id: paidInvoice.id } });
  if (!reconciledInvoice || reconciledInvoice.patientResponsibilityMinor !== adjudicated.eob.patientResponsibilityMinor || reconciledInvoice.insurerResponsibilityMinor !== adjudicated.eob.insurerPaidMinor) throw new Error('EOB did not reconcile invoice responsibility.');

  const patientRevenueAfterAdjudication = await request('/revenue-cycle/me', { token: patientToken });
  const patientClaim = patientRevenueAfterAdjudication.claims?.find((item) => item.id === submitted.id);
  if (!patientClaim || patientClaim.gateway !== undefined || patientClaim.gatewayClaimRef !== undefined || patientClaim.reworkReasonCode !== undefined) throw new Error('Patient claim presentation exposed internal payer fields.');
  if (!patientRevenueAfterAdjudication.eobs?.some((item) => item.claimId === submitted.id)) throw new Error('Patient did not receive released EOB after adjudication.');

  const paid = await request(`/provider/revenue-cycle/claims/${submitted.id}/refresh`, { method: 'POST', token: doctorToken });
  if (paid.claim?.status !== 'PAID' || paid.remittances?.length !== 1) throw new Error('Claim did not reach PAID with one remittance.');
  const paidRetry = await request(`/provider/revenue-cycle/claims/${submitted.id}/refresh`, { method: 'POST', token: doctorToken });
  if (paidRetry.claim?.status !== 'PAID') throw new Error('Paid claim refresh was not idempotent.');
  const paidRemittances = await prisma.insuranceRemittance.findMany({ where: { claimId: submitted.id } });
  if (paidRemittances.length !== 1) throw new Error('Paid claim created duplicate remittances.');
  const paidInsuranceLedger = await prisma.providerLedgerEntry.findMany({ where: { providerId: doctor.provider.id, invoiceId: paidInvoice.id, type: 'INSURANCE_PAYMENT' } });
  if (paidInsuranceLedger.length !== 1 || paidInsuranceLedger[0].amountMinor !== paid.eob.insurerPaidMinor) throw new Error('Insurance remittance was not credited exactly once to provider ledger.');

  const highService = await request('/provider/services', {
    method: 'POST', token: doctorToken,
    body: {
      labels: { en: 'CI high-value claim service', ar: 'CI high-value claim service', fr: 'CI high-value claim service', es: 'CI high-value claim service' },
      currency: 'USD',
      modalities: [{ modality: 'CLINIC', durationMinutes: 30, priceMinor: 150000 }],
    },
  });
  const deniedAppointment = await createCompletedAppointment({
    patientId: patient.id,
    providerId: doctor.provider.id,
    serviceId: highService.id,
    idempotencyKey: 'slice62-denied-appointment-0001',
    startsAt: '2030-02-04T09:00:00.000Z',
  });
  const deniedInvoice = await prisma.invoice.findUnique({ where: { appointmentId: deniedAppointment.id } });
  if (!deniedInvoice || deniedInvoice.totalMinor !== 150000) throw new Error('Denied-flow invoice fixture is invalid.');
  const deniedInsurance = await prepareInsurance({ appointmentId: deniedAppointment.id, coverageId: coverage.id, patientToken, doctorToken, suffix: 'denied-0001' });
  if (deniedInsurance.prior.status !== 'APPROVED') throw new Error(`High-value claim expected APPROVED prior authorization, got ${deniedInsurance.prior.status}.`);

  const deniedClaim = await request(`/provider/revenue-cycle/appointments/${deniedAppointment.id}/claims`, {
    method: 'POST', token: doctorToken, body: { coverageId: coverage.id, idempotencyKey: 'slice62-claim-denied-0001' },
  });
  const denied = await request(`/provider/revenue-cycle/claims/${deniedClaim.id}/refresh`, { method: 'POST', token: doctorToken });
  if (denied.claim?.status !== 'DENIED' || denied.claim?.reconciliationStatus !== 'REVIEW_REQUIRED') throw new Error('High-value claim did not reach DENIED/REVIEW_REQUIRED.');
  if (denied.eob?.denialCode !== 'MOCK_REVIEW_REQUIRED' || denied.eob.adjustmentMinor !== deniedInvoice.totalMinor) throw new Error('Denied EOB is incomplete.');

  const reworkInput = { idempotencyKey: 'slice62-rework-0001', reasonCode: 'CORRECTED_CLAIM' };
  const replacement = await request(`/provider/revenue-cycle/claims/${deniedClaim.id}/rework`, { method: 'POST', token: doctorToken, body: reworkInput });
  if (replacement.version !== 2 || replacement.previousClaimId !== deniedClaim.id || replacement.status !== 'SUBMITTED') throw new Error('Denied claim rework did not create immutable version 2.');
  const reworkRetry = await request(`/provider/revenue-cycle/claims/${deniedClaim.id}/rework`, { method: 'POST', token: doctorToken, body: reworkInput });
  if (reworkRetry.id !== replacement.id) throw new Error('Claim rework idempotency returned a different replacement.');
  const secondRework = await raw(`/provider/revenue-cycle/claims/${deniedClaim.id}/rework`, { method: 'POST', token: doctorToken, body: { idempotencyKey: 'slice62-rework-0002', reasonCode: 'SECOND_REWORK' } });
  if (secondRework.status !== 409) throw new Error(`Original denied claim unexpectedly allowed a second replacement: HTTP ${secondRework.status}.`);

  const correctedAdjudication = await request(`/provider/revenue-cycle/claims/${replacement.id}/refresh`, { method: 'POST', token: doctorToken });
  if (correctedAdjudication.claim?.status !== 'ADJUDICATED' || correctedAdjudication.claim?.reconciliationStatus !== 'RECONCILED') throw new Error('Corrected claim did not adjudicate and reconcile.');
  const correctedPaid = await request(`/provider/revenue-cycle/claims/${replacement.id}/refresh`, { method: 'POST', token: doctorToken });
  if (correctedPaid.claim?.status !== 'PAID' || correctedPaid.remittances?.length !== 1) throw new Error('Corrected claim did not settle with one remittance.');
  const correctedLedger = await prisma.providerLedgerEntry.findMany({ where: { providerId: doctor.provider.id, invoiceId: deniedInvoice.id, type: 'INSURANCE_PAYMENT' } });
  if (correctedLedger.length !== 1 || correctedLedger[0].amountMinor !== correctedPaid.eob.insurerPaidMinor) throw new Error('Corrected claim insurance payment ledger entry is invalid.');

  const originalEvents = await prisma.claimEvent.findMany({ where: { claimId: deniedClaim.id }, orderBy: { occurredAt: 'asc' } });
  const replacementEvents = await prisma.claimEvent.findMany({ where: { claimId: replacement.id }, orderBy: { occurredAt: 'asc' } });
  if (originalEvents.map((item) => item.status).join(',') !== 'SUBMITTED,DENIED') throw new Error('Original denied claim event history is incomplete.');
  if (replacementEvents.map((item) => item.status).join(',') !== 'SUBMITTED,ADJUDICATED,PAID') throw new Error('Replacement claim event history is incomplete.');

  const providerRevenue = await request('/provider/revenue-cycle/claims', { token: doctorToken });
  if (!providerRevenue.claims?.some((item) => item.id === replacement.id) || !providerRevenue.remittances?.some((item) => item.claimId === replacement.id)) throw new Error('Provider revenue-cycle view is incomplete.');
  const operatorPaid = await request('/revenue-cycle/claims?status=PAID', { token: adminToken });
  if (!operatorPaid.some((item) => item.id === submitted.id) || !operatorPaid.some((item) => item.id === replacement.id)) throw new Error('Revenue-cycle operator PAID filter is incomplete.');
  const patientOperatorDenied = await raw('/revenue-cycle/claims', { token: patientToken });
  if (patientOperatorDenied.status !== 403) throw new Error(`Patient unexpectedly accessed revenue-cycle operations: HTTP ${patientOperatorDenied.status}.`);

  const storedClaim = await prisma.insuranceClaim.findUnique({ where: { id: submitted.id } });
  const prohibitedPersistenceFields = ['externalPolicyRef', 'clinicalNotes', 'rawPayerPayload', 'pan', 'cvv', 'cardNumber'];
  if (!storedClaim || Object.keys(storedClaim).some((key) => prohibitedPersistenceFields.includes(key))) throw new Error('Claim persistence contains prohibited raw policy/clinical/payment fields.');

  console.log(JSON.stringify({
    status: 'passed',
    selfContainedCoverageFixture: true,
    claimSubmissionIdempotent: true,
    patientClaimBoundary: true,
    adjudicationReconciled: true,
    eobReleased: true,
    remittanceExactlyOnce: true,
    insuranceLedgerCredit: true,
    denialReviewRequired: true,
    immutableReworkVersion: true,
    correctedClaimPaid: true,
    claimEventHistory: true,
    revenueOperatorBoundary: true,
    rawClinicalAndPolicyFieldsAbsent: true,
  }));
}

try { await main(); } finally { await prisma.$disconnect(); }
