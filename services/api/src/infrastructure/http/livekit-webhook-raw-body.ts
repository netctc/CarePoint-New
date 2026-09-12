import type { IncomingMessage, ServerResponse } from "node:http";

export const LIVEKIT_WEBHOOK_PATH = "/api/v1/telehealth/webhooks/livekit";
export const LIVEKIT_WEBHOOK_MAX_BODY_BYTES = 262_144;

type RawBodyRequest = IncomingMessage & { rawBody?: Buffer };
type Next = (error?: unknown) => void;

export function createLiveKitWebhookRawBodyMiddleware(
  maxBytes: number = LIVEKIT_WEBHOOK_MAX_BODY_BYTES,
): (request: RawBodyRequest, response: ServerResponse, next: Next) => void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4_096 || maxBytes > 1_048_576) {
    throw new Error("LiveKit webhook body limit must be an integer between 4096 and 1048576 bytes.");
  }

  return (request, response, next) => {
    if (request.method !== "POST") {
      next();
      return;
    }

    const declaredLength = request.headers["content-length"];
    if (typeof declaredLength === "string" && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
      rejectOversized(response);
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        settled = true;
        chunks.length = 0;
        rejectOversized(response);
        return;
      }
      chunks.push(buffer);
    });

    request.on("end", () => {
      if (settled) return;
      settled = true;
      request.rawBody = Buffer.concat(chunks, totalBytes);
      next();
    });

    request.on("aborted", () => {
      if (settled) return;
      settled = true;
      next(new Error("LiveKit webhook request was aborted before the body was received."));
    });

    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      next(error);
    });
  };
}

function rejectOversized(response: ServerResponse): void {
  response.statusCode = 413;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({
    statusCode: 413,
    message: "LiveKit webhook payload exceeds the configured limit.",
  }));
}
