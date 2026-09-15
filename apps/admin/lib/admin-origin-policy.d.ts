export type OriginPolicyEnv = Record<string, string | undefined>;

export interface OriginRequestLike {
  headers: {
    get(name: string): string | null;
  };
  nextUrl: {
    origin: string;
  };
}

export function adminPublicOrigin(env?: OriginPolicyEnv): string | null;

export function isTrustedAdminPublicOriginRequest(
  request: OriginRequestLike,
  env?: OriginPolicyEnv,
): boolean;
