import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(relative)=>readFileSync(new URL(relative,import.meta.url),"utf8");

const globals=read("../app/globals.css");
const professional=read("../components/ProfessionalAdministrationCenter.tsx");
const questionnaires=read("../app/questionnaires/page.tsx");
const providerTaxonomy=read("../app/providers/taxonomy/page.tsx");
const clinicalMetrics=read("../components/ClinicalMetricsManager.tsx");
const alertPolicies=read("../components/AlertPolicyManager.tsx");
const profileSchema=read("../components/ClinicalProfileSchemaManager.tsx");
const patientDirectory=read("../components/AdminPatientDirectory.tsx");
const governanceQueue=read("../components/ProviderGovernanceQueue.tsx");
const finance=read("../components/FinanceOperations.tsx");
const breakGlass=read("../components/BreakGlassReview.tsx");
const triggerRules=read("../app/questionnaires/triggers/page.tsx");
const b6Governance=read("../components/B6GovernanceCenter.tsx");

assert.ok(globals.includes("Admin form layout standardization"));
assert.ok(globals.includes("flex-direction:column"));
assert.ok(globals.includes(".admin-form-grid"));
assert.ok(globals.includes(".admin-form-field"));
assert.ok(globals.includes(".admin-form-check"));
assert.ok(globals.includes("min-height:42px"));

assert.ok(professional.includes("<span>{t.account} status</span><select"));
assert.ok(professional.includes("<span>{t.provider} status</span><select"));
assert.ok(professional.includes("<span>{t.status}</span><select"));

assert.ok(questionnaires.includes('className="admin-form-grid"'));
assert.ok(questionnaires.includes('className="admin-form-check"'));
assert.ok(providerTaxonomy.includes('className="admin-form-grid"'));
assert.ok(providerTaxonomy.includes('className="admin-form-check"'));

assert.ok(clinicalMetrics.includes("<span>{t.code}</span><input"));
assert.ok(clinicalMetrics.includes("<span>{t.from}</span><select"));
assert.ok(clinicalMetrics.includes("<span>{t.metric}</span><select"));
assert.ok(alertPolicies.includes("<span>{t.labels} · EN</span><input"));
assert.ok(alertPolicies.includes('className="admin-form-field"'));

assert.ok(profileSchema.includes('className="admin-form-field" style={{minWidth:220}}'));
assert.ok(profileSchema.includes("<span>{pg(locale,\"definition\")}</span><textarea"));
assert.ok(patientDirectory.includes("<span>{pg(locale, \"search\")}</span><input"));
assert.ok(patientDirectory.includes("<span>{pg(locale, \"status\")}</span><select"));

assert.ok(governanceQueue.includes("<span>{copy.search}</span><input"));
assert.ok(governanceQueue.includes("<span>{copy.reviewState}</span><select"));
assert.ok(finance.includes("<span>{c.selectCapacity}</span><select"));
assert.ok(finance.includes("<span>{c.payoutAmount}</span><input"));
assert.ok(breakGlass.includes("<span>{c.review}</span><select"));
assert.ok(breakGlass.includes("<span>{c.reason}</span><select"));

assert.ok(triggerRules.includes("<span>{t.patientId}</span><input"));
assert.ok(triggerRules.includes("<span>{t.eventId}</span><input"));
assert.ok(b6Governance.includes("<span>{c.search}</span><input"));

console.log("Admin V2 vertical form layout and visible-label acceptance passed");
