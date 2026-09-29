import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@carepoint/identity";

const prisma = new PrismaClient();

const CONFIRMATION = "RESET_SYNTHETIC_FIXTURE_PASSWORDS";

function requireNonProductionDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const parsed = new URL(databaseUrl);
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if (!/(test|pilot|staging|uat|demo|sandbox)/.test(dbName)) {
    throw new Error(
      "Refusing fixture password reset: database name must contain test, pilot, staging, uat, demo or sandbox.",
    );
  }
}

function requireConfiguration() {
  if (process.env.CAREPOINT_FIXTURE_PASSWORD_RESET_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `CAREPOINT_FIXTURE_PASSWORD_RESET_CONFIRM must equal ${CONFIRMATION}.`,
    );
  }

  const password = process.env.CAREPOINT_TEST_FIXTURE_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error(
      "CAREPOINT_TEST_FIXTURE_PASSWORD must contain at least 16 characters.",
    );
  }

  const domain = process.env.CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN
    ?.trim()
    .toLowerCase();
  if (
    !domain ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) {
    throw new Error(
      "CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN must be a valid explicit test domain.",
    );
  }

  return { password, domain };
}

async function main() {
  requireNonProductionDatabase();
  const { password, domain } = requireConfiguration();
  const emailSuffix = `@${domain}`;

  const users = await prisma.user.findMany({
    where: { email: { endsWith: emailSuffix, mode: "insensitive" } },
    select: { id: true, username: true, email: true, role: true },
    orderBy: { email: "asc" },
  });

  if (!users.length) {
    throw new Error(
      `No fixture users found with email domain ${emailSuffix}; no changes were made.`,
    );
  }

  const ids = users.map((user) => user.id);
  const passwordHash = hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const sessions = await tx.authSession.deleteMany({
      where: { userId: { in: ids } },
    });
    const challenges = await tx.authChallenge.deleteMany({
      where: { userId: { in: ids } },
    });
    const updated = await tx.user.updateMany({
      where: { id: { in: ids } },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        status: "ACTIVE",
      },
    });
    return {
      sessionsDeleted: sessions.count,
      challengesDeleted: challenges.count,
      usersUpdated: updated.count,
    };
  });

  const byRole = users.reduce<Record<string, number>>((acc, user) => {
    acc[user.role] = (acc[user.role] ?? 0) + 1;
    return acc;
  }, {});

  const admin = users.find((user) => user.username === "admin.test");

  console.log("CarePoint synthetic fixture passwords updated.");
  console.log(
    JSON.stringify(
      {
        domain,
        usersUpdated: result.usersUpdated,
        sessionsDeleted: result.sessionsDeleted,
        challengesDeleted: result.challengesDeleted,
        byRole,
        admin: admin
          ? { username: admin.username, email: admin.email }
          : null,
        passwordSource: "CAREPOINT_TEST_FIXTURE_PASSWORD",
      },
      null,
      2,
    ),
  );
  console.log("No password value is printed by this script.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
