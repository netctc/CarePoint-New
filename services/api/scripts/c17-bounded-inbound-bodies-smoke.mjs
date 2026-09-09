import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionInboundBodyLimitsReady,
  inboundBodyLimits,
} = require("../dist/infrastructure/http/inbound-body-limits.js");

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    JSON_BODY_LIMIT_BYTES: "12582912",
    FORM_BODY_LIMIT_BYTES: "131072",
    ...overrides,
  };
}

assert.deepEqual(inboundBodyLimits({ NODE_ENV: "test" }), {
  jsonBytes: 1_048_576,
  formBytes: 131_072,
});
assert.deepEqual(inboundBodyLimits(productionEnv()), {
  jsonBytes: 12_582_912,
  formBytes: 131_072,
});
assert.doesNotThrow(() => assertProductionInboundBodyLimitsReady(productionEnv()));

assert.throws(
  () => assertProductionInboundBodyLimitsReady(productionEnv({ JSON_BODY_LIMIT_BYTES: "" })),
  /JSON_BODY_LIMIT_BYTES is required in production/,
);
assert.throws(
  () => assertProductionInboundBodyLimitsReady(productionEnv({ FORM_BODY_LIMIT_BYTES: "" })),
  /FORM_BODY_LIMIT_BYTES is required in production/,
);

for (const value of ["Infinity", "NaN", "1e6", "4096.5", "+4096", "-4096", "4kb", " 4 096 "]) {
  assert.throws(
    () => inboundBodyLimits(productionEnv({ JSON_BODY_LIMIT_BYTES: value })),
    /JSON_BODY_LIMIT_BYTES must be an integer byte count/,
    `JSON_BODY_LIMIT_BYTES=${value} must be rejected`,
  );
}
for (const value of ["Infinity", "NaN", "1e5", "4096.5", "+4096", "-4096", "4kb"]) {
  assert.throws(
    () => inboundBodyLimits(productionEnv({ FORM_BODY_LIMIT_BYTES: value })),
    /FORM_BODY_LIMIT_BYTES must be an integer byte count/,
    `FORM_BODY_LIMIT_BYTES=${value} must be rejected`,
  );
}

assert.throws(
  () => inboundBodyLimits(productionEnv({ JSON_BODY_LIMIT_BYTES: "4095" })),
  /JSON_BODY_LIMIT_BYTES must be between 4096 and 16777216 bytes/,
);
assert.throws(
  () => inboundBodyLimits(productionEnv({ JSON_BODY_LIMIT_BYTES: "16777217" })),
  /JSON_BODY_LIMIT_BYTES must be between 4096 and 16777216 bytes/,
);
assert.throws(
  () => inboundBodyLimits(productionEnv({ FORM_BODY_LIMIT_BYTES: "4095" })),
  /FORM_BODY_LIMIT_BYTES must be between 4096 and 1048576 bytes/,
);
assert.throws(
  () => inboundBodyLimits(productionEnv({ FORM_BODY_LIMIT_BYTES: "1048577" })),
  /FORM_BODY_LIMIT_BYTES must be between 4096 and 1048576 bytes/,
);
assert.equal(inboundBodyLimits(productionEnv({ JSON_BODY_LIMIT_BYTES: "16777216" })).jsonBytes, 16_777_216);
assert.equal(inboundBodyLimits(productionEnv({ FORM_BODY_LIMIT_BYTES: "1048576" })).formBytes, 1_048_576);

const maxClinicalFileBytes = 8 * 1024 * 1024;
const maximumBase64Chars = Math.ceil(maxClinicalFileBytes / 3) * 4;
assert.equal(maximumBase64Chars, 11_184_812);
assert.ok(
  maximumBase64Chars < 12_582_912,
  "the documented 12 MiB production JSON example must accommodate an 8 MiB file Base64 payload plus JSON metadata headroom",
);
assert.ok(
  maximumBase64Chars < 16_777_216,
  "the C17 hard maximum must accommodate the existing 8 MiB clinical document contract",
);

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.ok(
  mainSource.indexOf("assertProductionInboundBodyLimitsReady();") < mainSource.indexOf("NestFactory.create"),
  "C17 inbound body limit preflight must execute before Nest application creation",
);
assert.ok(
  mainSource.indexOf("const bodyLimits = inboundBodyLimits();") < mainSource.indexOf("NestFactory.create"),
  "C17 must resolve body limits before Nest application creation",
);
assert.match(mainSource, /useBodyParser\("json", \{ limit: bodyLimits\.jsonBytes \}\)/);
assert.match(mainSource, /useBodyParser\("urlencoded", \{ limit: bodyLimits\.formBytes, extended: true \}\)/);
assert.doesNotMatch(mainSource, /Number\(process\.env\.JSON_BODY_LIMIT_BYTES/);
assert.doesNotMatch(mainSource, /Number\(process\.env\.FORM_BODY_LIMIT_BYTES/);
assert.match(mainSource, /rawBody:\s*true/, "C17 preserves rawBody compatibility while bounding accepted bodies");

const documentSource = await readFile(new URL("../src/modules/documents/documents.service.ts", import.meta.url), "utf8");
assert.match(documentSource, /const MAX_FILE_BYTES = 8 \* 1024 \* 1024;/, "C17 sizing must remain compatible with the existing clinical document limit");

const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.ok(packageSource.scripts.test.includes("c17:bounded-inbound-bodies"));
assert.equal(packageSource.dependencies.bytes, undefined, "C17 must not add a body-size parsing dependency");

console.log("Phase C17 bounded inbound request bodies acceptance passed");
