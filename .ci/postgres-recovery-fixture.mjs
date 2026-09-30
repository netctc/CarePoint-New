import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

const AUDIT_ID = "c1100000-0000-4000-8000-000000000001";
const DELIVERY_ID = "c1100000-0000-4000-8000-000000000002";
const FIXTURE_TIME = new Date("2026-09-09T00:00:00.000Z");
const FIXTURE_METADATA = Object.freeze({
  fixture: "C11_SYNTHETIC_RECOVERY",
  sequence: 1101,
  integrity: "logical-backup-restore",
});

const command = process.argv[2];
if (command !== "seed" && command !== "verify") {
  throw new Error("Usage: node .ci/postgres-recovery-fixture.mjs <seed|verify>");
}

const prisma = new PrismaClient();
try {
  await prisma.$connect();
  if (command === "seed") await seed();
  else await verify();
} finally {
  await prisma.$disconnect().catch(() => undefined);
}

async function seed() {
  await prisma.siemAuditDelivery.deleteMany({ where: { id: DELIVERY_ID } });
  await prisma.auditEvent.deleteMany({ where: { id: AUDIT_ID } });

  await prisma.auditEvent.create({
    data: {
      id: AUDIT_ID,
      actorId: null,
      action: "C11_RECOVERY_DRILL",
      objectType: "RECOVERY_FIXTURE",
      objectId: null,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: FIXTURE_METADATA,
      occurredAt: FIXTURE_TIME,
    },
  });
  await prisma.siemAuditDelivery.create({
    data: {
      id: DELIVERY_ID,
      auditEventId: AUDIT_ID,
      status: "FAILED",
      attemptCount: 2,
      availableAt: FIXTURE_TIME,
      errorCode: "SyntheticRecoveryFixture",
    },
  });

  const migrationCount = await appliedMigrationCount();
  if (migrationCount !== repositoryMigrationCount()) {
    throw new Error(`C11 source migration count mismatch: database=${migrationCount} repository=${repositoryMigrationCount()}.`);
  }
  console.log("Phase C11 source recovery fixture seeded");
}

async function verify() {
  const event = await prisma.auditEvent.findUnique({
    where: { id: AUDIT_ID },
    include: { siemDelivery: true },
  });
  if (!event) throw new Error("C11 restored AuditEvent fixture is missing.");
  if (event.action !== "C11_RECOVERY_DRILL" || event.objectType !== "RECOVERY_FIXTURE" || event.result !== "SUCCESS") {
    throw new Error("C11 restored AuditEvent fixture changed semantic fields.");
  }
  if (event.actorId !== null || event.objectId !== null || event.purpose !== "SYSTEM_ACCESS") {
    throw new Error("C11 restored AuditEvent fixture changed nullable/purpose fields.");
  }
  if (event.occurredAt.toISOString() !== FIXTURE_TIME.toISOString()) {
    throw new Error("C11 restored AuditEvent fixture changed its timestamp.");
  }
  if (JSON.stringify(event.metadata) !== JSON.stringify(FIXTURE_METADATA)) {
    throw new Error("C11 restored AuditEvent fixture metadata integrity check failed.");
  }
  if (!event.siemDelivery) throw new Error("C11 restored SIEM delivery relation is missing.");
  if (
    event.siemDelivery.id !== DELIVERY_ID
    || event.siemDelivery.status !== "FAILED"
    || event.siemDelivery.attemptCount !== 2
    || event.siemDelivery.errorCode !== "SyntheticRecoveryFixture"
  ) {
    throw new Error("C11 restored SIEM delivery fixture changed state.");
  }

  const migrationCount = await appliedMigrationCount();
  const expectedMigrations = repositoryMigrationCount();
  if (migrationCount !== expectedMigrations) {
    throw new Error(`C11 restored migration count mismatch: database=${migrationCount} repository=${expectedMigrations}.`);
  }

  await expectPrismaCode(
    "P2002",
    () => prisma.siemAuditDelivery.create({
      data: {
        id: "c1100000-0000-4000-8000-000000000003",
        auditEventId: AUDIT_ID,
        status: "FAILED",
      },
    }),
    "C11 restored unique auditEventId constraint",
  );
  await expectPrismaCode(
    "P2003",
    () => prisma.siemAuditDelivery.create({
      data: {
        id: "c1100000-0000-4000-8000-000000000004",
        auditEventId: "c1100000-0000-4000-8000-000000000099",
        status: "FAILED",
      },
    }),
    "C11 restored AuditEvent foreign-key constraint",
  );

  console.log(`Phase C11 restored database integrity verified: ${migrationCount} migrations`);
}

async function appliedMigrationCount() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL
      AND "rolled_back_at" IS NULL
  `);
  const count = Number(rows?.[0]?.count ?? Number.NaN);
  if (!Number.isInteger(count) || count < 1) throw new Error("C11 could not determine applied Prisma migration count.");
  return count;
}

function repositoryMigrationCount() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../services/api/prisma/migrations");
  return readdirSync(root).filter((entry) => {
    const fullPath = path.join(root, entry);
    return statSync(fullPath).isDirectory();
  }).length;
}

async function expectPrismaCode(expectedCode, operation, label) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === expectedCode) return;
    throw new Error(`${label} failed with an unexpected database error class.`);
  }
  throw new Error(`${label} was not enforced after restore.`);
}
