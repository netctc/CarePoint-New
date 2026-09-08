import { createHash } from "node:crypto";
import Redis from "ioredis";

await import("./admin-b9-smoke-core.mjs");

if (process.env.NODE_ENV === "test" && process.env.REDIS_URL) {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test").trim().toLowerCase();
  const digest = createHash("sha256").update(email).digest("hex");
  const redis = new Redis(process.env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  try {
    await redis.del(`carepoint:rl:iam:login:account:${digest}`);
    console.log("B9 acceptance reset its Admin login rate-limit bucket for downstream smoke isolation.");
  } finally {
    await redis.quit().catch(() => undefined);
  }
}
