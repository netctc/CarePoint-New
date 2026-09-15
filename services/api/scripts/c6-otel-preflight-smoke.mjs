import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildMetricsPayload,
  buildTracePayload,
  generateSpanId,
  generateTraceId,
  otlpHttpConfiguration,
  parseRemoteTraceParent,
  shouldSampleTrace,
} = require("../dist/infrastructure/observability/otlp-http-exporter.js");
const { assertProductionOtlpReady } = require("../dist/infrastructure/observability/production-otel-preflight.js");

function configureProduction() {
  process.env.NODE_ENV = "production";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.internal.example:4318/root";
  delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/json";
  delete process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL;
  delete process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=Bearer%20carepoint-test-token,x-tenant=ksa";
  delete process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS;
  delete process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS;
  process.env.OTEL_EXPORTER_OTLP_TIMEOUT = "5000";
  process.env.OTEL_SERVICE_NAME = "carepoint-api";
  process.env.OTEL_SERVICE_NAMESPACE = "carepoint";
  process.env.OTEL_SERVICE_VERSION = "c6-test";
  process.env.OTEL_DEPLOYMENT_ENVIRONMENT = "production";
  process.env.AWS_REGION = "me-central-1";
  process.env.CAREPOINT_OTEL_EXPORT_MODE = "required";
  process.env.CAREPOINT_OTEL_MAX_QUEUE = "256";
  process.env.OTEL_METRIC_EXPORT_INTERVAL = "5000";
  process.env.OTEL_TRACES_SAMPLER = "parentbased_always_on";
  delete process.env.OTEL_TRACES_SAMPLER_ARG;
  delete process.env.OTEL_SDK_DISABLED;
}

async function expectConfigReject(pattern, mutate) {
  configureProduction();
  mutate();
  assert.throws(() => otlpHttpConfiguration(process.env), pattern);
}

process.env.NODE_ENV = "test";
delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
let bypassCalls = 0;
await assertProductionOtlpReady({ send: async () => { bypassCalls += 1; } });
assert.equal(bypassCalls, 0, "non-production OTLP preflight must not export");

configureProduction();
const config = otlpHttpConfiguration(process.env);
assert.equal(config.enabled, true);
assert.equal(config.exportMode, "required");
assert.equal(config.tracesEndpoint, "https://otel.internal.example:4318/root/v1/traces");
assert.equal(config.metricsEndpoint, "https://otel.internal.example:4318/root/v1/metrics");
assert.equal(config.tracesHeaders.authorization, "Bearer carepoint-test-token");
assert.equal(config.metricsHeaders["x-tenant"], "ksa");
assert.equal(config.serviceName, "carepoint-api");
assert.equal(config.cloudRegion, "me-central-1");

configureProduction();
process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://traces.internal.example/custom-traces";
process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "https://metrics.internal.example/custom-metrics";
const signalConfig = otlpHttpConfiguration(process.env);
assert.equal(signalConfig.tracesEndpoint, "https://traces.internal.example/custom-traces");
assert.equal(signalConfig.metricsEndpoint, "https://metrics.internal.example/custom-metrics");

await expectConfigReject(/requires OTEL_EXPORTER_OTLP_ENDPOINT/, () => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
});
await expectConfigReject(/requires OTEL_EXPORTER_OTLP_PROTOCOL=http\/json/, () => {
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
});
await expectConfigReject(/must use https:\/\//, () => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel.internal.example:4318";
});
await expectConfigReject(/must not target a loopback host/, () => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://127.0.0.1:4318";
});
await expectConfigReject(/must not embed credentials/, () => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://user:password@otel.internal.example:4318";
});
await expectConfigReject(/must (?:be )?explicitly set to 'required' or 'best-effort'/, () => {
  delete process.env.CAREPOINT_OTEL_EXPORT_MODE;
});
await expectConfigReject(/must not override 'content-type'/, () => {
  process.env.OTEL_EXPORTER_OTLP_HEADERS = "content-type=text/plain";
});
await expectConfigReject(/contains an invalid header/, () => {
  process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=Bearer%20token%0Ainjected";
});
await expectConfigReject(/OTEL_EXPORTER_OTLP_TIMEOUT must be a positive integer/, () => {
  process.env.OTEL_EXPORTER_OTLP_TIMEOUT = "0";
});
await expectConfigReject(/Unsupported OTEL_TRACES_SAMPLER/, () => {
  process.env.OTEL_TRACES_SAMPLER = "unsupported";
});
await expectConfigReject(/OTEL_TRACES_SAMPLER_ARG must be between 0 and 1/, () => {
  process.env.OTEL_TRACES_SAMPLER = "traceidratio";
  process.env.OTEL_TRACES_SAMPLER_ARG = "2";
});
await expectConfigReject(/OTEL_SDK_DISABLED=true is forbidden/, () => {
  process.env.OTEL_SDK_DISABLED = "true";
});

configureProduction();
const validParent = parseRemoteTraceParent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
assert.deepEqual(validParent, {
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  parentSpanId: "00f067aa0ba902b7",
  traceFlags: "01",
  sampled: true,
});
assert.equal(parseRemoteTraceParent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"), null);
assert.equal(parseRemoteTraceParent("invalid"), null);
assert.match(generateTraceId(), /^[0-9a-f]{32}$/);
assert.match(generateSpanId(), /^[0-9a-f]{16}$/);
assert.equal(shouldSampleTrace(validParent.traceId, validParent, config.sampler), true);
assert.equal(
  shouldSampleTrace(validParent.traceId, { ...validParent, sampled: false, traceFlags: "00" }, config.sampler),
  false,
);
const ratioZeroSampler = { name: "traceidratio", ratio: 0 };
const ratioOneSampler = { name: "traceidratio", ratio: 1 };
const ratioHalfSampler = { name: "traceidratio", ratio: 0.5 };
assert.equal(shouldSampleTrace("00000000000000000000000000000001", null, ratioZeroSampler), false);
assert.equal(shouldSampleTrace("ffffffffffffffffffffffffffffffff", null, ratioOneSampler), true);
assert.equal(shouldSampleTrace("00000000000000000000000000000001", null, ratioHalfSampler), true);
assert.equal(shouldSampleTrace("ffffffffffffffffffffffffffffffff", null, ratioHalfSampler), false);

configureProduction();
let requiredCalls = 0;
const requiredPayloads = [];
await assertProductionOtlpReady({
  send: async (endpoint, headers, timeoutMs, payload) => {
    requiredCalls += 1;
    assert.match(endpoint, /^https:\/\//);
    assert.equal(headers.authorization, "Bearer carepoint-test-token");
    assert.equal(timeoutMs, 5000);
    requiredPayloads.push(payload);
  },
});
assert.equal(requiredCalls, 2);
assert.deepEqual(requiredPayloads, [{ resourceSpans: [] }, { resourceMetrics: [] }]);

configureProduction();
process.env.CAREPOINT_OTEL_EXPORT_MODE = "best-effort";
let bestEffortCalls = 0;
await assertProductionOtlpReady({ send: async () => { bestEffortCalls += 1; } });
assert.equal(bestEffortCalls, 0, "best-effort mode must validate configuration without startup network dependency");

configureProduction();
let redactedError;
try {
  await assertProductionOtlpReady({
    send: async () => {
      throw new Error(`dial ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT} auth=carepoint-test-token`);
    },
  });
} catch (error) {
  redactedError = error;
}
assert.ok(redactedError instanceof Error);
assert.doesNotMatch(redactedError.message, /carepoint-test-token/);
assert.doesNotMatch(redactedError.message, /otel\.internal\.example/);
assert.match(redactedError.message, /<otlp-endpoint>/);

configureProduction();
const payloadConfig = otlpHttpConfiguration(process.env);
const tracePayload = buildTracePayload(payloadConfig, [{
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  name: "GET /api/v1/health",
  kind: 2,
  startTimeUnixNano: "1700000000000000000",
  endTimeUnixNano: "1700000000001000000",
  attributes: [
    { key: "http.request.method", value: { stringValue: "GET" } },
    { key: "http.route", value: { stringValue: "/api/v1/health" } },
  ],
}]);
const metricPayload = buildMetricsPayload(payloadConfig, [{
  method: "GET",
  route: "/api/v1/health",
  statusCode: 200,
  count: 2,
  durationSumMs: 12,
  bucketCounts: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  minMs: 5,
  maxMs: 7,
  startTimeUnixNano: "1700000000000000000",
  timeUnixNano: "1700000001000000000",
}], 0);
const serialized = JSON.stringify({ tracePayload, metricPayload });
assert.match(serialized, /resourceSpans/);
assert.match(serialized, /resourceMetrics/);
assert.match(serialized, /http\.server\.request\.duration/);
assert.match(serialized, /deployment\.environment\.name/);
assert.doesNotMatch(serialized, /authorization|carepoint-test-token|patient@|query|body/i);

console.log("Phase C6 OpenTelemetry OTLP/HTTP JSON acceptance passed");
