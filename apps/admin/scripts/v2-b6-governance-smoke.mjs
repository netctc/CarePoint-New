import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const center = readFileSync(new URL("../components/B6GovernanceCenter.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../app/api/admin/b6/[...segments]/route.ts", import.meta.url), "utf8");
const terminologyPage = readFileSync(new URL("../app/clinical-terminology/page.tsx", import.meta.url), "utf8");
const qualityPage = readFileSync(new URL("../app/data-quality/patients/page.tsx", import.meta.url), "utf8");
const mergePage = readFileSync(new URL("../app/data-quality/merge/page.tsx", import.meta.url), "utf8");
const notificationPage = readFileSync(new URL("../app/notification-templates/page.tsx", import.meta.url), "utf8");
const featuresPage = readFileSync(new URL("../app/features/page.tsx", import.meta.url), "utf8");
const localizationPage = readFileSync(new URL("../app/localization/page.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("../app/governance/page.tsx", import.meta.url), "utf8");

for (const [id, page] of [
  ["ADM-084", terminologyPage],
  ["ADM-088", qualityPage],
  ["ADM-090", mergePage],
  ["ADM-100", notificationPage],
  ["ADM-101", featuresPage],
  ["ADM-110", localizationPage],
]) {
  assert.match(page, new RegExp(id));
  assert.match(page, /active="12"/);
  assert.match(page, /B6GovernanceCenter/);
  assert.match(hub, new RegExp(id));
}

assert.match(shell, /V2 Governance/);
assert.match(shell, /حوكمة V2/);
assert.match(shell, /Gouvernance V2/);
assert.match(shell, /Gobernanza V2/);
assert.match(shell, /href="\/governance"/);
assert.match(shell, /active === "12"/);

assert.match(center, /'ar':/);
assert.match(center, /'fr':/);
assert.match(center, /'es':/);
assert.match(center, /section === "terminology"/);
assert.match(center, /section === "data-quality"/);
assert.match(center, /section === "patient-merge"/);
assert.match(center, /section === "notification-templates"/);
assert.match(center, /section === "feature-flags"/);
assert.match(center, /section === "localization"/);

assert.match(center, /\/terminology\/concepts\/.*\/versions/);
assert.match(center, /\/data-quality\/run/);
assert.match(center, /ACKNOWLEDGED/);
assert.match(center, /RESOLVED/);
assert.match(center, /DISMISSED/);
assert.match(center, /reviewed/);
assert.match(center, /archive/);
assert.match(center, /preview\.executionAllowed===false/);
assert.match(center, /planDigest/);
assert.match(center, /currentTranslations/);
assert.match(center, /defaultEnabled/);
assert.match(center, /providerCategoryId/);
assert.match(center, /textEn/);
assert.match(center, /name="ar"[^>]*required/);
assert.match(center, /name="fr"[^>]*required/);
assert.match(center, /name="es"[^>]*required/);

assert.match(proxy, /forwardAdminJson/);
assert.match(proxy, /requireSameOrigin:\s*true/);
assert.match(proxy, /MAX_BODY_BYTES = 65_536/);
assert.match(proxy, /Unsupported B6 governance read route/);
assert.match(proxy, /Unsupported B6 governance mutation route/);
assert.match(proxy, /\/admin\/terminology\/systems/);
assert.match(proxy, /\/admin\/data-quality\/issues/);
assert.match(proxy, /\/admin\/patients\/merge\/preview/);
assert.match(proxy, /\/admin\/notification-templates/);
assert.match(proxy, /\/admin\/feature-flags/);
assert.match(proxy, /\/admin\/localization\/keys/);
assert.doesNotMatch(proxy, /process\.env/);
assert.doesNotMatch(center, /NEXT_PUBLIC_.*API|localhost:|127\.0\.0\.1/);

console.log("V2 B6 Admin governance acceptance passed: ADM-084/088/090/100/101/110");
