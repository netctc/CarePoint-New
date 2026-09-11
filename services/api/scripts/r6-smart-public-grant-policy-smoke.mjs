import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { SmartOAuthService } = require("../dist/modules/smart/smart-oauth.service.js");
const { parseSmartPublicGrant, normalizeSmartPublicGrantFields } = require("../dist/modules/smart/smart-public-grant-policy.js");
const { tokenHash } = require("@carepoint/identity");
const clientId = "r6-public-client";
const otherClientId = "r6-other-client";
const redirectUri = "https://client.example/callback";
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const scopes = ["launch/patient", "patient/Patient.rs", "offline_access"];

function fixture({ active = true } = {}) {
  const rows = new Map();
  const events = [];
  const reads = [];
  const tokens = {
    tokenKey: (value) => `r6:access:${tokenHash(value)}`,
    refreshFamilyKey: (value) => `r6:family:${value}`,
  };
  const config = { client: (id) => [clientId, otherClientId].includes(id) ? { clientId: id } : null };
  const redis = {
    async getEphemeral(key) { reads.push(key); return rows.get(key) ?? null; },
    async setEphemeral(key, value) { rows.set(key, value); },
    async deleteEphemeral(key) { rows.delete(key); },
    async consumeEphemeral(key) { const value = rows.get(key) ?? null; rows.delete(key); return value; },
    async consumeAndMarkEphemeral(key, usedKey) {
      if (rows.has(key)) {
        const value = rows.get(key); rows.delete(key); rows.set(usedKey, value);
        return { status: "consumed", value };
      }
      if (rows.has(usedKey)) return { status: "reused", value: rows.get(usedKey) };
      return { status: "missing", value: null };
    },
  };
  const prisma = { user: { async findUnique() {
    return { role: "PATIENT", status: active ? "ACTIVE" : "SUSPENDED", patientProfile: { id: "r6-patient" } };
  } } };
  const oidc = { signIdToken(input) { return JSON.stringify({ nonce: input.nonce, clientId: input.clientId }); } };
  const service = new SmartOAuthService(config, redis, prisma, { async write(event) { events.push(event); } }, tokens, oidc);
  function codeRequest(overrides = {}) {
    const code = randomBytes(32).toString("base64url");
    rows.set(`carepoint:smart:code:${tokenHash(code)}`, JSON.stringify({
      clientId, userId: "r6-user", patientId: "r6-patient", redirectUri,
      scopes, codeChallenge: challenge, nonce: null, authTime: Math.floor(Date.now() / 1000),
      expiresAt: new Date(Date.now() + 180000).toISOString(), ...overrides,
    }));
    return { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier };
  }
  function refreshRequest(overrides = {}) {
    const token = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const familyId = `r6-family-${randomBytes(8).toString("hex")}`;
    rows.set(`carepoint:smart:refresh:${tokenHash(token)}`, JSON.stringify({
      refreshId: "r6-refresh", familyId, clientId, userId: "r6-user", patientId: "r6-patient", scopes, expiresAt, ...overrides,
    }));
    rows.set(tokens.refreshFamilyKey(familyId), JSON.stringify({
      familyId, clientId, userId: "r6-user", patientId: "r6-patient", scopes, expiresAt, createdAt: new Date().toISOString(),
    }));
    return { request: { grant_type: "refresh_token", client_id: clientId, refresh_token: token }, familyId };
  }
  return { service, rows, events, reads, codeRequest, refreshRequest, tokens };
}

function rejection(errorCode) {
  return (error) => {
    assert.equal(error?.getStatus?.(), 400, "Expected a controlled OAuth rejection, not an internal error");
    if (errorCode) assert.equal(error.getResponse()?.error, errorCode);
    return true;
  };
}
function issued(f) { return f.events.filter((event) => event.action === "SMART_ACCESS_TOKEN_ISSUED").length; }

// Tests use synthetic state and real PKCE/token fingerprints; never log credentials.
test("R6 public grants retain both canonical protocol variants", () => {
  for (const grant_type of ["authorization_code", "refresh_token"]) assert.equal(parseSmartPublicGrant({ grant_type }), grant_type);
});

test("R6 public grants reject non-object request bodies", async () => {
  for (const input of [null, undefined, [], true, "authorization_code"]) {
    const f = fixture();
    await assert.rejects(f.service.exchange(input), rejection("invalid_request"));
    assert.equal(f.reads.length, 0);
  }
});

test("R6 public grants reject missing, non-string, and duplicated grant selectors", async () => {
  for (const grant_type of [undefined, null, "", 7, {}, ["authorization_code"], ["authorization_code", "refresh_token"]]) {
    await assert.rejects(fixture().service.exchange({ grant_type, client_id: clientId }), rejection("invalid_request"));
  }
});

test("R6 public grants reject unknown, backend, noncanonical, and method-like selectors", async () => {
  for (const grant_type of ["client_credentials", "password", "authorization_code ", " refresh_token", "REFRESH_TOKEN", "revoke", "constructor", "__proto__"]) {
    const f = fixture();
    await assert.rejects(f.service.exchange({ grant_type, client_id: clientId }), rejection("unsupported_grant_type"));
    assert.equal(issued(f), 0);
  }
});

test("R6 both public grants enforce registered client validation before entering a handler", async () => {
  for (const grant_type of ["authorization_code", "refresh_token"]) {
    const f = fixture();
    let entered = false;
    f.service.exchangeAuthorizationCode = async () => { entered = true; return {}; };
    f.service.exchangeRefreshToken = async () => { entered = true; return {}; };
    const request = grant_type === "authorization_code" ? f.codeRequest() : f.refreshRequest().request;
    await assert.rejects(f.service.exchange({ ...request, client_id: "unregistered" }), rejection("invalid_client"));
    assert.equal(entered, false);
  }
});

test("R6 public grants reject duplicated credential fields", async () => {
  for (const field of ["client_id", "code", "redirect_uri", "code_verifier"]) {
    const f = fixture(); const request = f.codeRequest(); request[field] = [request[field], request[field]];
    await assert.rejects(f.service.exchange(request), rejection("invalid_request"));
    assert.equal(f.reads.length, 0);
  }
});

test("R6 public grants bound credential field lengths before state access", async () => {
  for (const [field, length] of [["client_id", 129], ["code", 501], ["redirect_uri", 1001], ["code_verifier", 129]]) {
    const f = fixture(); const request = f.codeRequest(); request[field] = "x".repeat(length);
    await assert.rejects(f.service.exchange(request), rejection("invalid_request"));
    assert.equal(f.reads.length, 0);
  }
});

test("R6 code grants reject mixed refresh or backend credentials without consuming the code", async () => {
  for (const field of ["refresh_token", "client_assertion", "client_assertion_type"]) {
    const f = fixture(); const request = f.codeRequest();
    await assert.rejects(f.service.exchange({ ...request, [field]: "synthetic-extra" }), rejection("invalid_request"));
    assert.equal(f.reads.length, 0); assert.equal(issued(f), 0);
  }
});

test("R6 refresh grants reject mixed code and backend credential fields", async () => {
  for (const field of ["code", "code_verifier", "redirect_uri", "client_assertion", "client_assertion_type"]) {
    const f = fixture(); const { request } = f.refreshRequest();
    await assert.rejects(f.service.exchange({ ...request, [field]: "synthetic-extra" }), rejection("invalid_request"));
    assert.equal(f.reads.length, 0); assert.equal(issued(f), 0);
  }
});

test("R6 normalized grant fields are immutable and omit unrelated extension parameters", () => {
  const f = fixture(); const input = { ...f.codeRequest(), extension: "ignored" };
  const fields = normalizeSmartPublicGrantFields(input, parseSmartPublicGrant(input));
  assert.ok(Object.isFrozen(fields)); assert.equal(fields.extension, undefined);
  const original = fields.code; input.code = "changed"; assert.equal(fields.code, original);
});

test("R6 code exchange retains RFC 7636 S256 and emits tokens for valid persisted grants", async () => {
  assert.equal(createHash("sha256").update(verifier, "ascii").digest("base64url"), challenge);
  const f = fixture(); const result = await f.service.exchange(f.codeRequest());
  assert.equal(result.token_type, "Bearer"); assert.equal(result.expires_in, 900); assert.equal(result.patient, "r6-patient");
  assert.ok(result.refresh_token); assert.equal(issued(f), 1);
});

test("R6 code exchange rejects the wrong PKCE verifier without issuing tokens", async () => {
  const f = fixture(); const request = f.codeRequest();
  await assert.rejects(f.service.exchange({ ...request, code_verifier: "a".repeat(43) }), rejection("invalid_grant"));
  assert.equal(issued(f), 0); assert.ok(f.rows.has(`carepoint:smart:code:${tokenHash(request.code)}`));
});

test("R6 code exchange rejects missing and malformed PKCE verifiers", async () => {
  for (const code_verifier of [undefined, "short", "!".repeat(43)]) {
    const f = fixture(); await assert.rejects(f.service.exchange({ ...f.codeRequest(), code_verifier }), rejection());
    assert.equal(issued(f), 0);
  }
});

test("R6 code exchange enforces redirect binding", async () => {
  const f = fixture();
  await assert.rejects(f.service.exchange({ ...f.codeRequest(), redirect_uri: "https://other.example/callback" }), rejection("invalid_grant"));
  assert.equal(issued(f), 0);
});

test("R6 code exchange enforces persisted client binding", async () => {
  const f = fixture();
  await assert.rejects(f.service.exchange({ ...f.codeRequest(), client_id: otherClientId }), rejection("invalid_grant"));
  assert.equal(issued(f), 0);
});

test("R6 code exchange rejects expired and missing state", async () => {
  const f = fixture();
  await assert.rejects(f.service.exchange(f.codeRequest({ expiresAt: new Date(Date.now() - 1000).toISOString() })), rejection("invalid_grant"));
  const missing = f.codeRequest(); f.rows.clear();
  await assert.rejects(f.service.exchange(missing), rejection("invalid_grant")); assert.equal(issued(f), 0);
});

test("R6 code exchange preserves one-time consumption", async () => {
  const f = fixture(); const request = f.codeRequest();
  await f.service.exchange(request);
  await assert.rejects(f.service.exchange(request), rejection("invalid_grant")); assert.equal(issued(f), 1);
});

test("R6 refresh exchange rotates a valid token and preserves granted scope", async () => {
  const f = fixture(); const { request } = f.refreshRequest();
  const result = await f.service.exchange(request);
  assert.equal(result.scope, scopes.join(" ")); assert.ok(result.refresh_token);
  assert.notEqual(result.refresh_token, request.refresh_token); assert.equal(issued(f), 1);
});

test("R6 refresh reuse revokes the family and blocks its rotated credential", async () => {
  const f = fixture(); const { request, familyId } = f.refreshRequest();
  const result = await f.service.exchange(request);
  await assert.rejects(f.service.exchange(request), rejection("invalid_grant"));
  assert.equal(f.rows.has(f.tokens.refreshFamilyKey(familyId)), false);
  await assert.rejects(f.service.exchange({ ...request, refresh_token: result.refresh_token }), rejection("invalid_grant"));
  assert.equal(issued(f), 1);
});

test("R6 refresh exchange rejects another registered client's credential", async () => {
  const f = fixture(); const { request } = f.refreshRequest();
  await assert.rejects(f.service.exchange({ ...request, client_id: otherClientId }), rejection("invalid_grant"));
  assert.equal(issued(f), 0);
});

test("R6 refresh exchange rejects expired, missing, and revoked state", async () => {
  const f = fixture(); const expired = f.refreshRequest({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(f.service.exchange(expired.request), rejection("invalid_grant"));
  const revoked = f.refreshRequest(); f.rows.delete(f.tokens.refreshFamilyKey(revoked.familyId));
  await assert.rejects(f.service.exchange(revoked.request), rejection("invalid_grant"));
  const missing = f.refreshRequest(); f.rows.clear();
  await assert.rejects(f.service.exchange(missing.request), rejection("invalid_grant")); assert.equal(issued(f), 0);
});

test("R6 refresh exchange rejects inactive patients", async () => {
  const f = fixture({ active: false });
  await assert.rejects(f.service.exchange(f.refreshRequest().request), rejection("invalid_grant")); assert.equal(issued(f), 0);
});

test("R6 refresh exchange cannot increase the original consent scopes", async () => {
  const f = fixture(); const { request } = f.refreshRequest();
  await assert.rejects(f.service.exchange({ ...request, scope: "launch/patient patient/Observation.rs offline_access" }), rejection("invalid_scope"));
  assert.equal(issued(f), 0);
});

test("R6 explicit scope narrowing closes offline renewal when offline_access is removed", async () => {
  const f = fixture(); const { request, familyId } = f.refreshRequest();
  const result = await f.service.exchange({ ...request, scope: "launch/patient patient/Patient.rs" });
  assert.equal(result.refresh_token, undefined); assert.equal(f.rows.has(f.tokens.refreshFamilyKey(familyId)), false);
});

test("R6 missing required grant credentials cannot fall through to the other handler", async () => {
  for (const input of [{ grant_type: "authorization_code", client_id: clientId }, { grant_type: "refresh_token", client_id: clientId }]) {
    const f = fixture(); await assert.rejects(f.service.exchange(input), rejection("invalid_request")); assert.equal(issued(f), 0);
  }
});

test("R6 OIDC metadata is retained from the persisted authorization grant", async () => {
  const f = fixture(); const result = await f.service.exchange(f.codeRequest({ scopes: [...scopes, "openid", "fhirUser"], nonce: "r6-persisted-nonce" }));
  assert.deepEqual(JSON.parse(result.id_token), { nonce: "r6-persisted-nonce", clientId });
});
