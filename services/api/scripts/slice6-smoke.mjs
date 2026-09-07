import { PrismaClient } from '@prisma/client';

const base = process.env.CAREPOINT_API_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();
const doctorPassword = process.env.SLICE6_DOCTOR_PASSWORD;
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD;
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!doctorPassword || !patientPassword || !adminPassword) throw new Error('Slice 6 CI passwords must be supplied through environment variables.');

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

async function main() {
  const doctorToken = await login('doctor-slice2@carepoint.test', doctorPassword);
  const adminToken = await login('admin-ci@carepoint.test', adminPassword);
  const doctor = await prisma.user.findUnique({ where: { email: 'doctor-slice2@carepoint.test' }, include: { provider: true } });
  if (!doctor?.provider?.id) throw new Error('Slice 2 doctor provider fixture missing.');

  const appointment = await prisma.appointment.findFirst({
    where: { providerId: doctor.provider.id, status: 'CONFIRMED', modality: 'CLINIC', startsAt: { gte: new Date('2030-01-07T00:00:00.000Z'), lt: new Date('2030-01-08T00:00:00.000Z') } },
    orderBy: { createdAt: 'desc' },
  });
  if (!appointment) throw new Error('Slice 2 confirmed appointment fixture missing.');
  const patient = await prisma.patientProfile.findUnique({ where: { id: appointment.patientId }, include: { user: true } });
  if (!patient?.user?.email) throw new Error('Booked patient account missing.');
  const patientToken = await login(patient.user.email, patientPassword);

  const snapshot = await prisma.pricingSnapshot.findUnique({ where: { appointmentId: appointment.id } });
  const invoice = await prisma.invoice.findUnique({ where: { appointmentId: appointment.id } });
  if (!snapshot || !invoice) throw new Error('Booking-time pricing snapshot and invoice were not created atomically.');
  if (snapshot.unitPriceMinor !== 7500 || snapshot.totalMinor !== 7500 || invoice.totalMinor !== 7500 || invoice.balanceDueMinor !== 7500 || invoice.status !== 'OPEN') throw new Error('Unexpected initial financial snapshot.');

  const cancelled = await prisma.appointment.findFirst({ where: { providerId: doctor.provider.id, status: 'CANCELLED', serviceId: appointment.serviceId, startsAt: appointment.startsAt }, orderBy: { createdAt: 'asc' } });
  if (!cancelled) throw new Error('Cancelled Slice 2 booking fixture missing.');
  const cancelledInvoice = await prisma.invoice.findUnique({ where: { appointmentId: cancelled.id } });
  if (!cancelledInvoice || cancelledInvoice.status !== 'VOID' || cancelledInvoice.balanceDueMinor !== 0) throw new Error('Unpaid cancelled appointment invoice was not voided automatically.');

  const modality = await prisma.serviceModality.findUnique({ where: { serviceId_modality: { serviceId: appointment.serviceId, modality: appointment.modality } } });
  if (!modality) throw new Error('Service modality fixture missing.');
  await prisma.serviceModality.update({ where: { id: modality.id }, data: { priceMinor: 9900 } });
  const immutableSnapshot = await prisma.pricingSnapshot.findUnique({ where: { appointmentId: appointment.id } });
  const immutableInvoice = await prisma.invoice.findUnique({ where: { appointmentId: appointment.id } });
  if (immutableSnapshot?.totalMinor !== 7500 || immutableInvoice?.totalMinor !== 7500) throw new Error('Historical pricing changed after service price update.');

  const billing = await request('/billing/me', { token: patientToken });
  if (!billing.invoices?.some((item) => item.id === invoice.id && item.totalMinor === 7500)) throw new Error('Patient billing view does not contain the booking invoice.');

  const coverage = await request('/insurance/me/coverages', {
    method: 'POST', token: patientToken,
    body: { payerCode: 'CARE-CI', payerName: 'CarePoint CI Insurance', externalPolicyRef: 'opaque-policy-reference-ci', displayLabel: 'CI Health Plan', effectiveFrom: '2029-01-01', effectiveUntil: '2031-12-31' },
  });
  if (coverage.externalPolicyRef !== undefined || coverage.policyReferenceStoredExternally !== true) throw new Error('Coverage creation leaked the opaque policy reference.');
  const coverages = await request('/insurance/me/coverages', { token: patientToken });
  const listedCoverage = coverages.find((item) => item.id === coverage.id);
  if (!listedCoverage || listedCoverage.externalPolicyRef !== undefined || listedCoverage.policyReferenceStoredExternally !== true) throw new Error('Coverage listing leaked the opaque policy reference.');

  const eligibility = await request(`/insurance/appointments/${appointment.id}/eligibility`, { method: 'POST', token: patientToken, body: { coverageId: coverage.id, idempotencyKey: 'slice6-eligibility-0001' } });
  if (eligibility.status !== 'ELIGIBLE' || eligibility.estimatedPatientMinor !== 2250 || eligibility.estimatedInsurerMinor !== 5250) throw new Error('Unexpected mock eligibility allocation.');
  const insuredInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  if (!insuredInvoice || insuredInvoice.patientResponsibilityMinor !== 2250 || insuredInvoice.insurerResponsibilityMinor !== 5250 || insuredInvoice.balanceDueMinor !== 2250) throw new Error('Eligibility did not update invoice responsibility safely.');

  const priorAuth = await request(`/insurance/appointments/${appointment.id}/prior-authorization`, { method: 'POST', token: doctorToken, body: { coverageId: coverage.id, eligibilityCheckId: eligibility.id, idempotencyKey: 'slice6-prior-auth-0001' } });
  if (priorAuth.status !== 'NOT_REQUIRED') throw new Error(`Expected NOT_REQUIRED mock prior authorization, got ${priorAuth.status}.`);

  const paymentInput = { idempotencyKey: 'slice6-payment-0001', amountMinor: 2250 };
  const payment = await request(`/billing/invoices/${invoice.id}/payment-intents`, { method: 'POST', token: patientToken, body: paymentInput });
  if (payment.status !== 'SUCCEEDED' || !payment.receipt?.id) throw new Error('Payment did not settle through mock PSP.');
  const paymentRetry = await request(`/billing/invoices/${invoice.id}/payment-intents`, { method: 'POST', token: patientToken, body: paymentInput });
  if (paymentRetry.id !== payment.id || paymentRetry.receipt?.id !== payment.receipt.id) throw new Error('Payment idempotency retry returned a different settlement.');

  const storedPayment = await prisma.paymentIntent.findUnique({ where: { id: payment.id } });
  if (!storedPayment || Object.keys(storedPayment).some((key) => ['pan', 'cvv', 'cardNumber', 'paymentMethodToken'].includes(key))) throw new Error('Payment persistence contains a prohibited card credential field.');
  const paidInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  if (!paidInvoice || paidInvoice.status !== 'PAID' || paidInvoice.amountPaidMinor !== 2250 || paidInvoice.balanceDueMinor !== 0) throw new Error('Invoice was not marked paid after settlement.');

  const providerFinance = await request(`/provider/finance/appointments/${appointment.id}`, { token: doctorToken });
  if (providerFinance.pricingSnapshot?.totalMinor !== 7500 || providerFinance.invoice?.status !== 'PAID') throw new Error('Provider appointment finance view is incomplete.');
  const summaryBeforePayout = await request('/provider/finance/summary', { token: doctorToken });
  if (summaryBeforePayout.availableBalanceMinorByCurrency?.USD !== 2250) throw new Error('Unexpected provider balance before payout.');

  const payout = await request('/finance/payouts', { method: 'POST', token: adminToken, body: { providerId: doctor.provider.id, amountMinor: 1000, currency: 'USD', idempotencyKey: 'slice6-payout-0001' } });
  if (payout.status !== 'PAID') throw new Error('Mock provider payout did not settle.');
  const summaryAfterPayout = await request('/provider/finance/summary', { token: doctorToken });
  if (summaryAfterPayout.availableBalanceMinorByCurrency?.USD !== 1250) throw new Error('Unexpected provider balance after payout.');

  const refundInput = { idempotencyKey: 'slice6-refund-0001', amountMinor: 2250, reason: 'CI full refund' };
  const refund = await request(`/provider/finance/payment-intents/${payment.id}/refunds`, { method: 'POST', token: doctorToken, body: refundInput });
  if (refund.status !== 'SUCCEEDED') throw new Error('Mock refund did not settle.');
  const refundRetry = await request(`/provider/finance/payment-intents/${payment.id}/refunds`, { method: 'POST', token: doctorToken, body: refundInput });
  if (refundRetry.id !== refund.id) throw new Error('Refund idempotency retry returned a different refund.');
  const refundedInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  if (!refundedInvoice || refundedInvoice.status !== 'REFUNDED' || refundedInvoice.amountRefundedMinor !== 2250) throw new Error('Invoice refund state is incorrect.');

  const ledger = await request('/provider/finance/ledger', { token: doctorToken });
  const types = new Set(ledger.filter((item) => item.invoiceId === invoice.id || item.payoutId === payout.id).map((item) => item.type));
  if (!types.has('CHARGE') || !types.has('REFUND') || !types.has('PAYOUT')) throw new Error('Provider ledger is missing financial lifecycle entries.');

  const financeDenied = await raw('/provider/finance/summary', { token: patientToken });
  if (financeDenied.status !== 403) throw new Error(`Patient unexpectedly accessed provider finance: HTTP ${financeDenied.status}.`);

  console.log(JSON.stringify({ status: 'passed', immutablePricing: true, cancelledInvoiceVoided: true, policyReferenceRedacted: true, eligibilityAllocated: true, priorAuthorization: priorAuth.status, paymentSettled: true, paymentIdempotent: true, prohibitedCardFieldsAbsent: true, payoutSettled: true, refundSettled: true, refundIdempotent: true, providerFinanceBoundary: true }));
}

try { await main(); } finally { await prisma.$disconnect(); }
