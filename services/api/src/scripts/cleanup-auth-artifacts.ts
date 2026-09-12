import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

async function main(): Promise<void> {
  const now = Date.now();
  const challengeRetentionHours = positiveNumber(process.env.AUTH_CHALLENGE_RETENTION_HOURS, 24, "AUTH_CHALLENGE_RETENTION_HOURS");
  const sessionRetentionDays = positiveNumber(process.env.AUTH_SESSION_RETENTION_DAYS, 30, "AUTH_SESSION_RETENTION_DAYS");
  const challengeCutoff = new Date(now - challengeRetentionHours * 60 * 60 * 1000);
  const sessionCutoff = new Date(now - sessionRetentionDays * 24 * 60 * 60 * 1000);

  const [challenges, sessions] = await prisma.$transaction([
    prisma.authChallenge.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: challengeCutoff } },
          { consumedAt: { lt: challengeCutoff } },
        ],
      },
    }),
    prisma.authSession.deleteMany({
      where: {
        OR: [
          { refreshExpiresAt: { lt: sessionCutoff } },
          { revokedAt: { lt: sessionCutoff } },
        ],
      },
    }),
  ]);

  process.stdout.write(`${JSON.stringify({
    status: "completed",
    deletedChallenges: challenges.count,
    deletedSessions: sessions.count,
    challengeCutoff: challengeCutoff.toISOString(),
    sessionCutoff: sessionCutoff.toISOString(),
  })}\n`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
