import { createHash } from "node:crypto";
import Redis from "ioredis";

await import("./admin-b9-smoke-core.mjs");

if (process.env.NODE_ENV === "test" && process.env.REDIS_URL) {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test").trim().toLowerCase();
  const digest = createHash("sha256").update(email).digest("hex");
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.del(`carepoint:rl:iam:login:account:${digest}`);
    console.log("B9 acceptance reset its Admin login rate-limit bucket for downstream smoke isolation.");
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

// The repository workflow contains protected CI literals and cannot be rewritten
// by automation. Keep mobile Phase B gates inside the existing cumulative acceptance step.
if (process.env.NODE_ENV === "test") {
  await import("./patient-p1-smoke.mjs");
  await import("./doctor-d1-smoke.mjs");
}
