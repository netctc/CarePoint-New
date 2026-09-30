export type ReleaseIdentity = {
  version: string | null;
  sha: string | null;
  sourceRef: string | null;
  buildId: string | null;
  artifactDigest: string | null;
};

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const RELEASE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;

function optionalSingleLine(env: NodeJS.ProcessEnv, name: string, maxLength: number): string | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const value = raw.trim();
  if (value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} must be a single-line value no longer than ${maxLength} characters.`);
  }
  return value;
}

export function releaseIdentity(env: NodeJS.ProcessEnv = process.env): ReleaseIdentity {
  const version = optionalSingleLine(env, "CAREPOINT_RELEASE_VERSION", 64);
  const sha = optionalSingleLine(env, "CAREPOINT_RELEASE_SHA", 40);
  const sourceRef = optionalSingleLine(env, "CAREPOINT_RELEASE_SOURCE_REF", 200);
  const buildId = optionalSingleLine(env, "CAREPOINT_RELEASE_BUILD_ID", 200);
  const artifactDigest = optionalSingleLine(env, "CAREPOINT_RELEASE_ARTIFACT_DIGEST", 80);

  if (version && !RELEASE_VERSION.test(version)) {
    throw new Error("CAREPOINT_RELEASE_VERSION must use only letters, digits, dot, underscore, plus or hyphen and be at most 64 characters.");
  }
  if (sha && !FULL_GIT_SHA.test(sha)) {
    throw new Error("CAREPOINT_RELEASE_SHA must be the full 40-hex Git commit SHA.");
  }
  if (artifactDigest && !SHA256_DIGEST.test(artifactDigest)) {
    throw new Error("CAREPOINT_RELEASE_ARTIFACT_DIGEST must be an immutable sha256:<64-hex> digest when supplied.");
  }

  return {
    version,
    sha: sha?.toLowerCase() ?? null,
    sourceRef,
    buildId,
    artifactDigest: artifactDigest?.toLowerCase() ?? null,
  };
}

export function assertProductionReleaseIdentityReady(env: NodeJS.ProcessEnv = process.env): ReleaseIdentity {
  const identity = releaseIdentity(env);
  if (env.NODE_ENV !== "production") return identity;

  if (!identity.version) {
    throw new Error("Production requires CAREPOINT_RELEASE_VERSION for exact Release Candidate identification.");
  }
  if (!identity.sha) {
    throw new Error("Production requires CAREPOINT_RELEASE_SHA set to the exact full 40-hex validated Git commit SHA.");
  }

  return identity;
}
