import { CallHandler, ExecutionContext, Global, Injectable, Module, NestInterceptor } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { randomBytes, randomUUID } from "node:crypto";
import type { Observable } from "rxjs";

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
  return /^[A-Za-z0-9._-]{8,80}$/.test(trimmed) ? trimmed : null;
}

function id(bytes: number): string {
  let value = randomBytes(bytes).toString("hex");
  while (/^0+$/.test(value)) value = randomBytes(bytes).toString("hex");
  return value;
}

@Injectable()
class PilotStructuredObservabilityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestShape>();
    const response = http.getResponse<HttpResponseShape>();
    const requestId = acceptedRequestId(request.headers?.["x-request-id"]) ?? randomUUID();
    const traceId = id(16);
    const spanId = id(8);
    const started = process.hrtime.bigint();

    request.requestId = requestId;
    request.traceId = traceId;
    request.spanId = spanId;
    response.setHeader("X-Request-Id", requestId);

    response.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const routePath = typeof request.route?.path === "string" ? request.route.path : "unresolved";
      const baseUrl = typeof request.baseUrl === "string" ? request.baseUrl : "";
      const route = `${baseUrl}${routePath}`.slice(0, 240);
      const method = (request.method ?? "UNKNOWN").toUpperCase().slice(0, 16);
      process.stdout.write(`${JSON.stringify({
        type: "pilot_http_request",
        environment: "isolated-synthetic",
        requestId,
        trace_id: traceId,
        span_id: spanId,
        method,
        route,
        statusCode: response.statusCode ?? 0,
        durationMs: Math.round(durationMs * 100) / 100,
        timestamp: new Date().toISOString(),
      })}\n`);
    });

    return next.handle();
  }
}

@Global()
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: PilotStructuredObservabilityInterceptor }],
})
export class PilotStructuredObservabilityModule {}
