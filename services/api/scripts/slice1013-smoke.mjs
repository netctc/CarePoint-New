import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { createSign, randomBytes } from "node:crypto";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const fhirBase = process.env.SMART_FHIR_BASE_URL || `${base}/fhir/R4`;
const tokenEndpoint = `${base}/smart/token`;
const assertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const clientId = "slice1013-durable-client";
const keyId = "slice109-backend-key";
const privateKeyB64 = process.env.SMART_BACKEND_PRIVATE_KEY_B64;
if (!privateKeyB64) throw new Error("SMART_BACKEND_PRIVATE_KEY_B64 is required for Slice 10.13 smoke testing.");
const privateKey = Buffer.from(privateKeyB64, "base64").toString("utf8");
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: 1 });
const suffix = Date.now().toString(36);
const scopes = ["system/Patient.rs", "system/Appointment.rs"];

async function raw(path, { method = "GET", token, body, headers = {} } = {}) {
  const requestHeaders = { accept: "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const url = /^https?:\/\//.test(path) ? path : base + path;
  const response = await fetch(url, { method, headers: requestHeaders, body });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return {
    status: response.status,
    text,
    payload,
    contentLocation: response.headers.get("content-location") || "",
  };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assertion(audience) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS384", kid: keyId, typ: "JWT" };
  const claims = {
    iss: clientId,
    sub: clientId,
    aud: audience,
    iat: now,
    exp: now + 240,
    jti: `bulk-1013-${suffix}-${randomBytes(18).toString("base64url")}`,
  };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput, "ascii");
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
}

async function backendToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    scope: scopes.join(" "),
    client_assertion_type: assertionType,
    client_assertion: assertion(tokenEndpoint),
  });
  const result = await raw("/smart/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (result.status !== 200 || !result.payload.access_token) throw new Error(`Slice 10.13 backend token failed: ${JSON.stringify(result)}`);
  return result.payload.access_token;
}

async function kickoff(token, types = ["Patient"]) {
  const params = new URLSearchParams({ _type: types.join(",") });
  const result = await raw(`/fhir/R4/$export?${params.toString()}`, {
    token,
    headers: { accept: "application/fhir+json", prefer: "respond-async" },
  });
  if (result.status !== 202 || !result.contentLocation) throw new Error(`Slice 10.13 kickoff failed: ${JSON.stringify(result)}`);
  return result.contentLocation;
}

function jobIdFromLocation(location) {
  const match = /\/\$export-status\/([A-Za-z0-9_-]+)$/.exec(location);
  if (!match) throw new Error(`Invalid Slice 10.13 Content-Location: ${location}`);
  return match[1];
}

async function waitForRow(jobId, predicate, label, attempts = 80) {
  for (let index = 0; index < attempts; index += 1) {
    const row = await prisma.fhirBulkExportJobState.findUnique({ where: { id: jobId } });
    if (row && predicate(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const row = await prisma.fhirBulkExportJobState.findUnique({ where: { id: jobId } });
  throw new Error(`${label}: ${JSON.stringify(row)}`);
}

async function waitForDeleted(jobId, label, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    const row = await prisma.fhirBulkExportJobState.findUnique({ where: { id: jobId } });
    if (!row) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label}: durable row still exists.`);
}

try {
  const metadata = await raw("/fhir/R4/metadata");
  if (metadata.status !== 200 || metadata.payload.software?.version !== "slice-10.13") {
    throw new Error(`FHIR Slice 10.13 metadata failed: ${JSON.stringify(metadata)}`);
  }
  const description = String(metadata.payload.implementation?.description || "");
  if (!description.includes("PostgreSQL") || !description.includes("lease")) {
    throw new Error("Slice 10.13 capability metadata does not document durable recovery.");
  }

  const token = await backendToken();

  // A normal kickoff must be durably persisted before the HTTP request returns.
  const normalLocation = await kickoff(token, ["Patient"]);
  const normalJobId = jobIdFromLocation(normalLocation);
  const normalRow = await waitForRow(normalJobId, () => true, "Normal kickoff was not persisted in PostgreSQL");
  if (normalRow.clientId !== clientId || !["QUEUED", "RUNNING", "COMPLETED"].includes(normalRow.status)) {
    throw new Error(`Unexpected durable kickoff state: ${JSON.stringify(normalRow)}`);
  }

  const normalCompleted = await waitForRow(normalJobId, (row) => row.status === "COMPLETED", "Normal durable job did not complete");
  const normalPayload = normalCompleted.payload;
  if (!normalPayload || typeof normalPayload !== "object" || Array.isArray(normalPayload)) throw new Error("Normal durable payload is invalid.");

  // Simulate a crash-recovery job: PostgreSQL contains QUEUED state and Redis contains nothing.
  const recoveredJobId = randomBytes(24).toString("base64url");
  const recoveredPayload = {
    ...normalPayload,
    jobId: recoveredJobId,
    status: "QUEUED",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    transactionTime: null,
    expiresAt: null,
    artifacts: [],
    error: null,
  };
  await prisma.fhirBulkExportJobState.create({
    data: {
      id: recoveredJobId,
      clientId,
      status: "QUEUED",
      payload: recoveredPayload,
      availableAt: new Date(),
      purgeAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await redis.del(`carepoint:fhir:bulk-export:${recoveredJobId}`);
  const recovered = await waitForRow(recoveredJobId, (row) => row.status === "COMPLETED", "PostgreSQL-only job was not recovered by the worker", 100);
  if (recovered.attemptCount < 1) throw new Error(`Recovered job was not lease-claimed: ${JSON.stringify(recovered)}`);
  if (recovered.leaseOwner !== null || recovered.leaseUntil !== null) throw new Error("Recovered job lease was not released after completion.");

  // Lose Redis after completion. Status must be restored from PostgreSQL and remain downloadable/pollable.
  await redis.del(`carepoint:fhir:bulk-export:${recoveredJobId}`);
  const recoveredStatus = await raw(`${fhirBase}/$export-status/${recoveredJobId}`, { token });
  if (recoveredStatus.status !== 200 || !Array.isArray(recoveredStatus.payload.output)) {
    throw new Error(`PostgreSQL restore after Redis loss failed: ${JSON.stringify(recoveredStatus)}`);
  }
  const restoredRedis = await redis.get(`carepoint:fhir:bulk-export:${recoveredJobId}`);
  if (!restoredRedis) throw new Error("PostgreSQL status restore did not rebuild the rolling-compatibility Redis state.");

  // Expired durable rows are removed by the cleanup worker even when no Redis copy exists.
  const expiredJobId = randomBytes(24).toString("base64url");
  await prisma.fhirBulkExportJobState.create({
    data: {
      id: expiredJobId,
      clientId,
      status: "COMPLETED",
      payload: {
        ...recoveredPayload,
        jobId: expiredJobId,
        status: "COMPLETED",
        expiresAt: new Date(Date.now() - 5_000).toISOString(),
      },
      availableAt: new Date(Date.now() - 10_000),
      purgeAt: new Date(Date.now() - 5_000),
    },
  });
  await redis.del(`carepoint:fhir:bulk-export:${expiredJobId}`);
  await waitForDeleted(expiredJobId, "Expired durable job was not removed by cleanup");

  const normalStatus = await raw(`${fhirBase}/$export-status/${normalJobId}`, { token });
  if (normalStatus.status !== 200 || !Array.isArray(normalStatus.payload.output)) {
    throw new Error(`Normal durable job status failed after persistence: ${JSON.stringify(normalStatus)}`);
  }

  console.log(JSON.stringify({
    status: "passed",
    softwareVersion: metadata.payload.software?.version,
    durablePostgres: true,
    persistedBeforeResponse: true,
    leaseRecovery: true,
    redisLossRecovery: true,
    cleanupLifecycle: true,
    clientBoundOwnership: normalRow.clientId === clientId,
  }));
} finally {
  await prisma.fhirBulkExportJobState.deleteMany({ where: { clientId } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  redis.disconnect();
}
