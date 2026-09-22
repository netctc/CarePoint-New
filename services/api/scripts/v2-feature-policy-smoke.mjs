import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { FeaturePolicyService, carePointRuntimeJurisdiction } = require("../dist/security/feature-policy.service.js");

const ORIGINAL_ENV = { ...process.env };

class FakeAudit {
  constructor() { this.rows = []; }
  async write(input) { this.rows.push(input); }
}

class FakePrisma {
  constructor(flag, category = "nursing") {
    this.flag = flag;
    this.category = category;
    this.featureFlag = {
      findUnique: async ({ where }) => this.flag && this.flag.key === where.key ? this.flag : null,
    };
    this.provider = {
      findFirst: async () => ({ otherProviderProfile: { category: { slug: this.category } } }),
    };
    this.providerCategory = {
      findUnique: async ({ where }) => where.slug === this.category ? { active: true } : null,
    };
  }
}

function assignment(id, dimensions, enabled, version = 1) {
  return {
    id,
    environment: dimensions.environment ?? "*",
    jurisdiction: dimensions.jurisdiction ?? "*",
    role: dimensions.role ?? "*",
    providerCategory: dimensions.providerCategory ?? "*",
    enabled,
    active: true,
    version,
  };
}

function flag(key, assignments = [], defaultEnabled = true) {
  return { id: `flag-${key}`, key, active: true, defaultEnabled, assignments };
}

try {
  Object.assign(process.env, {
    NODE_ENV: "test",
    CAREPOINT_PRIVATE_PILOT: "false",
    CAREPOINT_TELEHEALTH_ENABLED: "true",
    CAREPOINT_PAYMENTS_ENABLED: "true",
    CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED: "true",
    CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED: "true",
    CAREPOINT_JURISDICTION: "LB",
  });

  assert.equal(carePointRuntimeJurisdiction(process.env), "LB");
  assert.throws(() => carePointRuntimeJurisdiction({ CAREPOINT_JURISDICTION: "bad jurisdiction!" }), /safe 1-40 character/);

  const patient = { accountId: "patient-account", role: "PATIENT", sessionId: "session-patient" };
  const provider = { accountId: "provider-account", role: "OTHER_PROVIDER", sessionId: "session-provider" };

  // A global disable blocks an old client that still invokes the endpoint directly.
  {
    const audit = new FakeAudit();
    const prisma = new FakePrisma(flag("PAYMENTS", [assignment("global-off", {}, false)]));
    const policy = new FeaturePolicyService(prisma, audit);
    const decision = await policy.evaluate(patient, "PAYMENTS");
    assert.equal(decision.enabled, false);
    assert.equal(decision.source, "ASSIGNMENT");
    await assert.rejects(() => policy.assertEnabled(patient, "PAYMENTS", "/api/v1/billing/me"), /Feature is not available/);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].action, "FEATURE_FLAG_DENIED");
    assert.equal(audit.rows[0].metadata.route, "/api/v1/billing/me");
  }

  // More-specific jurisdiction/role assignments can roll out within a globally disabled feature.
  {
    const prisma = new FakePrisma(flag("PAYMENTS", [
      assignment("global-off", {}, false),
      assignment("lb-patient-on", { jurisdiction: "LB", role: "PATIENT" }, true),
    ]));
    const policy = new FeaturePolicyService(prisma, new FakeAudit());
    const decision = await policy.evaluate(patient, "PAYMENTS");
    assert.equal(decision.enabled, true);
    assert.equal(decision.assignmentId, "lb-patient-on");
  }

  // Provider category is resolved server-side from the authenticated provider record.
  {
    const prisma = new FakePrisma(flag("PAYMENTS", [
      assignment("global-off", {}, false),
      assignment("nursing-on", { role: "OTHER_PROVIDER", providerCategory: "nursing" }, true),
    ]));
    const policy = new FeaturePolicyService(prisma, new FakeAudit());
    const decision = await policy.evaluate(provider, "PAYMENTS");
    assert.equal(decision.providerCategory, "nursing");
    assert.equal(decision.enabled, true);
    assert.equal(decision.assignmentId, "nursing-on");
  }

  // At equal specificity a disable wins, avoiding ambiguous accidental enablement.
  {
    const prisma = new FakePrisma(flag("PAYMENTS", [
      assignment("test-on", { environment: "test" }, true),
      assignment("patient-off", { role: "PATIENT" }, false),
    ]));
    const policy = new FeaturePolicyService(prisma, new FakeAudit());
    const decision = await policy.evaluate(patient, "PAYMENTS");
    assert.equal(decision.enabled, false);
    assert.equal(decision.assignmentId, "patient-off");
  }

  // Runtime hard ceilings cannot be bypassed by a DB assignment.
  {
    process.env.CAREPOINT_TELEHEALTH_ENABLED = "false";
    const prisma = new FakePrisma(flag("TELEHEALTH", [assignment("force-on", { role: "PATIENT" }, true)]));
    const policy = new FeaturePolicyService(prisma, new FakeAudit());
    const decision = await policy.evaluate(patient, "TELEHEALTH");
    assert.equal(decision.enabled, false);
    assert.equal(decision.source, "HARD_CEILING");
    process.env.CAREPOINT_TELEHEALTH_ENABLED = "true";
  }

  // A decorated but undefined feature fails closed.
  {
    const policy = new FeaturePolicyService(new FakePrisma(null), new FakeAudit());
    const decision = await policy.evaluate(patient, "UNKNOWN_FEATURE");
    assert.equal(decision.enabled, false);
    assert.equal(decision.source, "MISSING_FLAG");
  }

  const apiSecurity = readFileSync(new URL("../src/security/api-security.module.ts", import.meta.url), "utf8");
  const adminModule = readFileSync(new URL("../src/modules/feature-flags/feature-flags.module.ts", import.meta.url), "utf8");
  const telehealth = readFileSync(new URL("../src/modules/telehealth/telehealth.module.ts", import.meta.url), "utf8");
  const billing = readFileSync(new URL("../src/modules/billing/billing.module.ts", import.meta.url), "utf8");
  const prisma = readFileSync(new URL("../prisma/v2_feature_flags.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20260922100000_v2_feature_flags/migration.sql", import.meta.url), "utf8");
  const identity = readFileSync(new URL("../../../packages/identity/src/authorization.ts", import.meta.url), "utf8");

  assert.match(apiSecurity, /export const RequireFeature = \(featureKey: string\)/);
  assert.match(apiSecurity, /featurePolicy\.assertEnabled\(principal, requiredFeature, request\.url \?\? null\)/);
  assert.match(apiSecurity, /FeaturePolicyService/);
  assert.match(adminModule, /@Controller\("admin\/feature-flags"\)/);
  assert.match(adminModule, /RequirePermissions\("FEATURE_FLAG_MANAGE"\)/);
  assert.match(adminModule, /@Post\(":flagId\/assignments"\)/);
  assert.match(identity, /"FEATURE_FLAG_MANAGE"/);

  assert.equal((telehealth.match(/@RequireFeature\("TELEHEALTH"\)/g) ?? []).length, 1);
  assert.equal((billing.match(/@RequireFeature\("PAYMENTS"\)/g) ?? []).length, 3);
  const insuranceStart = billing.indexOf('@Controller("insurance")');
  const providerFinanceStart = billing.indexOf('@Controller("provider/finance")');
  assert.ok(insuranceStart >= 0 && providerFinanceStart > insuranceStart);
  assert.doesNotMatch(billing.slice(insuranceStart, providerFinanceStart), /RequireFeature\("PAYMENTS"\)/, "Insurance must remain independent of payment rollout");

  assert.match(prisma, /model FeatureFlag\s*\{/);
  assert.match(prisma, /model FeatureAssignment\s*\{/);
  assert.match(prisma, /@@unique\(\[featureFlagId, environment, jurisdiction, role, providerCategory\]\)/);
  for (const key of ["TELEHEALTH", "PAYMENTS", "PATIENT_SELF_REGISTRATION", "EXTERNAL_NOTIFICATIONS"]) {
    assert.match(migration, new RegExp(`'${key}'`), `Missing bootstrap feature ${key}`);
  }

  console.log("V2 BE-055 server-side feature flag enforcement acceptance passed");
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}
