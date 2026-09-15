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
      const name = item.slice(0, separator).trim();
      const encoded = item.slice(separator + 1).trim();
      for (const candidate of headerRedactionCandidates(name, encoded)) {
        output = output.split(candidate).join("<otlp-header-value>");
      }
    }
  }
  return output.slice(0, 500);
}

function headerRedactionCandidates(name: string, encoded: string): string[] {
  const decoded = safelyDecode(encoded);
  const candidates = new Set<string>();
  for (const candidate of [encoded, decoded]) {
    if (candidate) candidates.add(candidate);
  }

  if (name.toLowerCase() === "authorization") {
    const credentialSeparator = decoded.search(/\s/);
    if (credentialSeparator > 0 && credentialSeparator < decoded.length - 1) {
      const credential = decoded.slice(credentialSeparator + 1).trim();
      if (credential) {
        candidates.add(credential);
        candidates.add(encodeURIComponent(credential));
      }
    }
  }

  return [...candidates]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
