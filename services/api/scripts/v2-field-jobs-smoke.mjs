import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/modules/other-provider-workspace/provider-field-jobs.module.ts", import.meta.url),
  "utf8",
);
const workspaceModule = readFileSync(
  new URL("../src/modules/other-provider-workspace/other-provider-workspace.module.ts", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../src/modules/provider-workflow/provider-workflow.module.ts", import.meta.url),
  "utf8",
);

// Canonical unified job routes remain read-only facades over authoritative domain state.
assert.match(source, /@Controller\("provider\/jobs"\)/);
assert.match(source, /@Get\(":kind\/:jobId"\)/);
assert.match(source, /@Get\(":kind\/:jobId\/events"\)/);
assert.match(source, /RequirePermissions\("OTHER_PROVIDER_WORKFLOW_EXECUTE"\)/);
assert.match(source, /HOME_VISIT/);
assert.match(source, /MEDICAL_TRANSPORT/);
assert.doesNotMatch(source, /@Post\(/);
assert.doesNotMatch(source, /@Patch\(/);
assert.doesNotMatch(source, /@Delete\(/);

// Provider identity and assignment are always derived server-side from the authenticated account.
assert.match(source, /where:\s*\{ userId: principal\.accountId \}/);
assert.match(source, /provider\.class !== "OTHER_PROVIDER"/);
assert.match(source, /provider\.status !== "ACTIVE"/);
assert.match(source, /providerId: provider\.providerId/);
assert.match(source, /assignedProviderId: provider\.providerId/);

// Allowed actions are state + category-capability derived and delegate to existing transition endpoints.
assert.match(source, /parseProviderCategoryCapabilities/);
assert.match(source, /HOME_VISIT_ARRIVAL/);
assert.match(source, /SERVICE_COMPLETION_CHECKLIST/);
assert.match(source, /TRANSPORT_ACCEPT/);
assert.match(source, /TRANSPORT_REJECT/);
assert.match(source, /TRANSPORT_EQUIPMENT_CHECKLIST/);
assert.match(source, /\/api\/v1\/provider\/workflows\/home-visits/);
assert.match(source, /\/api\/v1\/provider\/workflows\/medical-transport/);
assert.match(workflow, /home-visits\/:appointmentId\/arrive/);
assert.match(workflow, /home-visits\/:appointmentId\/complete/);
assert.match(workflow, /medical-transport\/:requestId\/accept-assignment/);
assert.match(workflow, /medical-transport\/:requestId\/reject/);
assert.match(workflow, /medical-transport\/:requestId\/equipment-confirm/);

// Event history is structural only: evidence payloads are deliberately not selected or returned.
assert.match(source, /select:\s*\{ id: true, eventType: true, occurredAt: true \}/);
assert.match(source, /evidencePayloadExposed:\s*false/);
assert.doesNotMatch(source, /select:\s*\{[^}]*evidence:\s*true/s);
assert.doesNotMatch(source, /event\.evidence/);
assert.match(source, /TRANSPORT_STATUS_CHANGED/);
assert.match(source, /OTHER_PROVIDER_FIELD_JOB_READ/);
assert.match(source, /OTHER_PROVIDER_FIELD_JOB_EVENTS_READ/);
assert.match(source, /CARE_DELIVERY_OPERATIONS/);
assert.match(source, /autonomousClinicalDecision:\s*false/);

// No second persistence/state machine is introduced; workspace module owns the facade registration.
assert.match(workspaceModule, /ProviderFieldJobsModule/);
assert.doesNotMatch(source, /\.create\(/);
assert.doesNotMatch(source, /\.update\(/);
assert.doesNotMatch(source, /\.updateMany\(/);
assert.doesNotMatch(source, /\.delete/);

console.log("V2 BE-031 unified field jobs facade acceptance passed");
