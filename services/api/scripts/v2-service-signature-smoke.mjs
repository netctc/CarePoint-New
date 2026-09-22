import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("PRV-077 service receipt confirmation is completion-bound, immutable and not clinical consent", () => {
  const migration = readFileSync(
    new URL("../prisma/migrations/20260921231500_v2_service_signature/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "ServiceSignature"/);
  assert.match(migration, /completionEventId/);
  assert.match(migration, /formResponseId/);
  assert.match(migration, /formResponseSequence/);
  assert.match(migration, /ProviderWorkflowEvent/);
  assert.match(migration, /ProviderCategoryFormResponse/);
  assert.match(migration, /ServiceSignature_append_only_trg/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /REVOKE UPDATE, DELETE/);

  const service = readFileSync(
    new URL("../src/modules/service-signature/service-signature.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /SERVICE_COMPLETION_CHECKLIST_CONFIRMED/);
  assert.match(service, /Service completion checklist must be confirmed before receipt confirmation/);
  assert.match(service, /formResponseSequence/);
  assert.match(service, /serviceSummaryDigest/);
  assert.match(service, /appointmentDigest/);
  assert.match(service, /completionEvidenceDigest/);
  assert.match(service, /acknowledgesServiceReceipt: true/);
  assert.match(service, /clinicalConsentGranted: false/);
  assert.match(service, /replacesClinicalConsent: false/);
  assert.match(service, /SERVICE_RECEIPT_CONFIRMATION_RECORDED/);
  assert.match(service, /encryptRecord/);
  assert.doesNotMatch(service, /consent\.create/);

  const mobile = readFileSync(
    new URL("../../../packages/mobile_core/lib/service_signature.dart", import.meta.url),
    "utf8",
  );
  assert.match(mobile, /Service receipt confirmation/);
  assert.match(mobile, /does not grant or replace clinical consent/);
  assert.match(mobile, /Confirmación de recepción del servicio/);
  assert.match(mobile, /'ar'/);
  assert.match(mobile, /'fr'/);
  assert.match(mobile, /'es'/);

  const entry = readFileSync(
    new URL("../../../apps/provider-mobile/lib/service_confirmation_entry.dart", import.meta.url),
    "utf8",
  );
  assert.match(entry, /SERVICE_COMPLETION_CHECKLIST/);

  const scope = readFileSync(
    new URL("../../../apps/provider-mobile/lib/provider_capability_scope.dart", import.meta.url),
    "utf8",
  );
  assert.match(scope, /workflowCapabilities/);
});

console.log("PRV-077 service receipt confirmation acceptance passed");
