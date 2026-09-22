import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = read("../components/B6OperationsCenter.tsx");
const proxy = read("../app/api/admin/b6/[...segments]/route.ts");
const api = read("../lib/admin-api.ts");
const policy = read("../lib/admin-backend-policy.js");
const hub = read("../app/governance/page.tsx");

const pages = [
  ["ADM-089", "../app/data-quality/duplicates/page.tsx", "duplicates", "/data-quality/duplicates"],
  ["ADM-102", "../app/integrations/page.tsx", "integrations", "/integrations"],
  ["ADM-111", "../app/audit/exports/page.tsx", "audit-exports", "/audit/exports"],
  ["ADM-112", "../app/clinical-operations/page.tsx", "clinical-operations", "/clinical-operations"],
];

for (const [id, path, section, href] of pages) {
  const page = read(path);
  assert.match(page, new RegExp(id));
  assert.match(page, /active="12"/);
  assert.match(page, new RegExp('section="' + section + '"'));
  assert.ok(hub.includes(id), id + " must be present in the Governance hub");
  assert.ok(hub.includes(href), href + " must be present in the Governance hub");
}

for (const locale of ["en", "ar", "fr", "es"]) {
  assert.match(component, new RegExp("\\b" + locale + ":\\{"));
}

assert.match(component, /autoMerge=false/);
assert.match(component, /\/data-quality\/merge\?source=/);
assert.match(component, /secretsExposed=/);
assert.match(component, /credentialReferences/);
assert.doesNotMatch(component, /SMART_BACKEND_CLIENTS_JSON|SIEM_EXPORT_API_KEY|MAPBOX_ACCESS_TOKEN/);
assert.match(component, /download-token/);
assert.match(component, /window\.location\.assign\(proxy\)/);
assert.match(component, /questionnairesOverdue/);
assert.match(component, /plansWithoutReview/);
assert.match(component, /rpmAlertsOpen/);
assert.match(component, /pendingResults/);
assert.match(component, /orphanTasks/);

assert.match(proxy, /patient-duplicates/);
assert.match(proxy, /admin\/integrations/);
assert.match(proxy, /admin\/clinical-operations/);
assert.match(proxy, /admin\/audit-exports/);
assert.match(proxy, /resolveAuditDownload/);
assert.match(proxy, /forwardAdminBinary/);
assert.match(proxy, /requireSameOrigin:\s*true/);
assert.match(proxy, /\^\[A-Za-z0-9_-\]\{40,100\}\$/);

assert.match(api, /forwardAdminBinary/);
assert.match(api, /readBoundedAdminBackendBytes/);
assert.match(api, /adminBackendFetch/);
assert.match(policy, /export async function readBoundedAdminBackendBytes/);
assert.match(policy, /adminApiMaxResponseBytes/);
assert.match(policy, /getReader\(\)/);
assert.doesNotMatch(api, /await\s+fetch\s*\(/);

console.log("V2 B6 Admin operations UI/security acceptance passed: ADM-089/102/111/112");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
