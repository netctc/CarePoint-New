import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(
  new URL("../src/modules/clinical-profile/problem-list.service.ts", import.meta.url),
  "utf8",
);
const controller = readFileSync(
  new URL("../src/modules/clinical-profile/problem-list.controller.ts", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/modules/clinical-profile/clinical-profile.module.ts", import.meta.url),
  "utf8",
);

assert.match(service, /listForDoctor\(principal, patientId, "CONDITION"\)/);
assert.match(service, /clinicalProfileEntryRevision\.findMany/);
assert.match(service, /clinicalRecord\.findFirst/);
assert.match(service, /clinicalDocument\.findMany/);
assert.match(service, /carePlan\.findMany/);
assert.match(service, /data\.clinicalStatus = normalized/);
assert.match(service, /groups:\s*\{ active, resolved, inactive \}/);
assert.match(service, /PROBLEM_LIST_READ/);
assert.doesNotMatch(service, /clinicalProfileEntry\.delete/);
assert.doesNotMatch(service, /clinicalProfileEntryRevision\.update/);

assert.match(controller, /@Controller\("doctor\/patients"\)/);
assert.match(controller, /@Get\(":patientId\/clinical-profile\/conditions"\)/);
assert.match(controller, /@Post\(":patientId\/clinical-profile\/conditions"\)/);
assert.match(controller, /@Patch\(":patientId\/clinical-profile\/conditions\/:entryId"\)/);
assert.doesNotMatch(controller, /@Delete/);
assert.match(moduleSource, /DoctorProblemListController/);
assert.match(moduleSource, /ProblemListService/);

console.log("V2 structured problem list validation passed");
