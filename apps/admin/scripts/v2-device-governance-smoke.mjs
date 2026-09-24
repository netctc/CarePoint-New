import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registry = read("../app/devices/page.tsx");
const integrations = read("../app/integrations/devices/page.tsx");
const consoleSource = read("../components/DeviceGovernanceConsole.tsx");
const bff = read("../app/api/admin/device-governance/[...segments]/route.ts");
const shell = read("../components/AppShell.tsx");
const backend = read("../../../services/api/src/modules/medical-devices/medical-device.service.ts");
const moduleSource = read("../../../services/api/src/modules/medical-devices/medical-device.module.ts");

assert.match(registry, /ADM-087/);
assert.match(integrations, /ADM-105/);
assert.match(shell, /\/devices/);
assert.match(shell, /\/integrations\/devices/);
assert.match(consoleSource, /createModel/);
assert.match(consoleSource, /registerDevice/);
assert.match(consoleSource, /assignDevice/);
assert.match(consoleSource, /rotate/);
assert.match(consoleSource, /revokeDevice/);
assert.match(consoleSource, /createIntegration/);
assert.match(consoleSource, /revokeIntegration/);
assert.match(consoleSource, /privateKeyPem/);
assert.match(consoleSource, /privateKeyFingerprint/);
assert.match(consoleSource, /webhookPublicKeyPem/);
assert.match(consoleSource, /healthState/);
assert.match(bff, /requireSameOrigin: true/);
assert.match(bff, /MAX_BODY_BYTES = 131072/);
assert.match(moduleSource, /DATA_GOVERNANCE_MANAGE/);
assert.match(backend, /privateKeyStored: false/);
assert.match(backend, /secretsExposed: false/);
assert.match(backend, /futureIngestionBlocked: true/);

for (const locale of ["en:", "ar:", "fr:", "es:"]) {
  assert.ok(consoleSource.includes(locale), `Missing device-governance locale ${locale}`);
}

console.log("ADM-087/ADM-105 Admin medical-device governance acceptance passed");

function read(relative){return readFileSync(new URL(relative, import.meta.url),"utf8");}
