import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jobs = read("../src/modules/other-provider-workspace/provider-field-jobs.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const queue = read("../../../packages/mobile_core/lib/provider_work_queue.dart");
const mobile = read("../../../packages/mobile_core/lib/provider_job_finance.dart");

// PRV-089 remains inside the canonical provider/jobs facade and requires provider finance permission.
assert.match(jobs, /@Get\(":jobId\/financial-summary"\)/);
assert.match(jobs, /@RequirePermissions\("PROVIDER_READ_FINANCIALS"\)/);
assert.match(jobs, /financialSummary\(principal: AuthPrincipal, jobIdRaw: string\)/);
assert.match(jobs, /const provider = await this\.requireProvider\(principal\)/);
assert.match(jobs, /const source = await this\.resolveJob\(provider\.id, jobIdRaw\)/);

// Home Visit finance is projected only from canonical Invoice + this provider's ledger.
assert.match(jobs, /invoice\.findUnique\([\s\S]*appointmentId: source\.sourceId/);
assert.match(jobs, /invoice\.providerId !== provider\.id/);
assert.match(jobs, /providerLedgerEntry\.findMany\([\s\S]*providerId: provider\.id[\s\S]*invoiceId: invoice\.id/);
assert.match(jobs, /providerPayout\.findMany\([\s\S]*providerId: provider\.id/);
assert.match(jobs, /ledgerNetMinorByCurrency/);
assert.match(jobs, /billingLinkState: "INVOICE_LINKED"/);

// Transport has no finance source in the current canonical model, so no money is invented.
assert.match(jobs, /source\.sourceType === "MEDICAL_TRANSPORT"/);
assert.match(jobs, /billingLinkState: "NO_CANONICAL_BILLING_LINK"/);
assert.match(jobs, /state: "NOT_BILLED"/);
assert.match(jobs, /invoice: null/);
assert.match(jobs, /ledgerEntries: \[\]/);
assert.match(jobs, /payouts: \[\]/);

// Audit is structural and must not copy amounts into metadata.
assert.match(jobs, /action: "PROVIDER_FIELD_JOB_FINANCE_READ"/);
const auditBlock = jobs.match(/action: "PROVIDER_FIELD_JOB_FINANCE_READ"[\s\S]{0,700}/g)?.join("\n") ?? "";
assert.doesNotMatch(auditBlock, /totalMinor|amountMinor|balanceDueMinor|patientResponsibilityMinor|insurerResponsibilityMinor/);

// Mobile opens finance from the exact canonical composite job ID and never synthesizes money.
assert.match(api, /providerJobFinancialSummary\(String jobId\)/);
assert.match(api, /\/provider\/jobs\/\$\{Uri\.encodeComponent\(jobId\)\}\/financial-summary/);
assert.match(queue, /provider-job-finance-/);
assert.match(queue, /jobId: jobId/);
assert.match(mobile, /class ProviderJobFinancialSummaryPage/);
assert.match(mobile, /NO_CANONICAL_BILLING_LINK/);
assert.match(mobile, /Medical Transport has no canonical billing link/);
assert.doesNotMatch(mobile, /estimated|estimateAmount|inferredAmount/i);
for (const locale of ["'en'","'ar'","'fr'","'es'"]) assert.ok(mobile.includes(locale));

console.log("V2 PRV-089 provider job financial summary acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
