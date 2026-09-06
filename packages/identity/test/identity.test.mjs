import test from "node:test";
import assert from "node:assert/strict";
import { CarePointIdentityCore, totpCode } from "../dist/index.js";

test("doctor and other-provider onboarding remain strictly separated", () => {
  const core = new CarePointIdentityCore();
  const doctor = core.auth.createAccount({ email: "doctor@example.com", password: "LongSecurePassword#1", role: "DOCTOR" });
  const provider = core.auth.createAccount({ email: "nurse@example.com", password: "LongSecurePassword#2", role: "OTHER_PROVIDER" });
  assert.equal(core.governance.startDoctor({ accountId: doctor.id, specialtyId: "spec-card" }).kind, "DOCTOR");
  assert.equal(core.governance.startOtherProvider({ accountId: provider.id, providerCategoryId: "cat-nursing" }).kind, "OTHER_PROVIDER");
  assert.throws(() => core.governance.startOtherProvider({ accountId: doctor.id, providerCategoryId: "cat-nursing" }), /Doctors are excluded/);
});

test("MFA login issues a challenge and then a revocable session", () => {
  const core = new CarePointIdentityCore();
  const account = core.auth.createAccount({ email: "mfa@example.com", password: "LongSecurePassword#3", role: "ADMIN" });
  const enrollment = core.auth.beginMfa(account.id);
  core.auth.confirmMfa(account.id, totpCode(enrollment.secret));
  const login = core.auth.login("mfa@example.com", "LongSecurePassword#3");
  assert.equal("requiresMfa" in login, true);
  if (!("requiresMfa" in login)) throw new Error("expected MFA challenge");
  const tokens = core.auth.completeMfa(login.challengeId, totpCode(enrollment.secret));
  assert.equal(core.auth.validate(tokens.accessToken).accountId, account.id);
  core.auth.revoke(tokens.sessionId);
  assert.throws(() => core.auth.validate(tokens.accessToken), /invalid or expired/);
});

test("refresh token rotation revokes the previous session", () => {
  const core = new CarePointIdentityCore();
  const account = core.auth.createAccount({ email: "rotate@example.com", password: "LongSecurePassword#4", role: "PATIENT" });
  const first = core.auth.login(account.email, "LongSecurePassword#4");
  if ("requiresMfa" in first) throw new Error("unexpected MFA challenge");
  const next = core.auth.refresh(first.refreshToken);
  assert.notEqual(first.sessionId, next.sessionId);
  assert.throws(() => core.auth.validate(first.accessToken), /invalid or expired/);
  assert.equal(core.auth.validate(next.accessToken).accountId, account.id);
});

test("provider approval requires every credential to be verified", () => {
  const core = new CarePointIdentityCore();
  const provider = core.auth.createAccount({ email: "provider@example.com", password: "LongSecurePassword#5", role: "OTHER_PROVIDER" });
  let onboarding = core.governance.startOtherProvider({ accountId: provider.id, providerCategoryId: "cat-physio" });
  onboarding = core.governance.addCredential(onboarding.id, { type: "professional-license", number: "L-100" });
  onboarding = core.governance.submit(onboarding.id);
  assert.throws(() => core.governance.approve("admin-1", onboarding.id), /verified/);
  onboarding = core.governance.reviewCredential("admin-1", onboarding.id, onboarding.credentials[0].id, "VERIFIED");
  assert.equal(core.governance.approve("admin-1", onboarding.id).state, "APPROVED");
  assert.equal(core.governance.providerState(provider.id), "ACTIVE");
  assert.equal(core.governance.suspendProvider("admin-1", provider.id), "SUSPENDED");
});

test("consent grant and revoke is auditable", () => {
  const core = new CarePointIdentityCore();
  const consent = core.governance.grantConsent({ patientId: "patient-1", providerId: "provider-1", scope: "CLINICAL_RECORD_READ", version: "1.0" });
  assert.equal(consent.state, "GRANTED");
  assert.equal(core.governance.revokeConsent(consent.id, "patient-1").state, "REVOKED");
  const actions = core.audit.list().map((entry) => entry.action);
  assert.ok(actions.includes("CONSENT_GRANTED"));
  assert.ok(actions.includes("CONSENT_REVOKED"));
});
