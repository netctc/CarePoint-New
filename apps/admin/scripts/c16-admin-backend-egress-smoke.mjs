import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  adminApiBaseUrl,
  adminApiMaxResponseBytes,
  adminApiTimeoutMs,
  adminBackendFetch,
  adminBackendUrl,
  readBoundedAdminBackendText,
} from "../lib/admin-backend-policy.js";
import {
  adminPublicOrigin,
  isTrustedAdminPublicOriginRequest,
} from "../lib/admin-origin-policy.js";

const productionExternal = {
  NODE_ENV: "production",
  CAREPOINT_API_URL: "https://api.carepoint.example/api/v1",
  CAREPOINT_API_TIMEOUT_MS: "5000",
  CAREPOINT_API_MAX_RESPONSE_BYTES: "4096",
};

const productionPublicOrigin = {
  NODE_ENV: "production",
  CAREPOINT_ADMIN_PUBLIC_ORIGIN: "https://admin.carepoint.example",
};

function originRequest(origin, nextUrlOrigin = "http://172.17.0.1:3050") {
  return {
    headers: {
      get(name) {
        return name.toLowerCase() === "origin" ? origin : null;
      },
    },
    nextUrl: { origin: nextUrlOrigin },
  };
}

assert.equal(adminPublicOrigin(productionPublicOrigin), "https://admin.carepoint.example");
assert.equal(
  adminPublicOrigin({
    NODE_ENV: "production",
    CAREPOINT_ADMIN_PUBLIC_ORIGIN: "https://ADMIN.CAREPOINT.EXAMPLE:443/",
  }),
  "https://admin.carepoint.example",
  "public origin must be normalized before comparison",
);
assert.throws(
  () => adminPublicOrigin({ NODE_ENV: "production", CAREPOINT_ADMIN_PUBLIC_ORIGIN: "http://admin.carepoint.example" }),
  /must use HTTPS in production/,
);
assert.throws(
  () => adminPublicOrigin({ NODE_ENV: "production", CAREPOINT_ADMIN_PUBLIC_ORIGIN: "https://user:secret@admin.carepoint.example" }),
  /must not embed credentials/,
);
assert.throws(
  () => adminPublicOrigin({ NODE_ENV: "production", CAREPOINT_ADMIN_PUBLIC_ORIGIN: "https://admin.carepoint.example/path" }),
  /must contain only an origin/,
);
assert.throws(
  () => adminPublicOrigin({ NODE_ENV: "production", CAREPOINT_ADMIN_PUBLIC_ORIGIN: "https://admin.carepoint.example?tenant=ksa" }),
  /must not contain a query string/,
);
assert.throws(
  () => adminPublicOrigin({ NODE_ENV: "production", CAREPOINT_ADMIN_PUBLIC_ORIGIN: "https://admin.carepoint.example#fragment" }),
  /must not contain a URL fragment/,
);
assert.throws(
  () => adminPublicOrigin({ NODE_ENV: "production", CAREPOINT_ADMIN_PUBLIC_ORIGIN: "not-a-url" }),
  /must be a valid absolute URL/,
);
assert.equal(
  isTrustedAdminPublicOriginRequest(originRequest(null), { NODE_ENV: "production" }),
  true,
  "requests without Origin must preserve existing server-side compatibility",
);
assert.equal(
  isTrustedAdminPublicOriginRequest(originRequest("https://admin.carepoint.example"), productionPublicOrigin),
  true,
  "configured production browser origin must be accepted behind TLS termination",
);
assert.equal(
  isTrustedAdminPublicOriginRequest(originRequest("https://evil.example"), productionPublicOrigin),
  false,
  "unconfigured browser origins must be rejected",
);
assert.equal(
  isTrustedAdminPublicOriginRequest(originRequest("http://172.17.0.1:3050"), productionPublicOrigin),
  false,
  "internal reverse-proxy origin must not replace the configured public origin",
);
assert.equal(
  isTrustedAdminPublicOriginRequest(originRequest("https://admin.carepoint.example"), { NODE_ENV: "production" }),
  false,
  "production explicit-Origin requests must fail closed without public-origin configuration",
);
assert.equal(
  isTrustedAdminPublicOriginRequest(
    originRequest("https://admin.carepoint.example"),
    { NODE_ENV: "production", CAREPOINT_ADMIN_PUBLIC_ORIGIN: "http://admin.carepoint.example" },
  ),
  false,
  "invalid production public-origin configuration must fail closed",
);
assert.equal(
  isTrustedAdminPublicOriginRequest(originRequest("null"), productionPublicOrigin),
  false,
  "opaque/null browser origins must be rejected",
);
assert.equal(
  isTrustedAdminPublicOriginRequest(
    originRequest("http://172.17.0.1:3050"),
    { NODE_ENV: "development" },
  ),
  true,
  "development without explicit configuration may preserve request.nextUrl.origin fallback",
);
assert.equal(
  isTrustedAdminPublicOriginRequest(
    originRequest("http://127.0.0.1:3050"),
    { NODE_ENV: "development" },
  ),
  false,
  "development fallback must still require exact normalized origin equality",
);

assert.equal(adminApiBaseUrl({ NODE_ENV: "test" }), "http://127.0.0.1:4000/api/v1");
assert.equal(adminApiBaseUrl(productionExternal), "https://api.carepoint.example/api/v1");
assert.equal(
  adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "http://127.0.0.1:4000/api/v1" }),
  "http://127.0.0.1:4000/api/v1",
  "same-host numeric loopback must remain a supported production topology",
);
assert.equal(
  adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "http://[::1]:4000/api/v1" }),
  "http://[::1]:4000/api/v1",
);

assert.throws(() => adminApiBaseUrl({ NODE_ENV: "production" }), /CAREPOINT_API_URL is required in production/);
assert.throws(
  () => adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "ftp://api.carepoint.example/api/v1" }),
  /must use http:\/\/ or https:\/\//,
);
assert.throws(
  () => adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "https://user:secret@api.carepoint.example/api/v1" }),
  /must not embed credentials/,
);
assert.throws(
  () => adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "https://api.carepoint.example/api/v1?tenant=ksa" }),
  /must not contain a query string/,
);
assert.throws(
  () => adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "https://api.carepoint.example/api/v1#hidden" }),
  /must not contain a URL fragment/,
);
assert.throws(
  () => adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "https://api.carepoint.example/root" }),
  /must target the \/api\/v1 base path/,
);
assert.throws(
  () => adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "http://api.carepoint.example/api/v1" }),
  /must use HTTPS unless it targets numeric loopback/,
);
assert.throws(
  () => adminApiBaseUrl({ NODE_ENV: "production", CAREPOINT_API_URL: "http://localhost:4000/api/v1" }),
  /must use HTTPS unless it targets numeric loopback/,
);

assert.equal(adminApiTimeoutMs({ NODE_ENV: "test" }), 10_000);
assert.equal(adminApiTimeoutMs({ CAREPOINT_API_TIMEOUT_MS: "100" }), 100);
assert.throws(() => adminApiTimeoutMs({ CAREPOINT_API_TIMEOUT_MS: "99" }), /between 100 and 30000/);
assert.throws(() => adminApiTimeoutMs({ CAREPOINT_API_TIMEOUT_MS: "30001" }), /between 100 and 30000/);
assert.throws(() => adminApiTimeoutMs({ CAREPOINT_API_TIMEOUT_MS: "1.5" }), /must be an integer/);

assert.equal(adminApiMaxResponseBytes({ NODE_ENV: "test" }), 4 * 1024 * 1024);
assert.equal(adminApiMaxResponseBytes({ CAREPOINT_API_MAX_RESPONSE_BYTES: "1024" }), 1024);
assert.throws(() => adminApiMaxResponseBytes({ CAREPOINT_API_MAX_RESPONSE_BYTES: "1023" }), /between 1024 and 16777216/);
assert.throws(() => adminApiMaxResponseBytes({ CAREPOINT_API_MAX_RESPONSE_BYTES: "16777217" }), /between 1024 and 16777216/);

assert.equal(
  adminBackendUrl("/iam/accounts/me?expand=roles", productionExternal),
  "https://api.carepoint.example/api/v1/iam/accounts/me?expand=roles",
);
assert.throws(() => adminBackendUrl("iam/login", productionExternal), /safe absolute API-relative path/);
assert.throws(() => adminBackendUrl("//evil.example/path", productionExternal), /safe absolute API-relative path/);
assert.throws(() => adminBackendUrl("/../iam/login", productionExternal), /dot segments/);
assert.throws(() => adminBackendUrl("/%2e%2e/iam/login", productionExternal), /dot segments/);
assert.throws(() => adminBackendUrl("/iam/login#fragment", productionExternal), /safe absolute API-relative path/);

const fetchCalls = [];
const fetched = await adminBackendFetch(
  "/iam/accounts/me",
  { method: "GET", cache: "force-cache", redirect: "follow" },
  productionExternal,
  async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  },
);
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].url, "https://api.carepoint.example/api/v1/iam/accounts/me");
assert.equal(fetchCalls[0].init.cache, "no-store");
assert.equal(fetchCalls[0].init.redirect, "error", "Admin backend redirects must always fail closed");
assert.ok(fetchCalls[0].init.signal instanceof AbortSignal, "Admin backend fetch must always carry a timeout signal");
assert.equal(fetchCalls[0].init.signal.aborted, false);
assert.equal(await readBoundedAdminBackendText(fetched, productionExternal), '{"ok":true}');

let declaredCancelled = false;
const declaredOversize = new Response(
  new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16));
    },
    cancel() {
      declaredCancelled = true;
    },
  }),
  { headers: { "content-length": "2048" } },
);
await assert.rejects(
  () => readBoundedAdminBackendText(declaredOversize, { CAREPOINT_API_MAX_RESPONSE_BYTES: "1024" }),
  /exceeds 1024 bytes/,
);
assert.equal(declaredCancelled, true, "declared oversize response bodies must be cancelled before reading");

let chunkIndex = 0;
let chunkedCancelled = false;
const chunkedOversize = new Response(new ReadableStream({
  pull(controller) {
    if (chunkIndex < 2) {
      controller.enqueue(new Uint8Array(700));
      chunkIndex += 1;
      return;
    }
    controller.close();
  },
  cancel() {
    chunkedCancelled = true;
  },
}));
await assert.rejects(
  () => readBoundedAdminBackendText(chunkedOversize, { CAREPOINT_API_MAX_RESPONSE_BYTES: "1024" }),
  /exceeds 1024 bytes/,
);
assert.equal(chunkedCancelled, true, "chunked oversize response bodies must be cancelled as soon as the cap is crossed");

const invalidLength = new Response("{}", { headers: { "content-length": "not-a-number" } });
await assert.rejects(
  () => readBoundedAdminBackendText(invalidLength, productionExternal),
  /Content-Length is invalid/,
);

const authSource = await readFile(new URL("../lib/admin-auth.ts", import.meta.url), "utf8");
assert.match(authSource, /adminBackendFetch/, "admin authentication must use the C16 egress helper");
assert.match(authSource, /readBoundedAdminBackendText/, "admin authentication must bound backend responses");
assert.match(authSource, /isTrustedAdminPublicOriginRequest/, "admin authentication must use the explicit public-origin policy");
assert.doesNotMatch(authSource, /await\s+fetch\s*\(/, "admin authentication must not bypass the C16 fetch helper");
assert.doesNotMatch(authSource, /origin\s*===\s*request\.nextUrl\.origin/, "admin auth must not compare browser Origin directly with the internal standalone origin");

const clinicalAuthSource = await readFile(new URL("../lib/clinical-auth.ts", import.meta.url), "utf8");
assert.match(clinicalAuthSource, /isTrustedAdminPublicOriginRequest/, "clinical authentication must share the explicit Admin public-origin policy");
assert.doesNotMatch(clinicalAuthSource, /origin\s*===\s*request\.nextUrl\.origin/, "clinical auth must not compare browser Origin directly with the internal standalone origin");

const originPolicySource = await readFile(new URL("../lib/admin-origin-policy.js", import.meta.url), "utf8");
assert.match(originPolicySource, /CAREPOINT_ADMIN_PUBLIC_ORIGIN/, "origin policy must use an explicit deployment contract");
assert.match(originPolicySource, /NODE_ENV\s*===\s*"production"/, "origin policy must fail closed in production");
assert.doesNotMatch(originPolicySource, /x-forwarded/i, "origin policy must not trust arbitrary forwarded headers");

const apiSource = await readFile(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
assert.match(apiSource, /adminBackendFetch/, "admin proxy must use the C16 egress helper");
assert.match(apiSource, /readBoundedAdminBackendText/, "admin proxy must bound backend responses");
assert.doesNotMatch(apiSource, /await\s+fetch\s*\(/, "admin proxy must not bypass the C16 fetch helper");

const policySource = await readFile(new URL("../lib/admin-backend-policy.js", import.meta.url), "utf8");
assert.match(policySource, /redirect:\s*"error"/, "C16 must reject redirects centrally");
assert.match(policySource, /AbortSignal\.timeout/, "C16 must centrally bound backend latency");
assert.match(policySource, /getReader\(\)/, "C16 must stream-read backend responses under a byte cap");

const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageSource.scripts.test, "npm run c16:admin-backend-egress");
assert.equal(packageSource.dependencies.undici, undefined, "C16 must not add a new HTTP dependency");

console.log("Phase C16 Admin backend egress + public-origin resilience acceptance passed");
