import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { SmartBackendService } = require("../dist/modules/smart/smart-backend.service.js");
const { tokenHash } = require("@carepoint/identity");

// Ephemeral keys and in-memory collaborators only. Never print assertions,
// access tokens, private keys, or assertion payloads in CI output.
const trustedKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const untrustedKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const clientId = "r6-registered-backend";
const keyId = "r6-registered-key";
const tokenAudience = "https://carepoint.example/api/v1/smart/token";
const revokeAudience = "https://carepoint.example/api/v1/smart/revoke";
const assertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const allowedScope = "system/Patient.rs";

function fixture({ inconsistentRegistry = false } = {}) {
  const rows = new Map();
  const auditEvents = [];
  const writes = [];
  const client = {
    clientId: inconsistentRegistry ? "different-registered-client" : clientId,
    allowedScopes: [allowedScope],
    jwks: { keys: [{ ...trustedKeys.publicKey.export({ format: "jwk" }), kid: keyId, alg: "RS384" }] },
  };
  const config = {
    backendClient: (id) => id === clientId ? client : null,
    tokenEndpointUrl: () => tokenAudience,
    revocationEndpointUrl: () => revokeAudience,
  };
  const redis = {
    async setEphemeralIfAbsent(key, value, ttl) {
      if (rows.has(key)) return false;
      rows.set(key, value);
      writes.push({ key, ttl });
      return true;
    },
    async setEphemeral(key, value, ttl) {
      rows.set(key, value);
      writes.push({ key, ttl });
    },
    async getEphemeral(key) { return rows.get(key) ?? null; },
    async deleteEphemeral(key) { rows.delete(key); },
  };
  const tokens = { tokenKey: (value) => `r6:access:${tokenHash(value)}` };
  const service = new SmartBackendService(config, redis, { async write(event) { auditEvents.push(event); } }, tokens);
  return { service, rows, writes, auditEvents, tokens };
}

function assertion({ claims = {}, header = {}, signingKey = trustedKeys.privateKey, audience = tokenAudience } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signingInput = `${encode({ alg: "RS384", kid: keyId, typ: "JWT", ...header })}.${encode({
    iss: clientId, sub: clientId, aud: audience, iat: now, exp: now + 240,
    jti: randomBytes(24).toString("base64url"), ...claims,
  })}`;
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput, "ascii");
  signer.end();
  return `${signingInput}.${signer.sign(signingKey).toString("base64url")}`;
}

function input(jwt = assertion(), extra = {}) {
  return { grant_type: "client_credentials", client_id: clientId, scope: allowedScope,
    client_assertion_type: assertionType, client_assertion: jwt, ...extra };
}

function oauthFailure(expected = "invalid_client", description) {
  return (error) => {
    const payload = typeof error?.getResponse === "function" ? error.getResponse() : null;
    assert.equal(payload?.error, expected, "Expected an OAuth rejection");
    if (description) assert.match(payload.error_description, description);
    return true;
  };
}

async function rejected(jwt, extra = {}, options = {}) {
  const f = fixture(options);
  await assert.rejects(f.service.exchange(input(jwt, extra)), oauthFailure(options.error, options.description));
  assert.equal(f.rows.size, 0, "Rejected authentication must not persist replay or access state");
  assert.equal(f.auditEvents.length, 0, "Rejected authentication must not be recorded as successful");
}

test("R6 SMART accepts registered signed assertions with bounded replay and token state", async () => {
  const f = fixture();
  const result = await f.service.exchange(input());
  assert.equal(result.token_type, "Bearer");
  assert.equal(result.expires_in, 300);
  assert.equal(result.scope, allowedScope);
  const stored = JSON.parse(f.rows.get(f.tokens.tokenKey(result.access_token)));
  assert.equal(stored.clientId, clientId);
  assert.equal(stored.tokenKind, "system");
  assert.equal(f.writes.length, 2);
  assert.ok(f.writes.every(({ ttl }) => Number.isInteger(ttl) && ttl > 0 && ttl <= 300));
  assert.ok(f.auditEvents.every((event) => event.objectId === clientId));
});

test("R6 SMART verifies the registered signature before interpreting identity claims", async () => {
  await rejected(assertion({ signingKey: untrustedKeys.privateKey, claims: { iss: "untrusted", sub: "untrusted" } }), {}, {
    description: /signature is invalid/,
  });
});

test("R6 SMART rejects a registry lookup inconsistent with the requested client", async () => {
  await rejected(assertion(), {}, { inconsistentRegistry: true });
});

test("R6 SMART rejects a signed issuer different from the registered identity", async () => {
  await rejected(assertion({ claims: { iss: "different-client" } }));
});

test("R6 SMART rejects a signed subject different from the registered identity", async () => {
  await rejected(assertion({ claims: { sub: "different-client" } }));
});

test("R6 SMART rejects matching but unregistered issuer and subject values", async () => {
  await rejected(assertion({ claims: { iss: "different-client", sub: "different-client" } }));
});

test("R6 SMART rejects the wrong audience", async () => {
  await rejected(assertion({ audience: revokeAudience }));
});

test("R6 SMART preserves supported audience arrays", async () => {
  const f = fixture();
  const result = await f.service.exchange(input(assertion({ claims: { aud: [tokenAudience] } })));
  assert.equal(result.token_type, "Bearer");
});

test("R6 SMART rejects expired or missing expiration values", async () => {
  await rejected(assertion({ claims: { exp: Math.floor(Date.now() / 1000) - 1 } }));
  await rejected(assertion({ claims: { exp: undefined } }));
});

test("R6 SMART rejects future, stale, or overlong assertions", async () => {
  const now = Math.floor(Date.now() / 1000);
  await rejected(assertion({ claims: { iat: now + 120, exp: now + 240 } }));
  await rejected(assertion({ claims: { iat: now - 600, exp: now + 120 } }));
  await rejected(assertion({ claims: { iat: now, exp: now + 600 } }));
});

test("R6 SMART rejects short replay identifiers", async () => {
  await rejected(assertion({ claims: { jti: "short" } }));
});

test("R6 SMART rejects unsupported algorithms and token types", async () => {
  await rejected(assertion({ header: { alg: "HS256" } }));
  await rejected(assertion({ header: { typ: "different-type" } }));
});

test("R6 SMART rejects unknown keys and request-supplied key material", async () => {
  await rejected(assertion({ header: { kid: "unregistered-key" } }));
  for (const name of ["jku", "jwk", "x5u"]) {
    await rejected(assertion({ header: { [name]: "untrusted-key-source" } }));
  }
});

test("R6 SMART rejects invalid signatures without consuming replay state", async () => {
  await rejected(assertion({ signingKey: untrustedKeys.privateKey }));
});

test("R6 SMART rejects unknown clients, malformed assertions, and invalid assertion types", async () => {
  await rejected(assertion(), { client_id: "unregistered-client" });
  await rejected("not-a-compact-assertion");
  await rejected(assertion(), { client_assertion_type: "different-type" });
});

test("R6 SMART rejects duplicated client fields", async () => {
  await rejected(assertion(), { client_id: [clientId, clientId] }, { error: "invalid_request" });
});

test("R6 SMART keeps one-time assertion replay protection", async () => {
  const f = fixture();
  const request = input();
  await f.service.exchange(request);
  const before = f.rows.size;
  await assert.rejects(f.service.exchange(request), oauthFailure("invalid_client", /already used/));
  assert.equal(f.rows.size, before);
  assert.equal(f.auditEvents.filter((event) => event.action === "SMART_BACKEND_ACCESS_TOKEN_ISSUED").length, 1);
});

test("R6 SMART does not issue tokens for unregistered scopes", async () => {
  const f = fixture();
  await assert.rejects(f.service.exchange(input(assertion(), { scope: "system/Observation.rs" })), oauthFailure("invalid_scope"));
  assert.equal(f.auditEvents.filter((event) => event.action === "SMART_BACKEND_ACCESS_TOKEN_ISSUED").length, 0);
});

test("R6 SMART revocation requires a new assertion for the revocation audience", async () => {
  const f = fixture();
  const result = await f.service.exchange(input());
  const key = f.tokens.tokenKey(result.access_token);
  await assert.rejects(f.service.revoke(input(assertion(), { token: result.access_token })), oauthFailure());
  assert.ok(f.rows.has(key));
  await f.service.revoke(input(assertion({ audience: revokeAudience }), { token: result.access_token }));
  assert.equal(f.rows.has(key), false);
});

test("R6 SMART invalid revocation signatures cannot remove access state", async () => {
  const f = fixture();
  const result = await f.service.exchange(input());
  await assert.rejects(f.service.revoke(input(assertion({ audience: revokeAudience, signingKey: untrustedKeys.privateKey }), {
    token: result.access_token,
  })), oauthFailure("invalid_client", /signature is invalid/));
  assert.ok(f.rows.has(f.tokens.tokenKey(result.access_token)));
});
