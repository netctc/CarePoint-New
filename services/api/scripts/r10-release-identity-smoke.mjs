import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionReleaseIdentityReady,
  releaseIdentity,
} = require("../dist/infrastructure/release/release-identity.js");

const RELEASE_KEYS = [
  "CAREPOINT_RELEASE_VERSION",
  "CAREPOINT_RELEASE_SHA",
  "CAREPOINT_RELEASE_SOURCE_REF",
  "CAREPOINT_RELEASE_BUILD_ID",
  "CAREPOINT_RELEASE_ARTIFACT_DIGEST",
];

function cleanReleaseEnv() {
  for (const name of RELEASE_KEYS) delete process.env[name];
}

const original = { ...process.env };

try {
  cleanReleaseEnv();
  process.env.NODE_ENV = "test";
  assert.deepEqual(releaseIdentity(process.env), {
    version: null,
    sha: null,
    sourceRef: null,
    buildId: null,
    artifactDigest: null,
  });
  assert.doesNotThrow(() => assertProductionReleaseIdentityReady(process.env));

  cleanReleaseEnv();
  process.env.NODE_ENV = "production";
  assert.throws(
    () => assertProductionReleaseIdentityReady(process.env),
    /CAREPOINT_RELEASE_VERSION/,
  );

  process.env.CAREPOINT_RELEASE_VERSION = "Release 1";
  assert.throws(
    () => assertProductionReleaseIdentityReady(process.env),
    /CAREPOINT_RELEASE_VERSION must use only/,
  );

  process.env.CAREPOINT_RELEASE_VERSION = "1.0.0-rc.1";
  assert.throws(
    () => assertProductionReleaseIdentityReady(process.env),
    /CAREPOINT_RELEASE_SHA/,
  );

  process.env.CAREPOINT_RELEASE_SHA = "abc123";
  assert.throws(
    () => assertProductionReleaseIdentityReady(process.env),
    /full 40-hex Git commit SHA/,
  );

  process.env.CAREPOINT_RELEASE_SHA = "DDA4EB6D938EC6A2E02C86B126420A695B64ED73";
  process.env.CAREPOINT_RELEASE_SOURCE_REF = "release/release-1-integration-go-live-readiness";
  process.env.CAREPOINT_RELEASE_BUILD_ID = "gha:release-candidate:example";
  process.env.CAREPOINT_RELEASE_ARTIFACT_DIGEST = `sha256:${"a".repeat(64)}`;

  const identity = assertProductionReleaseIdentityReady(process.env);
  assert.deepEqual(identity, {
    version: "1.0.0-rc.1",
    sha: "dda4eb6d938ec6a2e02c86b126420a695b64ed73",
    sourceRef: "release/release-1-integration-go-live-readiness",
    buildId: "gha:release-candidate:example",
    artifactDigest: `sha256:${"a".repeat(64)}`,
  });

  process.env.CAREPOINT_RELEASE_SOURCE_REF = "bad\nref";
  assert.throws(
    () => assertProductionReleaseIdentityReady(process.env),
    /single-line value/,
  );

  process.env.CAREPOINT_RELEASE_SOURCE_REF = "release/release-1-integration-go-live-readiness";
  process.env.CAREPOINT_RELEASE_ARTIFACT_DIGEST = "sha256:not-a-digest";
  assert.throws(
    () => assertProductionReleaseIdentityReady(process.env),
    /immutable sha256/,
  );

  console.log("R10 release identity acceptance passed");
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key];
  }
  Object.assign(process.env, original);
}
