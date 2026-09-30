import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  createLiveKitWebhookRawBodyMiddleware,
  LIVEKIT_WEBHOOK_MAX_BODY_BYTES,
  LIVEKIT_WEBHOOK_PATH,
} = require("../dist/infrastructure/http/livekit-webhook-raw-body.js");

const srcRoot = fileURLToPath(new URL("../src", import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(path));
    else if ([".ts", ".mts", ".cts"].includes(extname(entry.name))) output.push(path);
  }
  return output;
}

const files = await sourceFiles(srcRoot);
assert.ok(files.length > 0, "C18 must scan the API source tree");

const rawBodyUsers = [];
for (const path of files) {
  const source = await readFile(path, "utf8");
  if (/\bRawBodyRequest\b/.test(source) || /\.rawBody\b/.test(source) || /\brawBody\s*:/.test(source)) {
    rawBodyUsers.push(path.slice(srcRoot.length + 1));
  }
}
rawBodyUsers.sort();
const allowedRawBodyUsers = [
  "infrastructure/http/livekit-webhook-raw-body.ts",
  "modules/telehealth/telehealth-provider.service.ts",
  "modules/telehealth/telehealth.module.ts",
  "modules/telehealth/telehealth.service.ts",
].sort();
assert.deepEqual(
  rawBodyUsers,
  allowedRawBodyUsers,
  `C18 permits raw-body handling only inside the explicitly scoped LiveKit webhook path: ${rawBodyUsers.join(", ")}`,
);

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(
  mainSource,
  /NestFactory\.create<NestExpressApplication>\(AppModule, \{ cors: false, bodyParser: false \}\)/,
  "C18 must disable Nest's automatic global body parser so raw-body capture can be route-scoped",
);
assert.doesNotMatch(mainSource, /rawBody\s*:\s*true/, "C18 must not enable global rawBody retention");
assert.match(mainSource, /app\.use\(LIVEKIT_WEBHOOK_PATH, createLiveKitWebhookRawBodyMiddleware\(\)\)/);
assert.match(mainSource, /useBodyParser\("json", \{ limit: bodyLimits\.jsonBytes \}\)/, "C17 JSON body limit must remain active");
assert.match(mainSource, /useBodyParser\("urlencoded", \{ limit: bodyLimits\.formBytes, extended: true \}\)/, "C17 form body limit must remain active");
assert.ok(
  mainSource.indexOf("app.use(LIVEKIT_WEBHOOK_PATH, createLiveKitWebhookRawBodyMiddleware())") < mainSource.indexOf('app.useBodyParser("json"'),
  "LiveKit raw-body capture must be registered before the global JSON parser",
);

assert.equal(LIVEKIT_WEBHOOK_PATH, "/api/v1/telehealth/webhooks/livekit");
assert.equal(LIVEKIT_WEBHOOK_MAX_BODY_BYTES, 262_144);
assert.throws(
  () => createLiveKitWebhookRawBodyMiddleware(4_095),
  /between 4096 and 1048576 bytes/,
);
assert.throws(
  () => createLiveKitWebhookRawBodyMiddleware(1_048_577),
  /between 4096 and 1048576 bytes/,
);

async function exerciseMiddleware(body, maxBytes, declaredLength) {
  const request = new PassThrough();
  request.method = "POST";
  request.headers = declaredLength === undefined ? {} : { "content-length": String(declaredLength) };

  let responseBody = "";
  let contentType = "";
  let resolved = false;
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const response = {
    statusCode: 200,
    setHeader(name, value) {
      if (String(name).toLowerCase() === "content-type") contentType = String(value);
    },
    end(value = "") {
      responseBody += String(value);
      if (!resolved) {
        resolved = true;
        finish({ via: "response" });
      }
    },
  };

  const middleware = createLiveKitWebhookRawBodyMiddleware(maxBytes);
  middleware(request, response, (error) => {
    if (!resolved) {
      resolved = true;
      finish({ via: "next", error });
    }
  });
  request.end(body);
  const result = await completed;
  return { request, response, responseBody, contentType, result };
}

const acceptedPayload = '{"event":"room_finished","room":{"name":"cp_c18"}}';
const accepted = await exerciseMiddleware(acceptedPayload, 4_096);
assert.equal(accepted.result.via, "next");
assert.equal(accepted.result.error, undefined);
assert.equal(accepted.request.rawBody.toString("utf8"), acceptedPayload);
assert.equal(accepted.response.statusCode, 200);

const oversized = await exerciseMiddleware("x".repeat(4_097), 4_096);
assert.equal(oversized.result.via, "response");
assert.equal(oversized.response.statusCode, 413);
assert.match(oversized.contentType, /application\/json/);
assert.match(oversized.responseBody, /exceeds the configured limit/);
assert.equal(oversized.request.rawBody, undefined);

const declaredOversized = await exerciseMiddleware("{}", 4_096, 4_097);
assert.equal(declaredOversized.result.via, "response");
assert.equal(declaredOversized.response.statusCode, 413);
assert.equal(declaredOversized.request.rawBody, undefined);

const telehealthControllerSource = await readFile(new URL("../src/modules/telehealth/telehealth.module.ts", import.meta.url), "utf8");
assert.match(telehealthControllerSource, /@Post\("webhooks\/livekit"\)/);
assert.match(telehealthControllerSource, /LiveKit webhook raw body is required/);

const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.ok(packageSource.scripts.test.includes("c18:raw-body-minimization"));
assert.equal(packageSource.dependencies["raw-body"], undefined, "C18 must not add a raw-body retention dependency");

console.log("Phase C18 global raw body minimization with scoped LiveKit webhook acceptance passed");
