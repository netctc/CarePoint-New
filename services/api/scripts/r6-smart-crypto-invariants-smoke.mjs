import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, randomBytes, scryptSync, verify } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { SmartOAuthService } = require("../dist/modules/smart/smart-oauth.service.js");
const { SmartBrowserService } = require("../dist/modules/smart/smart-browser.service.js");
const { SmartOidcService } = require("../dist/modules/smart/smart-oidc.service.js");
const { tokenHash, hashPassword, hashPasswordAsync, verifyPassword, verifyPasswordAsync, totpCode, verifyTotp } = require("@carepoint/identity");

const clientId = "r6-invariant-client";
const redirectUri = "https://client.example/callback";
const issuer = "https://carepoint.example";
const fhirBase = `${issuer}/fhir/R4`;
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const scopes = ["launch/patient", "patient/Patient.rs", "openid", "fhirUser"];

// Synthetic collaborators isolate state; all cryptographic operations use real application code.
function fixture() {
  const rows = new Map(); const events = [];
  const config = {
    client: (id) => id === clientId ? { name: "Synthetic client", redirectUris: [redirectUri], allowedScopes: scopes } : null,
    issuerUrl: () => issuer, fhirBaseUrl: () => fhirBase,
  };
  const redis = {
    async getEphemeral(key) { return rows.get(key) ?? null; },
    async setEphemeral(key, value) { rows.set(key, value); },
    async deleteEphemeral(key) { rows.delete(key); },
    async consumeEphemeral(key) { const value = rows.get(key) ?? null; rows.delete(key); return value; },
  };
  const audit = { async write(event) { events.push(event); } };
  const prisma = { patientProfile: { async findUnique() { return { id: "r6-patient" }; } } };
  const oidc = new SmartOidcService(config);
  // Use an ephemeral test key without depending on or replacing production configuration.
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  oidc.privateKey = pair.privateKey; oidc.publicKey = pair.publicKey; oidc.keyId = "r6-invariant-key";
  const tokens = { tokenKey: (value) => `r6:access:${tokenHash(value)}` };
  const service = new SmartOAuthService(config, redis, prisma, audit, tokens, oidc);
  const identity = {
    async login() { return { accessToken: "synthetic-session", sessionId: "r6-session" }; },
    async validateAccessToken() { return { accountId: "r6-user", role: "PATIENT" }; },
    async revokeSession() {},
  };
  const browser = new SmartBrowserService(service, identity, prisma, redis, audit);
  const request = {
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    aud: fhirBase, state: "synthetic-state", scope: scopes.join(" "),
    code_challenge_method: "S256", code_challenge: challenge, nonce: "synthetic-nonce",
  };
  return { service, browser, oidc, rows, events, request };
}

function rejected(errorCode) {
  return (error) => { assert.equal(error.getStatus(), 400); assert.equal(error.getResponse().error, errorCode); return true; };
}

function checkIdToken(value, oidc) {
  const [header, payload, signature] = value.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString("utf8")).alg, "RS256");
  const publicKey = createPublicKey({ key: oidc.jwks().keys[0], format: "jwk" });
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`, "ascii"), publicKey, Buffer.from(signature, "base64url")), true);
  assert.equal(claims.iss, issuer); assert.equal(claims.aud, clientId);
  assert.equal(claims.fhirUser, `${fhirBase}/Patient/r6-patient`);
  assert.equal(claims.nonce, "synthetic-nonce");
  assert.equal(claims.exp - claims.iat, 900);
  return claims;
}

test("R6 token fingerprints retain the SHA-256 reference vector", () => {
  assert.equal(tokenHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("R6 existing scrypt records remain valid for synchronous and asynchronous verification", async () => {
  const password = randomBytes(24).toString("base64url");
  const salt = Buffer.alloc(16, 7);
  const stored = `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 32).toString("base64url")}`;
  assert.equal(verifyPassword(password, stored), true);
  assert.equal(await verifyPasswordAsync(password, stored), true);
  assert.equal(await verifyPasswordAsync(`${password}x`, stored), false);
});

test("R6 password hashing retains random salt, storage format and cross-verification", async () => {
  const password = randomBytes(24).toString("base64url");
  const first = hashPassword(password); const second = await hashPasswordAsync(password);
  assert.notEqual(first, second);
  for (const stored of [first, second]) {
    const [algorithm, salt, digest] = stored.split("$");
    assert.equal(algorithm, "scrypt");
    assert.equal(Buffer.from(salt, "base64url").length, 16);
    assert.equal(Buffer.from(digest, "base64url").length, 32);
    assert.equal(verifyPassword(password, stored), true);
    assert.equal(await verifyPasswordAsync(password, stored), true);
  }
});

test("R6 six-digit TOTP retains the RFC reference result", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(secret, 59000), "287082");
  assert.equal(verifyTotp(secret, "287082", 59000), true);
  assert.equal(verifyTotp(secret, "invalid", 59000), false);
});

test("R6 PKCE challenge computation retains the RFC S256 vector", () => {
  assert.equal(fixture().service.pkceChallenge(verifier), challenge);
});

test("R6 OIDC output retains verifiable RS256 and stable client-bound subject", () => {
  const f = fixture();
  const input = { userId: "r6-user", patientId: "r6-patient", clientId, nonce: "synthetic-nonce", authTime: 100, expiresInSeconds: 900 };
  const first = checkIdToken(f.oidc.signIdToken(input), f.oidc);
  const second = checkIdToken(f.oidc.signIdToken(input), f.oidc);
  assert.equal(first.sub, second.sub); assert.notEqual(first.jti, second.jti);
  const other = JSON.parse(Buffer.from(f.oidc.signIdToken({ ...input, clientId: "other" }).split(".")[1], "base64url").toString("utf8"));
  assert.notEqual(first.sub, other.sub);
});

test("R6 invalid client errors remain terminal and issue no credential", async () => {
  const f = fixture();
  await assert.rejects(f.service.exchange({ grant_type: "authorization_code", client_id: "unknown", code: "synthetic", redirect_uri: redirectUri, code_verifier: verifier }), rejected("invalid_client"));
  assert.equal(f.rows.size, 0); assert.equal(f.events.length, 0);
});

test("R6 browser transaction stores protocol state, not a service or login credential", async () => {
  const f = fixture(); const view = await f.browser.begin(f.request);
  assert.equal(view.clientName, "Synthetic client");
  const raw = f.rows.get(`carepoint:smart:browser:${tokenHash(view.transactionId)}`);
  const stored = JSON.parse(raw);
  assert.deepEqual(Object.keys(stored).sort(), ["request", "expiresAt", "userId", "patientId", "authTime", "mfaChallengeId"].sort());
  assert.equal(stored.userId, null); assert.equal(stored.patientId, null);
  assert.equal(raw.includes(view.transactionId), false);
});

test("R6 browser denial preserves state and never issues an authorization code", async () => {
  const f = fixture(); const view = await f.browser.begin(f.request);
  await f.browser.login(view.transactionId, "patient@example.test", "synthetic-password-only");
  const result = await f.browser.decide(view.transactionId, "deny");
  const callback = new URL(result.redirectTo);
  assert.equal(callback.searchParams.get("error"), "access_denied");
  assert.equal(callback.searchParams.get("state"), f.request.state);
  assert.equal(callback.searchParams.has("code"), false);
  assert.equal(f.events.some((event) => event.action === "SMART_AUTHORIZATION_CODE_ISSUED"), false);
});

test("R6 browser approval retains one-time exchange, PKCE and signed OIDC output", async () => {
  const f = fixture(); const view = await f.browser.begin(f.request);
  await f.browser.login(view.transactionId, "patient@example.test", "synthetic-password-only");
  const result = await f.browser.decide(view.transactionId, "approve");
  const callback = new URL(result.redirectTo);
  assert.equal(callback.searchParams.get("state"), f.request.state);
  const request = { grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code: callback.searchParams.get("code"), code_verifier: verifier };
  const response = await f.service.exchange(request);
  assert.equal(response.token_type, "Bearer"); assert.equal(response.expires_in, 900);
  checkIdToken(response.id_token, f.oidc);
  await assert.rejects(f.service.exchange(request), rejected("invalid_grant"));
  assert.equal(f.events.filter((event) => event.action === "SMART_ACCESS_TOKEN_ISSUED").length, 1);
  const persisted = JSON.stringify([...f.rows.values(), ...f.events]);
  assert.equal(persisted.includes("synthetic-password-only"), false);
  assert.equal(persisted.includes("synthetic-session"), false);
});
