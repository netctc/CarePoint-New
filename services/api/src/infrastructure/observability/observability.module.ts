import { CallHandler, ExecutionContext, Global, Injectable, Module, NestInterceptor } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import type { Observable } from "rxjs";
import {
  CarePointOtlpExporter,
  generateSpanId,
  generateTraceId,
  otlpHttpConfiguration,
  parseRemoteTraceParent,
  shouldSampleTrace,
  unixNanoNow,
} from "./otlp-http-exporter";

interface HttpRequestShape {
  method?: string;
  route?: { path?: string };
  baseUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
  traceId?: string;
  spanId?: string;
}

interface HttpResponseShape {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  once(event: "finish", listener: () => void): void;
}

function acceptedRequestId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!/^[A-Za-z0-9._-]{8,80}$/.test(trimmed)) return null;
  return trimmed;
}

@Injectable()
class RequestObservabilityInterceptor implements NestInterceptor {
  private readonly otlpConfig = otlpHttpConfiguration(process.env);

  constructor(private readonly otlp: CarePointOtlpExporter) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestShape>();
    const response = http.getResponse<HttpResponseShape>();
    const requestId = acceptedRequestId(request.headers?.["x-request-id"]) ?? randomUUID();
    const remoteParent = parseRemoteTraceParent(request.headers?.traceparent);
    const traceId = remoteParent?.traceId ?? generateTraceId();
    const spanId = generateSpanId();
    const sampled = shouldSampleTrace(traceId, remoteParent, this.otlpConfig.sampler);
    const traceFlags = sampled ? "01" : "00";
    const started = process.hrtime.bigint();
    const startTimeUnixNano = unixNanoNow();

    request.requestId = requestId;
    request.traceId = traceId;
    request.spanId = spanId;
    response.setHeader("X-Request-Id", requestId);

    response.once("finish", () => {
      const durationNs = process.hrtime.bigint() - started;
      const durationMs = Number(durationNs) / 1_000_000;
      const endTimeUnixNano = (BigInt(startTimeUnixNano) + durationNs).toString();
      const routePath = typeof request.route?.path === "string" ? request.route.path : "unresolved";
      const baseUrl = typeof request.baseUrl === "string" ? request.baseUrl : "";
      const route = `${baseUrl}${routePath}`.slice(0, 240);
      const method = (request.method ?? "UNKNOWN").toUpperCase().slice(0, 16);
      const statusCode = response.statusCode ?? 0;

      this.otlp.recordHttpRequest({
        requestId,
        method,
        route,
        statusCode,
        durationMs,
        startTimeUnixNano,
        endTimeUnixNano,
        traceId,
        spanId,
        parentSpanId: remoteParent?.parentSpanId,
        traceFlags,
        sampled,
      });

      process.stdout.write(`${JSON.stringify({
        type: "http_request",
        requestId,
        trace_id: traceId,
        span_id: spanId,
        trace_flags: traceFlags,
        method,
        route,
        statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        timestamp: new Date().toISOString(),
      })}\n`);
    });
    return next.handle();
  }
}

@Global()
@Module({
  providers: [
    CarePointOtlpExporter,
    { provide: APP_INTERCEPTOR, useClass: RequestObservabilityInterceptor },
  ],
  exports: [CarePointOtlpExporter],
})
export class ObservabilityModule {}
