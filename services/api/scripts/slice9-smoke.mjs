import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

await import("./phase-c1-kms-smoke.mjs");

const prisma = new PrismaClient();
const base = process.env.CAREPOINT_API_BASE ?? "http://127.0.0.1:4000/api/v1";

async function request(path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function expectOk(path, init = {}) {
  const result = await request(path, init);
  if (!result.response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${result.response.status} ${JSON.stringify(result.payload)}`);
  return result;
}

async function main() {
  const ready = await expectOk("/health/ready");
  if (ready.payload.status !== "ready" || ready.payload.dependencies?.postgres !== true || ready.payload.dependencies?.redis !== true) {
    throw new Error(`Readiness invariant failed: ${JSON.stringify(ready.payload)}`);
  }

  const correlationId = "slice9-correlation-001";
  const correlated = await expectOk("/health", { headers: { "x-request-id": correlationId } });
  if (correlated.response.headers.get("x-request-id") !== correlationId) throw new Error("Request correlation id was not preserved.");
  if (correlated.response.headers.get("x-content-type-options") !== "nosniff") throw new Error("Helmet nosniff header is missing.");
  if (correlated.response.headers.has("x-powered-by")) throw new Error("x-powered-by must not be exposed.");

  const email = `slice9-security-${Date.now()}@carepoint.test`;
  const password = "CarePoint-Slice9#2026";
  await expectOk("/iam/register/patient", {
    method: "POST",
    body: JSON.stringify({ email, password, firstName: "Slice", lastName: "Nine" }),
  });
  const login = await expectOk("/iam/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!login.payload.accessToken || !login.payload.refreshToken || !login.payload.sessionId) throw new Error("Slice 9 login token material missing.");

  const refreshBody = JSON.stringify({ refreshToken: login.payload.refreshToken });
  const concurrent = await Promise.all([
    request("/iam/sessions/refresh", { method: "POST", body: refreshBody }),
    request("/iam/sessions/refresh", { method: "POST", body: refreshBody }),
  ]);
  const winners = concurrent.filter(({ response }) => response.ok);
  const denied = concurrent.filter(({ response }) => response.status === 401);
  if (winners.length !== 1 || denied.length !== 1) {
    throw new Error(`Refresh single-use invariant failed: ${JSON.stringify(concurrent.map(({ response, payload }) => ({ status: response.status, payload })))}`);
  }
  const replacement = winners[0].payload;
  if (!replacement.accessToken || !replacement.refreshToken || replacement.sessionId === login.payload.sessionId) {
    throw new Error("Refresh winner did not issue a replacement session.");
  }

  const replay = await request("/iam/sessions/refresh", { method: "POST", body: refreshBody });
  if (replay.response.status !== 401) throw new Error(`Consumed refresh token replay must be 401, got ${replay.response.status}.`);

  const me = await expectOk("/iam/accounts/me", { headers: { authorization: `Bearer ${replacement.accessToken}` } });
  if (me.payload.email !== email) throw new Error("Replacement access token is not usable.");

  const rateToken = `slice9-invalid-refresh-${Date.now()}`;
  let limitedStatus = 0;
  for (let index = 0; index < 11; index += 1) {
    const attempt = await request("/iam/sessions/refresh", { method: "POST", body: JSON.stringify({ refreshToken: rateToken }) });
    limitedStatus = attempt.response.status;
    if (index < 10 && attempt.response.status !== 401) throw new Error(`Expected invalid refresh attempt ${index + 1} to be 401, got ${attempt.response.status}.`);
  }
  if (limitedStatus !== 429) throw new Error(`Redis token rate limit must return 429 on attempt 11, got ${limitedStatus}.`);

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const stale = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const staleChallengeId = `slice9-stale-challenge-${Date.now()}`;
  const staleSessionId = `slice9-stale-session-${Date.now()}`;
  await prisma.authChallenge.create({
    data: { id: staleChallengeId, userId: user.id, type: "MFA_LOGIN", expiresAt: stale, consumedAt: stale, createdAt: stale },
  });
  await prisma.authSession.create({
    data: {
      id: staleSessionId,
      userId: user.id,
      accessTokenHash: `slice9-stale-access-${Date.now()}`,
      refreshTokenHash: `slice9-stale-refresh-${Date.now()}`,
      expiresAt: stale,
      refreshExpiresAt: stale,
      revokedAt: stale,
      createdAt: stale,
    },
  });

  execFileSync("npm", ["--workspace", "@carepoint/api", "run", "auth:cleanup"], {
    cwd: process.cwd(),
    env: { ...process.env, AUTH_CHALLENGE_RETENTION_HOURS: "1", AUTH_SESSION_RETENTION_DAYS: "1" },
    stdio: "pipe",
  });
  const [challengeAfter, sessionAfter, activeReplacement, replayAudit] = await Promise.all([
    prisma.authChallenge.findUnique({ where: { id: staleChallengeId } }),
    prisma.authSession.findUnique({ where: { id: staleSessionId } }),
    prisma.authSession.findUnique({ where: { id: replacement.sessionId } }),
    prisma.auditEvent.findFirst({ where: { actorId: user.id, action: "REFRESH_TOKEN_REPLAY_DENIED", result: "DENIED" }, orderBy: { occurredAt: "desc" } }),
  ]);
  if (challengeAfter || sessionAfter) throw new Error("Expired authentication artifact cleanup did not remove stale rows.");
  if (!activeReplacement || activeReplacement.revokedAt) throw new Error("Authentication cleanup removed or revoked an active replacement session.");
  if (!replayAudit) throw new Error("Refresh replay denial was not audited.");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    readiness: true,
    redisRateLimit: true,
    refreshSingleUse: true,
    replayAudited: true,
    authCleanup: true,
    securityHeaders: true,
    requestCorrelation: true,
  })}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());