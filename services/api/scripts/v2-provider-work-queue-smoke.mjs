import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/modules/other-provider-workspace/provider-work-queue.module.ts", import.meta.url),
  "utf8",
);
const types = readFileSync(
  new URL("../src/modules/other-provider-workspace/provider-work-queue.types.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
const mobileApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const mobileQueue = readFileSync(
  new URL("../../../packages/mobile_core/lib/provider_work_queue.dart", import.meta.url),
  "utf8",
);
const providerActions = readFileSync(
  new URL("../../../packages/mobile_core/lib/care_provider_actions.dart", import.meta.url),
  "utf8",
);

// Canonical route and strict own-provider scope.
assert.match(source, /@Controller\("provider\/jobs"\)/);
assert.match(source, /@Get\("work-queue"\)/);
assert.match(source, /RequirePermissions\("OTHER_PROVIDER_WORKFLOW_EXECUTE"\)/);
assert.match(source, /where:\s*\{ userId: principal\.accountId \}/);
assert.match(source, /provider\.class !== "OTHER_PROVIDER"/);
assert.match(source, /provider\.status !== "ACTIVE"/);
assert.match(source, /providerId: provider\.id/);
assert.match(source, /assignedProviderId: provider\.id/);

// Only active HOME_VISIT and scheduled transport work is aggregated.
assert.match(source, /modality:\s*"HOME_VISIT"/);
assert.match(source, /status:\s*"CONFIRMED"/);
assert.match(source, /ASSIGNED/);
assert.match(source, /EN_ROUTE/);
assert.match(source, /ARRIVED/);
assert.match(source, /TRANSPORTING/);
assert.match(types, /ProviderWorkItem/);
assert.match(types, /HOME_VISIT/);
assert.match(types, /MEDICAL_TRANSPORT/);

// Priority criteria are explicit, bounded and explainable.
assert.match(types, /SCHEDULE_TIME/);
assert.match(types, /DISTANCE_ETA/);
assert.match(types, /OPERATIONAL_URGENCY/);
assert.match(types, /SLA/);
assert.match(types, /CAPABILITY_FIT/);
assert.match(types, /maximum:\s*number/);
assert.match(types, /explanationKey:\s*string/);
assert.match(source, /scheduleTime:\s*30/);
assert.match(source, /distanceEta:\s*15/);
assert.match(source, /operationalUrgency:\s*25/);
assert.match(source, /sla:\s*25/);
assert.match(source, /capabilityFit:\s*5/);
assert.match(source, /contribution/);
assert.match(source, /explanationKey/);
assert.match(source, /priorityVersion/);
assert.match(source, /rank: index \+ 1/);
assert.match(source, /right\.priority\.score - left\.priority\.score/);

// No autonomous clinical decisioning or inferred distance.
assert.match(source, /autonomousClinicalDecision:\s*false/);
assert.match(source, /Distance is not inferred/);
assert.match(source, /Existing provider ETA is used when available/);
assert.doesNotMatch(source, /prisma\.(observation|questionnaireResponse|clinicalRecord|clinicalProfileEntry)/);
assert.doesNotMatch(source, /diagnosisScore|symptomScore|clinicalRiskScore/);

// Work-queue reads are audit-evidenced without PHI scoring inputs.
assert.match(source, /OTHER_PROVIDER_WORK_QUEUE_READ/);
assert.match(source, /CARE_DELIVERY_OPERATIONS/);
assert.match(source, /autonomousClinicalDecision:\s*false/);
assert.match(appModule, /ProviderWorkQueueModule/);

// Mobile client consumes the same response contract and exposes score decomposition.
assert.match(mobileApi, /providerWorkQueue/);
assert.match(mobileApi, /\/provider\/jobs\/work-queue/);
assert.match(mobileQueue, /widget\.session\.api\.providerWorkQueue\(\)/);
assert.match(mobileQueue, /_map\(_payload\['policy'\]\)/);
assert.match(mobileQueue, /_map\(policy\['weights'\]\)/);
assert.match(mobileQueue, /criterion\['key'\]/);
assert.match(mobileQueue, /criterion\['contribution'\]/);
assert.match(mobileQueue, /criterion\['maximum'\]/);
assert.match(mobileQueue, /criterion\['explanationKey'\]/);
assert.match(mobileQueue, /No clinical diagnosis or inferred risk is used/);
assert.match(mobileQueue, /CarePointLocale\.ar/);
assert.match(mobileQueue, /CarePointLocale\.fr/);
assert.match(mobileQueue, /CarePointLocale\.es/);
assert.match(providerActions, /'workQueue'/);
assert.match(providerActions, /ProviderWorkQueuePage/);

console.log("V2 PRV-088 explainable operational provider work queue acceptance passed");
