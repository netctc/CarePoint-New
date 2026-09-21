import { inboundBodyLimits } from "../../infrastructure/http/inbound-body-limits";

// A request can contain an 8 MiB original plus a 2 MiB thumbnail. Base64 adds
// roughly 33% overhead, so production must reserve enough JSON capacity for
// the bounded payload plus metadata/envelope fields.
export const CLINICAL_MEDIA_MIN_JSON_BODY_BYTES = 15 * 1024 * 1024;

export function assertProductionClinicalMediaBodyCapacity(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const configured = inboundBodyLimits(env).jsonBytes;
  if (configured < CLINICAL_MEDIA_MIN_JSON_BODY_BYTES) {
    throw new Error(
      `Clinical media requires JSON_BODY_LIMIT_BYTES >= ${CLINICAL_MEDIA_MIN_JSON_BODY_BYTES}.`,
    );
  }
}
