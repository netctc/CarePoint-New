import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { credentialIsCurrent, missingCurrentCredentialTypes } = require("../dist/security/provider-credential-validity.js");
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const operationalSource = await readFile(path.join(repoRoot, "services/api/src/security/provider-operational-credential.service.ts"), "utf8");
const onboardingSource = await readFile(path.join(repoRoot, "services/api/src/modules/onboarding/onboarding.module.ts"), "utf8");
const governanceSource = await readFile(path.join(repoRoot, "services/api/src/modules/onboarding/provider-credential-governance.service.ts"), "utf8");
const ciSource = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");

const now = new Date("2026-09-09T20:00:00.000Z");
assert.equal(credentialIsCurrent({ type: "medical-license" }, now), true, "Credentials without an approved validity bound remain policy-neutral/current.");
assert.equal(credentialIsCurrent({ type: "medical-license", validUntil: new Date("2026-09-10T00:00:00.000Z") }, now), true);
assert.equal(credentialIsCurrent({ type: "medical-license", validUntil: new Date("2026-09-09T20:00:00.000Z") }, now), false, "Expiry at the decision instant must not count as current.");
assert.equal(credentialIsCurrent({ type: "medical-license", validUntil: new Date("2026-09-08T00:00:00.000Z") }, now), false);
assert.equal(credentialIsCurrent({ type: "medical-license", validFrom: new Date("2026-09-10T00:00:00.000Z") }, now), false);
assert.deepEqual(missingCurrentCredentialTypes(["medical-license"], [], now), ["medical-license"], "Production semantics must treat a missing required credential as missing.");

assert.deepEqual(
  missingCurrentCredentialTypes(
    ["medical-license", "facility-permit"],
    [
      { type: "medical-license", validUntil: new Date("2027-01-01T00:00:00.000Z") },
      { type: "facility-permit", validUntil: new Date("2026-01-01T00:00:00.000Z") },
    ],
    now,
  ),
  ["facility-permit"],
);

assert.match(operationalSource, /PROVIDER_OPERATIONAL_ACCESS_DENIED/);
assert.match(operationalSource, /provider\.status !== "ACTIVE"/);
assert.match(operationalSource, /missingCurrentCredentialTypes\(requiredTypes, verified\)/);
assert.match(operationalSource, /process\.env\.NODE_ENV === "test" && provider\.credentials\.length === 0/);
assert.doesNotMatch(operationalSource, /NODE_ENV !== "production" && provider\.credentials\.length === 0/);
assert.match(operationalSource, /PROVIDER_SELF_ONBOARD/);
assert.match(operationalSource, /SELF_SESSION_MANAGE/);
assert.match(governanceSource, /PROVIDER_APPROVAL_DENIED_CREDENTIAL_VALIDITY/);
assert.match(governanceSource, /Missing current verified credential types/);
assert.match(onboardingSource, /credentialGovernance\.assertApprovable\(principal, onboardingId\)/);
assert.match(ciSource, /name: R9 provider current-credential enforcement acceptance/);
assert.match(ciSource, /node services\/api\/scripts\/r9-provider-credential-validity-live-smoke\.mjs/);

console.log("R9 provider current-credential policy-neutral acceptance passed");
