import test from "node:test";
import assert from "node:assert/strict";
import { hashPasswordAsync, verifyPasswordAsync } from "../dist/index.js";

test("async scrypt password flow is compatible and rejects incorrect passwords", async () => {
  const hash = await hashPasswordAsync("CarePoint-Test#2026");
  assert.equal(await verifyPasswordAsync("CarePoint-Test#2026", hash), true);
  assert.equal(await verifyPasswordAsync("not-the-password", hash), false);
});
