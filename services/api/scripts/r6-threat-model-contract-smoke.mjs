import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const threatModel = await readFile(path.join(repoRoot, "docs/release-1-r6-threat-model.md"), "utf8");
const adversarialPlan = await readFile(path.join(repoRoot, "docs/release-1-r6-adversarial-security-acceptance.md"), "utf8");
const ciWorkflow = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");

for (const boundary of ["TB-01", "TB-02", "TB-03", "TB-04", "TB-05", "TB-06", "TB-07", "TB-08", "TB-09", "TB-10"]) {
  assert.ok(threatModel.includes(boundary), `R6 threat model is missing trust boundary ${boundary}.`);
}

for (const threat of [
  "TM-AUTH-01",
  "TM-AUTH-02",
  "TM-AUTH-03",
  "TM-AUTHZ-01",
  "TM-AUTHZ-02",
  "TM-AUTHZ-03",
  "TM-CONSENT-01",
  "TM-DATA-01",
  "TM-DATA-02",
  "TM-FILE-01",
  "TM-DICOM-01",
  "TM-FIN-01",
  "TM-CLAIM-01",
  "TM-TELE-01",
  "TM-NOTIF-01",
  "TM-AVAIL-01",
  "TM-OBS-01",
  "TM-SUPPLY-01",
  "TM-SUPPLY-03",
  "TM-KEY-01",
  "TM-EMERG-01",
]) {
  assert.ok(threatModel.includes(threat), `R6 threat model is missing required threat family ${threat}.`);
}

for (const dependency of ["#77", "#79", "#80", "#81", "#84", "#85", "#89", "#90"]) {
  assert.ok(threatModel.includes(dependency) || adversarialPlan.includes(dependency), `R6 security evidence is missing dependency ${dependency}.`);
}

assert.match(threatModel, /production-equivalent penetration/i);
assert.match(threatModel, /not a legal, privacy, regulatory, clinical-safety or penetration-test certification/i);
assert.match(adversarialPlan, /CI evidence is necessary but is not treated as a penetration-test result/i);
assert.match(adversarialPlan, /two distinct patients/i);
assert.match(adversarialPlan, /two distinct providers/i);
assert.match(adversarialPlan, /wrong-version/i);
assert.match(adversarialPlan, /revocation removes that consent basis/i);
assert.match(adversarialPlan, /PHI marker/i);
assert.match(adversarialPlan, /Critical\/High/i);

assert.match(ciWorkflow, /name: R6 adversarial authorization and PHI-leakage acceptance/);
assert.match(ciWorkflow, /node services\/api\/scripts\/r6-adversarial-authorization-smoke\.mjs/);

for (const retainedGate of [
  "R6 privileged MFA production-policy acceptance",
  "Phase B7 Admin security and audit acceptance",
  "Slice 3 secure telemedicine smoke test",
  "Slice 3.1 encrypted clinical record smoke test",
  "Slice 5 encrypted clinical documents smoke test",
  "Slice 6 payments insurance and financial operations smoke test",
  "Slice 6.2 claims EOB and revenue cycle smoke test",
  "Slice 7 secure messaging notifications and care coordination smoke test",
  "Slice 8 medical transport and emergency dispatch smoke test",
  "Slice 9 production security resilience and observability smoke test",
]) {
  assert.ok(ciWorkflow.includes(retainedGate), `R6 threat-model coverage lost CI gate '${retainedGate}'.`);
}

console.log("R6 Release 1 threat-model contract acceptance passed");
