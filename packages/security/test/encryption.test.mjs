import test from "node:test";
import assert from "node:assert/strict";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider } from "../dist/index.js";

test("PHI payload round-trips through envelope encryption", async () => {
  const master = new Uint8Array(32).fill(7);
  const cryptoService = new PhiEnvelopeEncryption(new StaticAesKwKeyProvider("test-kek-v1", master));
  const phi = { patientId: "patient-1", bloodType: "O+", note: "Sensitive clinical note" };
  const envelope = await cryptoService.encryptJson(phi);

  assert.equal(envelope.algorithm, "AES-256-GCM");
  assert.equal(JSON.stringify(envelope).includes(phi.note), false);
  assert.deepEqual(await cryptoService.decryptJson(envelope), phi);
});
