import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  otlpHttpConfiguration,
  sendOtlpJson,
  unixNanoNow,
  type OtlpHttpConfiguration,
} from "./otlp-http-exporter";

export const V2_OPERATIONAL_DOMAINS = [
  "QUESTIONNAIRE",
  "OBSERVATION",
  "RPM",
  "EXPORT",
  "SYNC",
  "INTEGRATION",
] as const;
export type V2OperationalDomain = (typeof V2_OPERATIONAL_DOMAINS)[number];
export type V2SignalType = "TECHNICAL" | "CLINICAL_OUTCOME" | "QUEUE";

type CounterKey = string;
type CounterAggregate = {
  domain: V2OperationalDomain;
  operation: string;
  signalType: V2SignalType;
  outcome: string;
  count: number;
  durationSumMs: number;
  durationCount: number;
  startTimeUnixNano: string;
  timeUnixNano: string;
};

type QueueGauge = {
  domain: V2OperationalDomain;
  queue: string;
  depth: number;
  timeUnixNano: string;
};

const SAFE_OPERATION = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_OUTCOME = /^[A-Z][A-Z0-9_]{1,63}$/;
const FLUSH_INTERVAL_MS = 10_000;

@Injectable()
export class V2OperationalTelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly config: OtlpHttpConfiguration = otlpHttpConfiguration(process.env);
  private readonly counters = new Map<CounterKey, CounterAggregate>();
  private readonly queues = new Map<string, QueueGauge>();
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private lastFailureLogAt = 0;

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  recordTechnical(
    domain: V2OperationalDomain,
    operation: string,
    outcome: "SUCCESS" | "ERROR",
    durationMs: number,
  ): void {
    this.record(domain, operation, "TECHNICAL", outcome, durationMs);
  }

  recordClinicalOutcome(domain: V2OperationalDomain, operation: string, outcome: string): void {
    this.record(domain, operation, "CLINICAL_OUTCOME", outcome, null);
  }

  recordQueueDepth(domain: V2OperationalDomain, queue: string, depth: number): void {
    if (!this.config.enabled) return;
    const safeQueue = this.safeToken(queue, "queue");
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > 10_000_000) return;
    this.queues.set(`${domain}\u0000${safeQueue}`, {
      domain,
      queue: safeQueue,
      depth,
      timeUnixNano: unixNanoNow(),
    });
  }

  async flush(): Promise<void> {
    if (!this.config.enabled || this.flushing || !this.config.metricsEndpoint) return;
    if (this.counters.size === 0 && this.queues.size === 0) return;
    this.flushing = true;
    const counters = [...this.counters.values()];
    const queues = [...this.queues.values()];
    this.counters.clear();
    this.queues.clear();
    try {
      await sendOtlpJson(
        this.config.metricsEndpoint,
        this.config.metricsHeaders,
        this.config.metricsTimeoutMs,
        buildV2OperationalMetricsPayload(this.config, counters, queues),
      );
    } catch (error) {
      this.safeFailure(error);
    } finally {
      this.flushing = false;
    }
  }

  private record(
    domain: V2OperationalDomain,
    operationInput: string,
    signalType: V2SignalType,
    outcomeInput: string,
    durationMs: number | null,
  ): void {
    if (!this.config.enabled || !V2_OPERATIONAL_DOMAINS.includes(domain)) return;
    const operation = this.safeToken(operationInput, "operation");
    const outcome = this.safeToken(outcomeInput, "outcome");
    if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 3_600_000)) return;
    const key = `${domain}\u0000${operation}\u0000${signalType}\u0000${outcome}`;
    const now = unixNanoNow();
    const current = this.counters.get(key);
    if (current) {
      current.count += 1;
      current.timeUnixNano = now;
      if (durationMs !== null) {
        current.durationCount += 1;
        current.durationSumMs += durationMs;
      }
      return;
    }
    this.counters.set(key, {
      domain,
      operation,
      signalType,
      outcome,
      count: 1,
      durationCount: durationMs === null ? 0 : 1,
      durationSumMs: durationMs ?? 0,
      startTimeUnixNano: now,
      timeUnixNano: now,
    });
  }

  private safeToken(value: string, label: string): string {
    const normalized = String(value).trim().toUpperCase();
    const pattern = label === "operation" || label === "outcome" ? SAFE_OPERATION : SAFE_OUTCOME;
    if (!pattern.test(normalized)) return "INVALID";
    return normalized;
  }

  private safeFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.lastFailureLogAt < 60_000) return;
    this.lastFailureLogAt = now;
    const errorCode = error instanceof Error
      ? error.constructor.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80)
      : "OperationalTelemetryError";
    process.stderr.write(`${JSON.stringify({
      type: "v2_operational_telemetry_export_failure",
      errorCode: errorCode || "OperationalTelemetryError",
      timestamp: new Date(now).toISOString(),
    })}\n`);
  }
}

export function buildV2OperationalMetricsPayload(
  config: OtlpHttpConfiguration,
  counters: CounterAggregate[],
  queues: QueueGauge[],
): unknown {
  const counterPoints = counters.map((item) => ({
    attributes: operationalAttributes(item.domain, item.operation, item.signalType, item.outcome),
    startTimeUnixNano: item.startTimeUnixNano,
    timeUnixNano: item.timeUnixNano,
    asInt: String(item.count),
  }));
  const durationPoints = counters
    .filter((item) => item.durationCount > 0)
    .map((item) => ({
      attributes: operationalAttributes(item.domain, item.operation, item.signalType, item.outcome),
      startTimeUnixNano: item.startTimeUnixNano,
      timeUnixNano: item.timeUnixNano,
      asDouble: item.durationSumMs / item.durationCount,
    }));
  const queuePoints = queues.map((item) => ({
    attributes: [
      stringAttribute("carepoint.v2.domain", item.domain),
      stringAttribute("carepoint.v2.queue", item.queue),
      stringAttribute("carepoint.v2.signal_type", "QUEUE"),
    ],
    timeUnixNano: item.timeUnixNano,
    asInt: String(item.depth),
  }));

  const metrics: unknown[] = [];
  if (counterPoints.length) {
    metrics.push({
      name: "carepoint.v2.operation.count",
      unit: "{operation}",
      sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: counterPoints },
    });
  }
  if (durationPoints.length) {
    metrics.push({
      name: "carepoint.v2.operation.duration.mean",
      unit: "ms",
      gauge: { dataPoints: durationPoints },
    });
  }
  if (queuePoints.length) {
    metrics.push({
      name: "carepoint.v2.queue.depth",
      unit: "{item}",
      gauge: { dataPoints: queuePoints },
    });
  }

  return {
    resourceMetrics: [{
      resource: {
        attributes: [
          stringAttribute("service.name", config.serviceName),
          ...(config.serviceNamespace ? [stringAttribute("service.namespace", config.serviceNamespace)] : []),
          ...(config.serviceVersion ? [stringAttribute("service.version", config.serviceVersion)] : []),
          ...(config.deploymentEnvironment ? [stringAttribute("deployment.environment.name", config.deploymentEnvironment)] : []),
          ...(config.cloudRegion ? [stringAttribute("cloud.region", config.cloudRegion)] : []),
        ],
      },
      scopeMetrics: [{
        scope: { name: "carepoint.v2.operational", version: "1.0.0" },
        metrics,
      }],
    }],
  };
}

function operationalAttributes(
  domain: V2OperationalDomain,
  operation: string,
  signalType: V2SignalType,
  outcome: string,
) {
  return [
    stringAttribute("carepoint.v2.domain", domain),
    stringAttribute("carepoint.v2.operation", operation),
    stringAttribute("carepoint.v2.signal_type", signalType),
    stringAttribute("carepoint.v2.outcome", outcome),
  ];
}

function stringAttribute(key: string, value: string) {
  return { key, value: { stringValue: value } };
}
