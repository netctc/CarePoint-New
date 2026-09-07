import { CallHandler, ExecutionContext, Global, Injectable, Module, NestInterceptor } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import type { Observable } from "rxjs";

interface HttpRequestShape {
  method?: string;
  route?: { path?: string };
  baseUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
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
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestShape>();
    const response = http.getResponse<HttpResponseShape>();
    const requestId = acceptedRequestId(request.headers?.["x-request-id"]) ?? randomUUID();
    const started = process.hrtime.bigint();
    request.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);

    response.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const routePath = request.route?.path ?? "unresolved";
      const baseUrl = request.baseUrl ?? "";
      process.stdout.write(`${JSON.stringify({
        type: "http_request",
        requestId,
        method: request.method ?? "UNKNOWN",
        route: `${baseUrl}${routePath}`,
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
  providers: [{ provide: APP_INTERCEPTOR, useClass: RequestObservabilityInterceptor }],
})
export class ObservabilityModule {}
