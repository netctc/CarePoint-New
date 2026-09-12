import { totpCode } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const password = process.env.SLICE6_PATIENT_PASSWORD;
if (!password) throw new Error("SLICE6_PATIENT_PASSWORD is required for Patient P1 acceptance.");
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `patient-p1-${stamp}@carepoint.test`;
const endpointRef = `p1-endpoint-${stamp}`;

function assert(ok, message) { if (!ok) throw new Error(message); }

async function call(path, { method = "GET", token, body, expected } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (expected !== undefined) {
    const values = Array.isArray(expected) ? expected : [expected];
    assert(values.includes(response.status), `${method} ${path} expected ${values.join("/")} but got ${response.status}: ${text}`);
  } else {
    assert(response.ok, `${method} ${path} failed ${response.status}: ${text}`);
  }
  return { response, payload, text };
}

await call("/iam/register/patient", {
  method: "POST",
  body: { email, password, firstName: "Patient", lastName: "P1" },
  expected: 201,
});

const firstLogin = (await call("/iam/login", { method: "POST", body: { email, password }, expected: 201 })).payload;
assert(firstLogin.accessToken && firstLogin.refreshToken && firstLogin.sessionId, "P1 first login did not issue a complete session.");
const token = firstLogin.accessToken;
const me = (await call("/iam/accounts/me", { token, expected: 200 })).payload;
assert(me.email === email && me.role === "PATIENT" && me.status === "ACTIVE", "P1 patient account boundary is incorrect.");

const secondLogin = (await call("/iam/login", { method: "POST", body: { email, password }, expected: 201 })).payload;
assert(secondLogin.sessionId && secondLogin.sessionId !== firstLogin.sessionId, "P1 second login did not create an independent session.");
let sessions = (await call("/iam/sessions", { token, expected: 200 })).payload;
assert(Array.isArray(sessions) && sessions.some((item) => item.id === firstLogin.sessionId && item.current === true && item.active === true), "P1 current session marker is missing.");
assert(sessions.some((item) => item.id === secondLogin.sessionId && item.current === false && item.active === true), "P1 secondary session was not visible.");
await call(`/iam/sessions/${secondLogin.sessionId}`, { method: "DELETE", token, expected: 200 });
sessions = (await call("/iam/sessions", { token, expected: 200 })).payload;
assert(sessions.some((item) => item.id === secondLogin.sessionId && item.active === false), "P1 secondary session revocation did not persist.");

let mfa = (await call("/iam/mfa/status", { token, expected: 200 })).payload;
assert(mfa.enabled === false, "P1 fresh patient unexpectedly has MFA enabled.");
const enrollment = (await call("/iam/mfa/enroll", { method: "POST", token, body: {}, expected: 201 })).payload;
assert(enrollment.secret && enrollment.otpauthUri, "P1 MFA enrollment did not return setup material.");
await call("/iam/mfa/confirm", { method: "POST", token, body: { code: totpCode(enrollment.secret) }, expected: 201 });
mfa = (await call("/iam/mfa/status", { token, expected: 200 })).payload;
assert(mfa.enabled === true && mfa.enabledAt, "P1 MFA confirmation did not become durable.");
const reenroll = await call("/iam/mfa/enroll", { method: "POST", token, body: {}, expected: 409 });
assert(/already enabled/i.test(reenroll.text), "P1 active MFA re-enrollment guard is missing.");
mfa = (await call("/iam/mfa/status", { token, expected: 200 })).payload;
assert(mfa.enabled === true, "P1 rejected MFA re-enrollment weakened the existing enrollment.");

let prefs = (await call("/notifications/preferences", { token, expected: 200 })).payload;
assert(prefs.inAppEnabled === true, "P1 notification preferences were not provisioned.");
prefs = (await call("/notifications/preferences", {
  method: "PATCH",
  token,
  body: { locale: "es", inAppEnabled: true, pushEnabled: false, emailEnabled: true, smsEnabled: true },
  expected: 200,
})).payload;
assert(prefs.locale === "es" && prefs.smsEnabled === true && prefs.pushEnabled === false, "P1 notification preference update did not round-trip.");
await call("/notifications/preferences", { method: "PATCH", token, body: { locale: "xx" }, expected: 400 });

const endpoint = (await call("/notifications/endpoints", {
  method: "POST",
  token,
  body: { channel: "PUSH", externalEndpointRef: endpointRef },
  expected: 201,
})).payload;
assert(endpoint.id && endpoint.active === true && endpoint.externalEndpointReferenceStoredExternally === true, "P1 notification endpoint registration failed.");
assert(!Object.prototype.hasOwnProperty.call(endpoint, "externalEndpointRef") && !JSON.stringify(endpoint).includes(endpointRef), "P1 endpoint presentation leaked the external destination reference.");
let endpoints = (await call("/notifications/endpoints", { token, expected: 200 })).payload;
assert(Array.isArray(endpoints) && endpoints.some((item) => item.id === endpoint.id && item.active === true), "P1 endpoint inventory is incomplete.");
await call(`/notifications/endpoints/${endpoint.id}/deactivate`, { method: "POST", token, body: {}, expected: 201 });
endpoints = (await call("/notifications/endpoints", { token, expected: 200 })).payload;
assert(endpoints.some((item) => item.id === endpoint.id && item.active === false), "P1 endpoint deactivation did not persist.");

const notificationList = (await call("/notifications", { token, expected: 200 })).payload;
assert(Array.isArray(notificationList), "P1 notification inbox did not return a list.");

const consent = (await call("/consents", {
  method: "POST",
  token,
  body: { scope: "P1_SELF_SERVICE_TEST", version: "p1-v1" },
  expected: 201,
})).payload;
assert(consent.id && consent.state === "GRANTED", "P1 consent grant failed.");
let consents = (await call("/consents/me", { token, expected: 200 })).payload;
assert(Array.isArray(consents) && consents.some((item) => item.id === consent.id && item.state === "GRANTED"), "P1 consent inventory is incomplete.");
await call(`/consents/${consent.id}/revoke`, { method: "POST", token, body: {}, expected: 201 });
consents = (await call("/consents/me", { token, expected: 200 })).payload;
assert(consents.some((item) => item.id === consent.id && item.state === "REVOKED"), "P1 consent revocation did not persist.");

await call("/iam/sessions/revoke-all", { method: "POST", token, body: {}, expected: 201 });
await call("/iam/accounts/me", { token, expected: 401 });

console.log(JSON.stringify({
  status: "passed",
  phase: "Patient-P1",
  isolatedFixtureAccount: true,
  accountSelfService: true,
  currentSessionMarker: true,
  remoteSessionRevocation: true,
  revokeAllSessions: true,
  mfaStatus: true,
  mfaEnrollment: true,
  activeMfaReenrollmentProtected: true,
  notificationPreferences: true,
  notificationEndpointSecretsHidden: true,
  notificationInbox: true,
  patientConsentInventory: true,
  consentRevocation: true
}));
