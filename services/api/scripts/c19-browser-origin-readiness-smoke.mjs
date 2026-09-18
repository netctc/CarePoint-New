import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionBrowserOriginsReady,
  browserOrigins,
  validatedBrowserOrigin,
} = require("../dist/infrastructure/http/browser-origin-readiness.js");

function production(overrides = {}) {
  return {
    NODE_ENV: "production",
    ALLOWED_ORIGINS: "https://admin.carepoint.example,https://patient.carepoint.example:8443",
    ...overrides,
  };
}

assert.deepEqual(browserOrigins({ NODE_ENV: "test" }), ["http://localhost:3000"]);
assert.deepEqual(browserOrigins({ NODE_ENV: "test", ALLOWED_ORIGINS: "http://127.0.0.1:3000" }), ["http://127.0.0.1:3000"]);
assert.deepEqual(browserOrigins(production()), [
  "https://admin.carepoint.example",
  "https://patient.carepoint.example:8443",
]);
assert.deepEqual(
  browserOrigins(production({ ALLOWED_ORIGINS: "https://ADMIN.CarePoint.Example/,https://patient.carepoint.example:443" })),
  ["https://admin.carepoint.example", "https://patient.carepoint.example"],
  "C19 must canonicalize browser origins before configuring CORS",
);
assert.doesNotThrow(() => assertProductionBrowserOriginsReady(production()));
assert.doesNotThrow(() => assertProductionBrowserOriginsReady({ NODE_ENV: "test" }));

assert.throws(
  () => browserOrigins({ NODE_ENV: "production" }),
  /ALLOWED_ORIGINS is required in production/,
);
assert.throws(
  () => browserOrigins(production({ ALLOWED_ORIGINS: "https://admin.carepoint.example," })),
  /must not contain empty entries/,
);
assert.throws(
  () => browserOrigins(production({ ALLOWED_ORIGINS: "*" })),
  /must be an explicit browser origin/,
);
assert.throws(
  () => browserOrigins(production({ ALLOWED_ORIGINS: "null" })),
  /must be an explicit browser origin/,
);
assert.throws(
  () => validatedBrowserOrigin("wss://admin.carepoint.example", true),
  /must use http:\/\/ or https:\/\//,
);
assert.throws(
  () => validatedBrowserOrigin("https://user:secret@admin.carepoint.example", true),
  /must not embed credentials/,
);
assert.throws(
  () => validatedBrowserOrigin("https://admin.carepoint.example/app", true),
  /must be an origin only/,
);
assert.throws(
  () => validatedBrowserOrigin("https://admin.carepoint.example?tenant=ksa", true),
  /must be an origin only/,
);
assert.throws(
  () => validatedBrowserOrigin("https://admin.carepoint.example#hidden", true),
  /must be an origin only/,
);
assert.throws(
  () => validatedBrowserOrigin("http://admin.carepoint.example", true),
  /must use HTTPS in production/,
);

for (const origin of [
  "https://localhost",
  "https://portal.localhost:8443",
  "https://127.0.0.1",
  "https://127.99.1.2:8443",
  "https://[::1]",
  "https://0.0.0.0",
  "https://[::]",
]) {
  assert.throws(
    () => validatedBrowserOrigin(origin, true),
    /must not target localhost, loopback, or an unspecified host in production/,
    origin,
  );
}

assert.equal(
  validatedBrowserOrigin("https://10.20.30.40:8443", true),
  "https://10.20.30.40:8443",
  "C19 must not reject a private HTTPS browser origin solely because it uses RFC1918 addressing",
);
assert.throws(
  () => browserOrigins(production({ ALLOWED_ORIGINS: "https://admin.carepoint.example,https://ADMIN.carepoint.example/" })),
  /must not contain duplicate origins/,
);

const tooMany = Array.from({ length: 33 }, (_, index) => `https://app-${index}.carepoint.example`).join(",");
assert.throws(
  () => browserOrigins(production({ ALLOWED_ORIGINS: tooMany })),
  /must contain at most 32 origins/,
);

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const policyCall = mainSource.indexOf("const origins = browserOrigins(process.env);");
const nestCreate = mainSource.indexOf("NestFactory.create");
assert.ok(policyCall >= 0 && policyCall < nestCreate, "C19 browser-origin validation must run before Nest application creation");
assert.match(mainSource, /origin:\s*origins/, "Nest CORS must consume the C19-validated canonical origin list");
assert.doesNotMatch(mainSource, /configuredOrigins\s*=\s*process\.env\.ALLOWED_ORIGINS/, "main.ts must not maintain a second raw ALLOWED_ORIGINS parser");

const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
assert.match(envExample, /^ALLOWED_ORIGINS=/m, "ALLOWED_ORIGINS must remain visible in the deployment example");

const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.ok(packageSource.scripts.test.includes("c19:browser-origin-readiness"));
assert.equal(packageSource.dependencies.cors, undefined, "C19 must use the existing Nest CORS stack without adding a direct CORS dependency");

console.log("Phase C19 browser origin readiness acceptance passed");
