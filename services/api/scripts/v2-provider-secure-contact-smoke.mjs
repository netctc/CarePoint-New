import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/communications/communications.module.ts");
const service = read("../src/modules/communications/communications.service.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const action = read("../../../packages/mobile_core/lib/secure_contact_action.dart");
const workspace = read("../../../packages/mobile_core/lib/provider_workspace.dart");
const localization = read("../../../packages/mobile_core/lib/communications_localization.dart");

assert.match(moduleSource, /@Post\("secure-contact"\)/);
assert.match(moduleSource, /PROVIDER_SECURE_MESSAGE/);
assert.match(moduleSource, /principal\.role !== "OTHER_PROVIDER"/);
assert.match(moduleSource, /communications\.createConversation/);

assert.match(service, /requireMessagingAppointment\(input\.appointmentId\)/);
assert.match(service, /assertDirectParticipant\(principal, appointment\)/);
assert.match(service, /this\.envelope\.encrypt/);
assert.match(service, /appointmentId: conversation\.appointmentId/);
const presentation = service.match(/private async presentConversation[\s\S]*?private async presentMessage/)?.[0] ?? "";
assert.ok(presentation);
assert.doesNotMatch(presentation, /email|phone|mobile|callback/i);
assert.match(presentation, /displayName/);

assert.match(api, /secureProviderContact/);
assert.match(api, /\/communications\/secure-contact/);
assert.match(action, /careConversations\(\)/);
assert.match(action, /item\['appointmentId'\]/);
assert.match(action, /item\['status'\] == 'OPEN'/);
assert.match(action, /secureProviderContact/);
assert.match(action, /CareConversationPage/);
assert.doesNotMatch(action, /phone|mobile|callback|tel:/i);

assert.match(workspace, /widget\.session\.role == 'OTHER_PROVIDER'/);
assert.match(workspace, /SecureContextContactButton/);
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(localization.includes(locale), "Missing PRV-087 locale " + locale);
}
assert.match(localization, /secureContact/);

console.log("PRV-087 contextual secure messaging acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
