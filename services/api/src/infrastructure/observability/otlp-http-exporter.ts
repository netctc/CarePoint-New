import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomBytes } from "node:crypto";

export type OtlpExportMode = "required" | "best-effort";

export interface OtlpHttpConfiguration {
  enabled: boolean;
  exportMode: OtlpExportMode;
  tracesEndpoint?: string | undefined;
  metricsEndpoint?: string | undefined;
  tracesHeaders: Record<string, string>;
  metricsHeaders: Record<string, string>;
  tracesTimeoutMs: number;
  metricsTimeoutMs: number;
  serviceName: string;
  serviceNamespace?: string | undefined;
  serviceVersion?: string | undefined;
  deploymentEnvironment?: string | undefined;
  cloudRegion?: string | undefined;
  queueSize: number;
  flushIntervalMs: number;
  sampler: OtlpSamplerConfiguration;
}

export interface OtlpSamplerConfiguration {
  name:
    | "always_on"
    | "always_off"
    | "traceidratio"
    | "parentbased_always_on"
    | "parentbased_always_off"
    | "parentbased_traceidratio";
  ratio: number;
}

export interface RemoteTraceParent {
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
  sampled: boolean;
}

export interface HttpTelemetryInput {
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  traceFlags: string;
  sampled: boolean;
}

export interface OtlpJsonSender {
  (endpoint: string, headers: Record<string, string>, timeoutMs: number, payload: unknown): Promise<void>;
}

type OtlpSpan = Record<string, unknown>;
type MetricKey = string;

type MetricAggregate = {
  method: string;
  route: string;
  statusCode: number;
  count: number;
  durationSumMs: number;
  bucketCounts: number[];
  minMs: number;
  maxMs: number;
  startTimeUnixNano: string;
  timeUnixNano: string;
};

const DURATION_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export function otlpHttpConfiguration(env: NodeJS.ProcessEnv = process.env): OtlpHttpConfiguration {
  const production = env.NODE_ENV === "production";
  const sdkDisabled = env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true";
  if (production && sdkDisabled) throw new Error("OTEL_SDK_DISABLED=true is forbidden in production.");

  const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const tracesEndpointRaw = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  const metricsEndpointRaw = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim();
  const enabled = Boolean(baseEndpoint || tracesEndpointRaw || metricsEndpointRaw);
  if (production && !enabled) throw new Error("Production OpenTelemetry requires OTEL_EXPORTER_OTLP_ENDPOINT or signal-specific OTLP endpoints.");

  const protocol = (env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/json").trim().toLowerCase();
  const tracesProtocol = (env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? protocol).trim().toLowerCase();
  const metricsProtocol = (env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL ?? protocol).trim().toLowerCase();
  if (enabled && (tracesProtocol !== "http/json" || metricsProtocol !== "http/json")) {
    throw new Error("CarePoint C6 OTLP exporter requires OTEL_EXPORTER_OTLP_PROTOCOL=http/json for traces and metrics.");
  }

  const tracesEndpoint = enabled
    ? validatedOtlpEndpoint(tracesEndpointRaw || appendSignalPath(baseEndpoint, "traces"), production, "traces")
    : undefined;
  const metricsEndpoint = enabled
    ? validatedOtlpEndpoint(metricsEndpointRaw || appendSignalPath(baseEndpoint, "metrics"), production, "metrics")
    : undefined;

  const commonHeaders = parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);
  const tracesHeaders = { ...commonHeaders, ...parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS) };
  const metricsHeaders = { ...commonHeaders, ...parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_METRICS_HEADERS) };
  validateUserHeaders(tracesHeaders);
  validateUserHeaders(metricsHeaders);

  const exportMode = exportModeFromEnv(env.CAREPOINT_OTEL_EXPORT_MODE, production);
  const commonTimeout = positiveInteger(env.OTEL_EXPORTER_OTLP_TIMEOUT ?? "10000", "OTEL_EXPORTER_OTLP_TIMEOUT");
  const serviceName = sanitizeResourceValue(env.OTEL_SERVICE_NAME ?? "carepoint-api", "OTEL_SERVICE_NAME", 120, true);
  const serviceNamespace = optionalResourceValue(env.OTEL_SERVICE_NAMESPACE, "OTEL_SERVICE_NAMESPACE", 120);
  const serviceVersion = optionalResourceValue(env.OTEL_SERVICE_VERSION, "OTEL_SERVICE_VERSION", 80);
  const deploymentEnvironment = optionalResourceValue(
    env.OTEL_DEPLOYMENT_ENVIRONMENT ?? (production ? "production" : env.NODE_ENV),
    "OTEL_DEPLOYMENT_ENVIRONMENT",
    80,
  );
  const cloudRegion = optionalResourceValue(env.AWS_REGION, "AWS_REGION", 80);

  return {
    enabled,
    exportMode,
    tracesEndpoint,
    metricsEndpoint,
    tracesHeaders,
    metricsHeaders,
    tracesTimeoutMs: positiveInteger(env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT ?? String(commonTimeout), "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT"),
    metricsTimeoutMs: positiveInteger(env.OTEL_EXPORTER_OTLP_METRICS_TIMEOUT ?? String(commonTimeout), "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT"),
    serviceName,
    serviceNamespace,
    serviceVersion,
    deploymentEnvironment,
    cloudRegion,
    queueSize: positiveInteger(env.CAREPOINT_OTEL_MAX_QUEUE ?? "2048", "CAREPOINT_OTEL_MAX_QUEUE"),
    flushIntervalMs: positiveInteger(env.OTEL_METRIC_EXPORT_INTERVAL ?? "5000", "OTEL_METRIC_EXPORT_INTERVAL"),
    sampler: samplerFromEnv(env.OTEL_TRACES_SAMPLER, env.OTEL_TRACES_SAMPLER_ARG),
  };
}

export function parseRemoteTraceParent(value: string | string[] | undefined): RemoteTraceParent | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim().toLowerCase();
  if (!normalized) return null;
  const match = TRACEPARENT_PATTERN.exec(normalized);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  if (/^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null;
  const flags = Number.parseInt(match[3], 16);
  return {
    traceId: match[1],
    parentSpanId: match[2],
    traceFlags: match[3],
    sampled: (flags & 0x01) === 0x01,
  };
}

export function generateTraceId(): string {
  let value = randomBytes(16).toString("hex");
  while (/^0+$/.test(value)) value = randomBytes(16).toString("hex");
  return value;
}

export function generateSpanId(): string {
  let value = randomBytes(8).toString("hex");
  while (/^0+$/.test(value)) value = randomBytes(8).toString("hex");
  return value;
}

export function shouldSampleTrace(
  traceId: string,
  remoteParent: RemoteTraceParent | null,
  sampler: OtlpSamplerConfiguration,
): boolean {
  if (sampler.name.startsWith("parentbased_") && remoteParent) return remoteParent.sampled;
  if (sampler.name.endsWith("always_on")) return true;
  if (sampler.name.endsWith("always_off")) return false;
  const high64 = BigInt(`0x${traceId.slice(0, 16)}`);
  const threshold = BigInt(Math.floor(sampler.ratio * Number.MAX_SAFE_INTEGER));
  const normalized = high64 >> 11n;
  return normalized <= threshold;
}

export async function sendOtlpJson(
  endpoint: string,
  headers: Record<string, string>,
  timeoutMs: number,
  payload: unknown,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OTLP collector returned HTTP ${response.status}.`);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class CarePointOtlpExporter implements OnModuleDestroy {
  private readonly config = otlpHttpConfiguration(process.env);
  private readonly spans: OtlpSpan[] = [];
  private readonly metrics = new Map<MetricKey, MetricAggregate>();
  private readonly sender: OtlpJsonSender = sendOtlpJson;
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private droppedSpans = 0;
  private lastFailureLogAt = 0;

  constructor() {
    if (this.config.enabled) {
      this.timer = setInterval(() => void this.flush(), this.config.flushIntervalMs);
      this.timer.unref();
    }
  }

  recordHttpRequest(input: HttpTelemetryInput): void {
    if (!this.config.enabled) return;
    if (input.sampled) this.recordSpan(input);
    this.recordMetrics(input);
  }

  async flush(): Promise<void> {
    if (!this.config.enabled || this.flushing) return;
    if (this.spans.length === 0 && this.metrics.size === 0) return;
    this.flushing = true;
    const spans = this.spans.splice(0, this.spans.length);
    const metrics = [...this.metrics.values()];
    this.metrics.clear();
    try {
      const operations: Promise<void>[] = [];
      if (spans.length > 0 && this.config.tracesEndpoint) {
        operations.push(this.sender(
          this.config.tracesEndpoint,
          this.config.tracesHeaders,
          this.config.tracesTimeoutMs,
          buildTracePayload(this.config, spans),
        ));
      }
      if (metrics.length > 0 && this.config.metricsEndpoint) {
        operations.push(this.sender(
          this.config.metricsEndpoint,
          this.config.metricsHeaders,
          this.config.metricsTimeoutMs,
          buildMetricsPayload(this.config, metrics, this.droppedSpans),
        ));
      }
      await Promise.all(operations);
      this.droppedSpans = 0;
    } catch (error) {
      this.safeExporterFailure(error);
    } finally {
      this.flushing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private recordSpan(input: HttpTelemetryInput): void {
    if (this.spans.length >= this.config.queueSize) {
      this.droppedSpans += 1;
      return;
    }
    const attributes = httpAttributes(input);
    const span: OtlpSpan = {
      traceId: input.traceId,
      spanId: input.spanId,
      ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
      name: `${input.method} ${input.route}`,
      kind: 2,
      startTimeUnixNano: input.startTimeUnixNano,
      endTimeUnixNano: input.endTimeUnixNano,
      attributes,
      ...(input.statusCode >= 500 ? { status: { code: 2 } } : {}),
      flags: Number.parseInt(input.traceFlags, 16),
    };
    this.spans.push(span);
    if (this.spans.length >= Math.min(this.config.queueSize, 256)) void this.flush();
  }

  private recordMetrics(input: HttpTelemetryInput): void {
    const key = `${input.method}\u0000${input.route}\u0000${input.statusCode}`;
    const existing = this.metrics.get(key);
    const now = input.endTimeUnixNano;
    if (existing) {
      existing.count += 1;
      existing.durationSumMs += input.durationMs;
      const bucket = bucketIndex(input.durationMs);
      existing.bucketCounts[bucket] = (existing.bucketCounts[bucket] ?? 0) + 1;
      existing.minMs = Math.min(existing.minMs, input.durationMs);
      existing.maxMs = Math.max(existing.maxMs, input.durationMs);
      existing.timeUnixNano = now;
      return;
    }
    const bucketCounts = Array.from({ length: DURATION_BOUNDS_MS.length + 1 }, () => 0);
    bucketCounts[bucketIndex(input.durationMs)] = 1;
    this.metrics.set(key, {
      method: input.method,
      route: input.route,
      statusCode: input.statusCode,
      count: 1,
      durationSumMs: input.durationMs,
      bucketCounts,
      minMs: input.durationMs,
      maxMs: input.durationMs,
      startTimeUnixNano: input.startTimeUnixNano,
      timeUnixNano: now,
    });
  }

  private safeExporterFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.lastFailureLogAt < 60_000) return;
    this.lastFailureLogAt = now;
    const message = error instanceof Error ? error.message : "Unknown OTLP export error";
    process.stderr.write(`${JSON.stringify({
      type: "otel_export_failure",
      message: sanitizeExporterError(message),
      timestamp: new Date(now).toISOString(),
    })}\n`);
  }
}

export function buildTracePayload(config: OtlpHttpConfiguration, spans: OtlpSpan[]): unknown {
  return {
    resourceSpans: [{
      resource: { attributes: resourceAttributes(config) },
      scopeSpans: [{
        scope: { name: "carepoint.http", version: "1.0.0" },
        spans,
      }],
    }],
  };
}

export function buildMetricsPayload(
  config: OtlpHttpConfiguration,
  aggregates: MetricAggregate[],
  droppedSpans = 0,
): unknown {
  const countPoints = aggregates.map((item) => ({
    attributes: metricAttributes(item),
    startTimeUnixNano: item.startTimeUnixNano,
    timeUnixNano: item.timeUnixNano,
    asInt: String(item.count),
  }));
  const durationPoints = aggregates.map((item) => ({
    attributes: metricAttributes(item),
    startTimeUnixNano: item.startTimeUnixNano,
    timeUnixNano: item.timeUnixNano,
    count: String(item.count),
    sum: item.durationSumMs,
    bucketCounts: item.bucketCounts.map(String),
    explicitBounds: DURATION_BOUNDS_MS,
    min: item.minMs,
    max: item.maxMs,
  }));
  const latestTime = aggregates.at(-1)?.timeUnixNano ?? unixNanoNow();
  const metrics: unknown[] = [
    {
      name: "http.server.request.count",
      unit: "{request}",
      sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: countPoints },
    },
    {
      name: "http.server.request.duration",
      unit: "ms",
      histogram: { aggregationTemporality: 1, dataPoints: durationPoints },
    },
  ];
  if (droppedSpans > 0) {
    metrics.push({
      name: "carepoint.telemetry.dropped_spans",
      unit: "{span}",
      sum: {
        aggregationTemporality: 1,
        isMonotonic: true,
        dataPoints: [{ timeUnixNano: latestTime, asInt: String(droppedSpans) }],
      },
    });
  }
  return {
    resourceMetrics: [{
      resource: { attributes: resourceAttributes(config) },
      scopeMetrics: [{ scope: { name: "carepoint.http", version: "1.0.0" }, metrics }],
    }],
  };
}

export function unixNanoNow(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function httpAttributes(input: HttpTelemetryInput): unknown[] {
  return [
    stringAttribute("http.request.method", input.method),
    stringAttribute("http.route", input.route),
    intAttribute("http.response.status_code", input.statusCode),
    stringAttribute("carepoint.request_id", input.requestId),
  ];
}

function metricAttributes(item: MetricAggregate): unknown[] {
  return [
    stringAttribute("http.request.method", item.method),
    stringAttribute("http.route", item.route),
    intAttribute("http.response.status_code", item.statusCode),
  ];
}

function resourceAttributes(config: OtlpHttpConfiguration): unknown[] {
  return [
    stringAttribute("service.name", config.serviceName),
    ...(config.serviceNamespace ? [stringAttribute("service.namespace", config.serviceNamespace)] : []),
    ...(config.serviceVersion ? [stringAttribute("service.version", config.serviceVersion)] : []),
    ...(config.deploymentEnvironment
      ? [stringAttribute("deployment.environment.name", config.deploymentEnvironment)]
      : []),
    ...(config.cloudRegion ? [stringAttribute("cloud.region", config.cloudRegion)] : []),
  ];
}

function stringAttribute(key: string, value: string): unknown {
  return { key, value: { stringValue: value } };
}

function intAttribute(key: string, value: number): unknown {
  return { key, value: { intValue: String(Math.trunc(value)) } };
}

function bucketIndex(durationMs: number): number {
  const index = DURATION_BOUNDS_MS.findIndex((bound) => durationMs <= bound);
  return index === -1 ? DURATION_BOUNDS_MS.length : index;
}

function appendSignalPath(baseEndpoint: string | undefined, signal: "traces" | "metrics"): string | undefined {
  if (!baseEndpoint) return undefined;
  const url = new URL(baseEndpoint);
  const basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${basePath}v1/${signal}`.replace(/\/+/g, "/");
  return url.toString();
}

function validatedOtlpEndpoint(value: string | undefined, production: boolean, signal: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`OTLP ${signal} endpoint must be a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`OTLP ${signal} endpoint must use http:// or https://.`);
  }
  if (url.username || url.password) throw new Error(`OTLP ${signal} endpoint must not embed credentials in the URL.`);
  if (production && url.protocol !== "https:") throw new Error(`Production OTLP ${signal} endpoint must use https://.`);
  if (production && isLocalHost(url.hostname)) throw new Error(`Production OTLP ${signal} endpoint must not target a loopback host.`);
  return url.toString();
}

function parseOtlpHeaders(value: string | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  if (!value?.trim()) return output;
  for (const rawItem of value.split(",")) {
    const item = rawItem.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator <= 0) throw new Error("OTEL_EXPORTER_OTLP_*_HEADERS must use key=value comma-separated syntax.");
    const key = decodeHeaderComponent(item.slice(0, separator)).trim().toLowerCase();
    const headerValue = decodeHeaderComponent(item.slice(separator + 1)).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || !headerValue || /[\r\n]/.test(headerValue)) {
      throw new Error("OTEL_EXPORTER_OTLP_*_HEADERS contains an invalid header.");
    }
    output[key] = headerValue;
  }
  return output;
}

function validateUserHeaders(headers: Record<string, string>): void {
  for (const key of Object.keys(headers)) {
    if (["content-type", "content-length", "host", "connection", "accept"].includes(key)) {
      throw new Error(`OTLP user headers must not override '${key}'.`);
    }
  }
}

function decodeHeaderComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("OTEL_EXPORTER_OTLP_*_HEADERS contains invalid percent encoding.");
  }
}

function exportModeFromEnv(value: string | undefined, production: boolean): OtlpExportMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized && !production) return "best-effort";
  if (normalized === "required" || normalized === "best-effort") return normalized;
  throw new Error("CAREPOINT_OTEL_EXPORT_MODE must be explicitly set to 'required' or 'best-effort' in production.");
}

function samplerFromEnv(nameValue: string | undefined, argValue: string | undefined): OtlpSamplerConfiguration {
  const name = (nameValue?.trim().toLowerCase() || "parentbased_always_on") as OtlpSamplerConfiguration["name"];
  const supported = [
    "always_on",
    "always_off",
    "traceidratio",
    "parentbased_always_on",
    "parentbased_always_off",
    "parentbased_traceidratio",
  ];
  if (!supported.includes(name)) throw new Error(`Unsupported OTEL_TRACES_SAMPLER '${name}'.`);
  if (name.includes("traceidratio")) {
    const ratio = Number(argValue ?? "1");
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error("OTEL_TRACES_SAMPLER_ARG must be between 0 and 1.");
    return { name, ratio };
  }
  return { name, ratio: name.endsWith("always_off") ? 0 : 1 };
}

function optionalResourceValue(value: string | undefined, name: string, maxLength: number): string | undefined {
  if (!value?.trim()) return undefined;
  return sanitizeResourceValue(value, name, maxLength, false);
}

function sanitizeResourceValue(value: string, name: string, maxLength: number, required: boolean): string {
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${name} is required.`);
  if (!normalized || normalized.length > maxLength || /[\r\n\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${name} contains an invalid telemetry resource value.`);
  }
  return normalized;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function isLocalHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.endsWith(".localhost");
}

function sanitizeExporterError(message: string): string {
  let sanitized = message;
  const endpointValues = [
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
  ].filter((value): value is string => Boolean(value?.trim()));
  for (const endpoint of endpointValues) sanitized = sanitized.split(endpoint).join("<otlp-endpoint>");
  for (const rawHeaders of [
    process.env.OTEL_EXPORTER_OTLP_HEADERS,
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS,
    process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS,
  ]) {
    if (!rawHeaders) continue;
    for (const secret of Object.values(parseOtlpHeaders(rawHeaders))) {
      if (secret) sanitized = sanitized.split(secret).join("<otlp-header-value>");
    }
  }
  return sanitized.slice(0, 500);
}
