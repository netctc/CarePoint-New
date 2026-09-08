import {
  otlpHttpConfiguration,
  sendOtlpJson,
  type OtlpJsonSender,
} from "./otlp-http-exporter";

export interface ProductionOtlpPreflightOptions {
  send?: OtlpJsonSender;
}

export async function assertProductionOtlpReady(options: ProductionOtlpPreflightOptions = {}): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const config = otlpHttpConfiguration(process.env);
  if (!config.enabled || !config.tracesEndpoint || !config.metricsEndpoint) {
    throw new Error("Production OpenTelemetry must configure both traces and metrics OTLP/HTTP endpoints.");
  }
  if (config.exportMode === "best-effort") return;

  const send = options.send ?? sendOtlpJson;
  try {
    await Promise.all([
      send(config.tracesEndpoint, config.tracesHeaders, config.tracesTimeoutMs, { resourceSpans: [] }),
      send(config.metricsEndpoint, config.metricsHeaders, config.metricsTimeoutMs, { resourceMetrics: [] }),
    ]);
  } catch (error) {
    throw new Error(`Production OpenTelemetry preflight could not verify OTLP collector readiness: ${safeMessage(error)}`);
  }
}

function safeMessage(error: unknown): string {
  const source = error instanceof Error && error.message ? error.message : String(error);
  let output = source;
  for (const endpoint of [
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
  ]) {
    if (endpoint?.trim()) output = output.split(endpoint).join("<otlp-endpoint>");
  }
  for (const raw of [
    process.env.OTEL_EXPORTER_OTLP_HEADERS,
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS,
    process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS,
  ]) {
    if (!raw) continue;
    for (const item of raw.split(",")) {
      const separator = item.indexOf("=");
      if (separator <= 0) continue;
      const encoded = item.slice(separator + 1).trim();
      for (const candidate of [encoded, safelyDecode(encoded)]) {
        if (candidate) output = output.split(candidate).join("<otlp-header-value>");
      }
    }
  }
  return output.slice(0, 500);
}

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
