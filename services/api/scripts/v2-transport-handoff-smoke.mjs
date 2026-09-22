import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/modules/transport/transport-handoff.module.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/v2_transport_handoff.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260922011500_v2_transport_handoff/migration.sql", import.meta.url),
  "utf8",
);
const mobileApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const mobileFlow = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_handoff.dart", import.meta.url),
  "utf8",
);
const mobileWorkspace = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url),
  "utf8",
);

assert.match(source, /@Controller\("provider\/transport\/jobs"\)/);
assert.match(source, /@Post\(":id\/handoff"\)/);
assert.match(source, /@Get\(":id\/handoff"\)/);
assert.match(source, /RequirePermissions\("TRANSPORT_RESPOND"\)/);
assert.match(source, /status !== "TRANSPORTING"/);
assert.match(source, /crewAssignment\.findFirst/);
assert.match(source, /orderBy:\s*\{ revision: "desc" \}/);
assert.match(source, /transportHandoffSignatureRequired/);
assert.match(source, /signatureRequired && signatureMethod == null/);
assert.match(source, /TYPED_CONFIRMATION/);
assert.match(source, /DRAWN_SIGNATURE/);
assert.match(source, /encryptRecord\(payload\)/);
assert.match(source, /requestDigest/);
assert.match(source, /handoffSummaryDigest/);
assert.match(source, /transportContextDigest/);
assert.match(source, /TransactionIsolationLevel\.Serializable/);
assert.match(source, /FOR UPDATE/);
assert.match(source, /MEDICAL_TRANSPORT_DESTINATION_HANDOFF_RECORDED/);
assert.match(source, /receiverAcceptedHandoff:\s*true/);
assert.match(source, /clinicalConsentGranted:\s*false/);
assert.match(source, /replacesClinicalConsent:\s*false/);

assert.match(schema, /model TransportHandoff/);
assert.match(schema, /transportRequestId\s+String\s+@unique/);
assert.match(schema, /crewAssignmentId\s+String/);
assert.match(schema, /signatureRequired\s+Boolean/);
assert.match(schema, /ciphertext\s+String/);
assert.match(schema, /handedOffAt\s+DateTime/);

assert.match(migration, /TransportHandoff_immutable_trigger/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "TransportHandoff"/);
assert.match(migration, /CrewAssignment/);
assert.match(migration, /MedicalTransportRequest/);
assert.match(migration, /Provider/);

assert.match(mobileApi, /providerTransportHandoff/);
assert.match(mobileApi, /recordProviderTransportHandoff/);
assert.match(mobileApi, /\/provider\/transport\/jobs\/\$requestId\/handoff/);
assert.match(mobileApi, /receiverAcceptedHandoff': true/);
assert.match(mobileFlow, /TYPED_CONFIRMATION/);
assert.match(mobileFlow, /receiverName/);
assert.match(mobileFlow, /receiverRole/);
assert.match(mobileFlow, /handoffSummary/);
assert.match(mobileFlow, /CarePointLocale\.ar/);
assert.match(mobileFlow, /CarePointLocale\.fr/);
assert.match(mobileFlow, /CarePointLocale\.es/);
assert.match(mobileWorkspace, /showTransportHandoffSheet/);
assert.match(mobileWorkspace, /status == 'TRANSPORTING' \|\| status == 'COMPLETED'/);

console.log("V2 PRV-084 destination transport handoff acceptance passed");
