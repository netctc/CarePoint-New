import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

const files = {
  prisma: path.join(repoRoot, "services/api/prisma/v2_observation.prisma"),
  migration: path.join(
    repoRoot,
    "services/api/prisma/migrations/20260919040000_v2_observation_service/migration.sql",
  ),
  service: path.join(repoRoot, "services/api/src/modules/observation/observation.service.ts"),
  trend: path.join(repoRoot, "services/api/src/modules/observation/observation-trend.service.ts"),
};

const [prisma, migration, service, trend] = await Promise.all(
  Object.values(files).map((file) => readFile(file, "utf8")),
);

function assertMatch(source, pattern, message) {
  if (!pattern.test(source)) {
    throw new Error(`BE-043 observation performance contract failed: ${message}`);
  }
}

// The primary observation history/trend path filters by patient + metric and reads newest first.
// Keep the schema declaration and the deployed SQL index aligned with that exact access path.
assertMatch(
  prisma,
  /@@index\(\[patientId,\s*observationTypeId,\s*observedAt\]\)/,
  "Prisma must retain the composite Observation(patientId, observationTypeId, observedAt) index.",
);

assertMatch(
  migration,
  /CREATE INDEX\s+"Observation_patientId_observationTypeId_observedAt_idx"\s+ON\s+"Observation"\("patientId",\s*"observationTypeId",\s*"observedAt"\);/,
  "the physical PostgreSQL migration must create the observation history composite index.",
);

assertMatch(
  service,
  /this\.prisma\.observation\.findMany\(\{[\s\S]*?where:\s*\{[\s\S]*?patientId,[\s\S]*?observationTypeId:\s*type\.id,[\s\S]*?observedAt:\s*range[\s\S]*?orderBy:\s*\{\s*observedAt:\s*"desc"\s*\}[\s\S]*?take,/,
  "history must remain a bounded patient + metric + observedAt range query ordered by observedAt DESC.",
);

assertMatch(
  service,
  /const\s+MAX_HISTORY\s*=\s*500\s*;/,
  "history reads must remain bounded by MAX_HISTORY=500 unless a reviewed performance change updates this contract.",
);

assertMatch(
  trend,
  /historyForDoctor\(principal,\s*patientId,\s*code,\s*from,\s*to,\s*500\)/,
  "trend reads must reuse the indexed bounded history path instead of introducing an unbounded scan.",
);

if (/rows\.sort\(|items\.sort\(/.test(service)) {
  throw new Error(
    "BE-043 observation performance contract failed: observation history must preserve database ordering instead of sorting the hot path in application memory.",
  );
}

console.log("BE-043 observation performance contract: PASS");
console.log("- composite patient/metric/time index declared in Prisma: PASS");
console.log("- physical PostgreSQL migration index present: PASS");
console.log("- bounded range query uses observedAt DESC ordering: PASS");
console.log("- trend path reuses bounded indexed history: PASS");
