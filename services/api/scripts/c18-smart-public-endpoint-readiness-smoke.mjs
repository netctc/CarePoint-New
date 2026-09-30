import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionSmartPublicEndpointsReady,
  productionSmartPublicEndpoints,
  validatedSmartPublicBaseUrl,
} = require("../dist/security/production-smart-public-endpoints-preflight.js");
const { SmartConfigurationService } = require("../dist/security/smart-configuration.service.js");

const originalEnv = { ...process.env };

function replaceProcessEnv(env) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

function production(overrides = {}) {
  return {
    NODE_ENV: "production",
    SMART_ISSUER_URL: "https://identity.carepoint.example/api/v1",
    SMART_FHIR_BASE_URL: "https://fhir.carepoint.example/api/v1/fhir/R4",
    ...overrides,
  };
}

try {
  assert.doesNotThrow(() => assertProductionSmartPublicEndpointsReady({ NODE_ENV: "test" }));
  assert.doesNotThrow(() => assertProductionSmartPublicEndpointsReady(production()));
  assert.deepEqual(productionSmartPublicEndpoints(production()), {
    issuerUrl: "https://identity.carepoint.example/api/v1",
    fhirBaseUrl: "https://fhir.carepoint.example/api/v1/fhir/R4",
  });
  assert.equal(
    validatedSmartPublicBaseUrl("https://identity.carepoint.example/api/v1/", "SMART_ISSUER_URL", true),
    "https://identity.carepoint.example/api/v1",
  );

  assert.throws(
    () => assertProductionSmartPublicEndpointsReady({ NODE_ENV: "production" }),
    /SMART_ISSUER_URL and SMART_FHIR_BASE_URL are required in production/,
  );
  assert.throws(
    () => assertProductionSmartPublicEndpointsReady(production({ SMART_FHIR_BASE_URL: "" })),
    /SMART_ISSUER_URL and SMART_FHIR_BASE_URL are required in production/,
  );
  assert.throws(
    () => validatedSmartPublicBaseUrl("http://identity.carepoint.example/api/v1", "SMART_ISSUER_URL", true),
    /must use HTTPS in production/,
  );
  assert.throws(
    () => validatedSmartPublicBaseUrl("ftp://identity.carepoint.example/api/v1", "SMART_ISSUER_URL", true),
    /must use HTTP or HTTPS/,
  );
  assert.throws(
    () => validatedSmartPublicBaseUrl("https://user:secret@identity.carepoint.example/api/v1", "SMART_ISSUER_URL", true),
    /clean base URL without query, fragment, or credentials/,
  );
  assert.throws(
    () => validatedSmartPublicBaseUrl("https://identity.carepoint.example/api/v1?tenant=ksa", "SMART_ISSUER_URL", true),
    /clean base URL without query, fragment, or credentials/,
  );
  assert.throws(
    () => validatedSmartPublicBaseUrl("https://identity.carepoint.example/api/v1#hidden", "SMART_ISSUER_URL", true),
    /clean base URL without query, fragment, or credentials/,
  );

  for (const endpoint of [
    "https://localhost/api/v1",
    "https://internal.localhost/api/v1",
    "https://127.0.0.1/api/v1",
    "https://127.12.34.56/api/v1",
    "https://[::1]/api/v1",
    "https://0.0.0.0/api/v1",
    "https://[::]/api/v1",
  ]) {
    assert.throws(
      () => validatedSmartPublicBaseUrl(endpoint, "SMART_ISSUER_URL", true),
      /must not target localhost, loopback, or an unspecified host in production/,
      endpoint,
    );
    assert.throws(
      () => validatedSmartPublicBaseUrl(endpoint.replace("/api/v1", "/api/v1/fhir/R4"), "SMART_FHIR_BASE_URL", true),
      /must not target localhost, loopback, or an unspecified host in production/,
      endpoint,
    );
  }

  assert.equal(
    validatedSmartPublicBaseUrl("https://10.20.30.40/api/v1", "SMART_ISSUER_URL", true),
    "https://10.20.30.40/api/v1",
    "C18 must not forbid enterprise-private SMART endpoints solely because they use RFC1918 addressing",
  );

  const publicClients = [{
    clientId: "c18-native-app",
    name: "C18 native SMART client",
    redirectUris: ["http://127.0.0.1:8787/callback", "https://app.carepoint.example/smart/callback"],
    allowedScopes: ["launch/patient", "openid", "patient/Patient.r"],
  }];
  replaceProcessEnv(production({ SMART_PUBLIC_CLIENTS_JSON: JSON.stringify(publicClients) }));
  const config = new SmartConfigurationService();
  config.onModuleInit();
  const discovery = config.discovery();
  assert.equal(discovery.issuer, "https://identity.carepoint.example/api/v1");
  assert.equal(discovery.authorization_endpoint, "https://identity.carepoint.example/api/v1/smart/browser/authorize");
  assert.equal(discovery.token_endpoint, "https://identity.carepoint.example/api/v1/smart/token");
  assert.equal(config.fhirBaseUrl(), "https://fhir.carepoint.example/api/v1/fhir/R4");
  assert.deepEqual(config.client("c18-native-app")?.redirectUris, [
    "http://127.0.0.1:8787/callback",
    "https://app.carepoint.example/smart/callback",
  ], "C18 must preserve SMART native-app HTTP loopback redirect URIs");

  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(
    mainSource.indexOf("assertProductionSmartPublicEndpointsReady();") < mainSource.indexOf("NestFactory.create"),
    "C18 SMART public endpoint readiness must execute before Nest application creation",
  );

  const smartSource = await readFile(new URL("../src/security/smart-configuration.service.ts", import.meta.url), "utf8");
  assert.match(smartSource, /SMART_ISSUER_URL and SMART_FHIR_BASE_URL are required in production/);
  assert.match(smartSource, /must use HTTPS in production/);
  assert.match(smartSource, /HTTP loopback host/, "existing SMART native-app redirect policy must remain intact");

  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envExample, /^SMART_ISSUER_URL=/m, "C18 must document the production SMART issuer variable");
  assert.match(envExample, /^SMART_FHIR_BASE_URL=/m, "C18 must document the production SMART FHIR base variable");

  const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageSource.scripts.test.includes("c18:smart-public-endpoint-readiness"));
  assert.equal(packageSource.dependencies.undici, undefined, "C18 must not add a new HTTP dependency");

  console.log("Phase C18 SMART public endpoint readiness acceptance passed");
} finally {
  replaceProcessEnv(originalEnv);
}
