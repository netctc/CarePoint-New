import { PrismaClient } from "@prisma/client";
import { ClinicalEnvelopeService } from "../modules/clinical/clinical-envelope.service";

const SENTINEL = "__ENCRYPTED__";

async function main() {
  const prisma = new PrismaClient();
  const envelope = new ClinicalEnvelopeService();
  let migrated = 0;

  try {
    while (true) {
      const rows = await prisma.emergencyContact.findMany({
        where: { ciphertext: null },
        orderBy: { id: "asc" },
        take: 100,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        const protectedRecord = await envelope.encryptRecord({
          schemaVersion: 1,
          displayName: row.displayName,
          relationship: row.relationship,
          phone: row.phone,
        });
        const result = await prisma.emergencyContact.updateMany({
          where: { id: row.id, ciphertext: null },
          data: {
            displayName: SENTINEL,
            relationship: SENTINEL,
            phone: SENTINEL,
            algorithm: protectedRecord.algorithm,
            keyId: protectedRecord.keyId,
            wrappedKey: protectedRecord.wrappedKey,
            iv: protectedRecord.iv,
            ciphertext: protectedRecord.ciphertext,
          },
        });
        migrated += result.count;
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`Emergency-contact encryption backfill completed. Migrated rows: ${migrated}.`);
}

main().catch(() => {
  console.error("Emergency-contact encryption backfill failed.");
  process.exitCode = 1;
});
