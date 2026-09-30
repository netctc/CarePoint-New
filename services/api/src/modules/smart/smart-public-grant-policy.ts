import { BadRequestException } from "@nestjs/common";

export type SmartPublicGrant = "authorization_code" | "refresh_token";
export interface SmartPublicGrantFields extends Record<string, unknown> {
  grant_type: SmartPublicGrant;
  client_id: string;
}

type Input = Record<string, unknown>;

/** Interpret only the two protocol grants implemented for registered public clients. */
export function parseSmartPublicGrant(input: Input): SmartPublicGrant {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException({ error: "invalid_request", error_description: "SMART token request must be an object." });
  }
  const value = input.grant_type;
  if (typeof value !== "string" || !value || Array.isArray(value)) {
    throw new BadRequestException({ error: "invalid_request", error_description: "SMART grant_type must be supplied exactly once as a string." });
  }
  // Return canonical protocol variants, never a caller-defined handler name.
  switch (value) {
    case "authorization_code": return "authorization_code";
    case "refresh_token": return "refresh_token";
    default:
      throw new BadRequestException({ error: "unsupported_grant_type", error_description: "SMART public clients support authorization_code and refresh_token only." });
  }
}

/** Reject ambiguous credential combinations and snapshot only the selected grant's fields. */
export function normalizeSmartPublicGrantFields(input: Input, grant: SmartPublicGrant): SmartPublicGrantFields {
  const incompatible = grant === "authorization_code"
    ? ["refresh_token", "client_assertion", "client_assertion_type"]
    : ["code", "code_verifier", "redirect_uri", "client_assertion", "client_assertion_type"];
  for (const field of incompatible) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw new BadRequestException({ error: "invalid_request", error_description: "SMART token request mixes incompatible grant credentials." });
    }
  }
  const result: SmartPublicGrantFields = {
    grant_type: grant,
    client_id: requiredText(input.client_id, "client_id", 128),
  };
  if (grant === "authorization_code") {
    result.code = requiredText(input.code, "code", 500);
    result.redirect_uri = requiredText(input.redirect_uri, "redirect_uri", 1000);
    result.code_verifier = requiredText(input.code_verifier, "code_verifier", 128);
  } else {
    result.refresh_token = requiredText(input.refresh_token, "refresh_token", 1000);
    // Omitted/empty scope retains the original grant. Nonempty scope is checked
    // against persisted consent by the existing refresh-token validation path.
    if (input.scope !== undefined && input.scope !== null && input.scope !== "") {
      result.scope = requiredText(input.scope, "scope", 4000);
    }
  }
  // OAuth extension parameters are ignored, rather than copied into internal state.
  return Object.freeze(result);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new BadRequestException({ error: "invalid_request", error_description: `SMART ${field} must be a single nonempty string within its length limit.` });
  }
  return value.trim();
}
