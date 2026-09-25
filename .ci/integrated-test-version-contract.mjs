import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = read(".github/workflows/integrated-test-version.yml");
const dockerfile = read("Dockerfile");
const pilot = read("services/api/src/infrastructure/release/private-pilot-infrastructure-profile.ts");
const adminPolicy = read("apps/admin/lib/admin-backend-policy.js");

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/);
assert.match(workflow, /CAREPOINT_TEST_SOURCE_SHA/);
assert.match(workflow, /git rev-parse HEAD/);
assert.match(workflow, /target: api/);
assert.match(workflow, /target: admin/);
assert.match(workflow, /patient-mobile:patient/);
assert.match(workflow, /doctor-mobile:doctor/);
assert.match(workflow, /provider-mobile:provider/);
assert.match(workflow, /flutter build web --release/);
assert.match(workflow, /CAREPOINT_API_BASE=/);
assert.match(workflow, /CAREPOINT_RELEASE_SHA=/);
assert.match(workflow, /Integrated test API must use HTTPS/);
assert.match(workflow, /API_DIGEST/);
assert.match(workflow, /ADMIN_DIGEST/);
assert.match(workflow, /immutableImage/);
assert.match(workflow, /isolated-synthetic/);
assert.match(workflow, /syntheticDataOnly: true/);
assert.match(workflow, /productionReleaseEvidence: false/);
assert.match(workflow, /noEnvFiles: true/);
assert.match(workflow, /noEmbeddedSecrets: true/);
assert.match(workflow, /web-files\.sha256/);
assert.doesNotMatch(workflow, /:latest\b/);
assert.doesNotMatch(workflow, /\.env(?:\.|["'\s])/);

assert.match(dockerfile, /AS api/);
assert.match(dockerfile, /AS admin/);
assert.match(dockerfile, /org\.opencontainers\.image\.revision/);
assert.match(pilot, /ISOLATED_SYNTHETIC_PILOT_PROFILE = "isolated-synthetic"/);
assert.match(pilot, /synthetic-only/);
assert.match(pilot, /DOCUMENT_SCAN_PROVIDER/);
assert.match(adminPolicy, /CAREPOINT_API_URL is required in production/);
assert.match(adminPolicy, /must target the \/api\/v1 base path/);

console.log("Integrated test-version bundle contract passed");

function read(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}
