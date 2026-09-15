import "dotenv/config";
import { PrismaClient, type UserRole, type ProviderClass } from "@prisma/client";
import { hashPassword } from "@carepoint/identity";
import { carePointRuntimeFeatures } from "../infrastructure/release/private-pilot-policy";

const prisma = new PrismaClient();
const CONFIRMATION = "CREATE_SYNTHETIC_PRIVATE_PILOT_FIXTURES";

type Persona = { key: string; localPart: string; role: UserRole; firstName?: string; lastName?: string };

const personas: Persona[] = [
  { key: "patient-a", localPart: "pilot.patient.a", role: "PATIENT", firstName: "Synthetic", lastName: "Patient A" },
  { key: "patient-b", localPart: "pilot.patient.b", role: "PATIENT", firstName: "Synthetic", lastName: "Patient B" },
  { key: "doctor-a", localPart: "pilot.doctor.a", role: "DOCTOR" },
  { key: "doctor-b", localPart: "pilot.doctor.b", role: "DOCTOR" },
  { key: "other-provider-a", localPart: "pilot.provider.a", role: "OTHER_PROVIDER" },
  { key: "other-provider-b", localPart: "pilot.provider.b", role: "OTHER_PROVIDER" },
  { key: "admin-a", localPart: "pilot.admin.a", role: "ADMIN" },
] as const;

function requirePilotSafety(): { password: string; domain: string } {
  const features = carePointRuntimeFeatures(process.env);
  if (!features.privatePilot) throw new Error("Private-pilot fixtures require CAREPOINT_PRIVATE_PILOT=true.");
  if (process.env.CAREPOINT_PILOT_FIXTURES_CONFIRM !== CONFIRMATION) {
    throw new Error(`CAREPOINT_PILOT_FIXTURES_CONFIRM must equal ${CONFIRMATION}.`);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "").toLowerCase();
  if (!/(pilot|staging|uat)/.test(databaseName)) {
    throw new Error("The target database name must contain pilot, staging or uat.");
  }
  const password = process.env.CAREPOINT_PILOT_FIXTURE_PASSWORD;
  if (!password || password.length < 16) throw new Error("CAREPOINT_PILOT_FIXTURE_PASSWORD must contain at least 16 characters.");
  const domain = process.env.CAREPOINT_PILOT_FIXTURE_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error("CAREPOINT_PILOT_FIXTURE_EMAIL_DOMAIN must be an explicit valid domain.");
  }
  return { password, domain };
}

async function userFor(persona: Persona, password: string, domain: string) {
  const email = `${persona.localPart}@${domain}`;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== persona.role) throw new Error(`Fixture ${persona.key} conflicts with an existing role.`);
  const user = existing ?? await prisma.user.create({ data: { email, passwordHash: hashPassword(password), role: persona.role } });
  if (persona.role === "PATIENT" && persona.firstName && persona.lastName) {
    await prisma.patientProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, firstName: persona.firstName, lastName: persona.lastName },
      update: {},
    });
  }
  return user;
}

async function providerFor(userId: string, kind: ProviderClass, displayName: string) {
  const current = await prisma.provider.findUnique({ where: { userId } });
  if (current && current.class !== kind) throw new Error(`Provider fixture ${displayName} conflicts with an existing provider class.`);
  return current ?? prisma.provider.create({ data: { userId, class: kind, displayName, legalName: displayName, status: "ACTIVE" } });
}

async function doctorFixture(userId: string, suffix: string) {
  const provider = await providerFor(userId, "DOCTOR", `Synthetic Doctor ${suffix}`);
  const specialty = await prisma.medicalSpecialty.findUnique({ where: { code: "GENMED" } });
  if (!specialty) throw new Error("GENMED reference data is missing; run db:bootstrap first.");
  const profile = await prisma.doctorProfile.upsert({
    where: { providerId: provider.id },
    create: { providerId: provider.id, licenseNumber: `SYN-PILOT-DOC-${suffix}`, licenseIssuer: "SYNTHETIC" },
    update: {},
  });
  await prisma.doctorSpecialty.upsert({
    where: { doctorId_specialtyId: { doctorId: profile.id, specialtyId: specialty.id } },
    create: { doctorId: profile.id, specialtyId: specialty.id, primary: true },
    update: { primary: true },
  });
  await ensureCredential(provider.id, `SYN-PILOT-DOC-${suffix}`);
  await ensureService(provider.id, `Synthetic Clinic Consultation ${suffix}`, "CLINIC");
}

async function otherProviderFixture(userId: string, suffix: string) {
  const provider = await providerFor(userId, "OTHER_PROVIDER", `Synthetic Provider ${suffix}`);
  const category = await prisma.providerCategory.findUnique({ where: { slug: "nursing" } });
  if (!category) throw new Error("Nursing reference data is missing; run db:bootstrap first.");
  await prisma.otherProviderProfile.upsert({
    where: { providerId: provider.id },
    create: { providerId: provider.id, categoryId: category.id },
    update: {},
  });
  await ensureCredential(provider.id, `SYN-PILOT-OTH-${suffix}`);
  await ensureService(provider.id, `Synthetic Home Visit ${suffix}`, "HOME_VISIT");
}

async function ensureCredential(providerId: string, number: string) {
  const existing = await prisma.providerCredential.findFirst({ where: { providerId, number } });
  if (existing) return;
  await prisma.providerCredential.create({
    data: {
      providerId,
      type: "professional-license",
      issuer: "SYNTHETIC",
      number,
      status: "VERIFIED",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: new Date("2030-12-31T23:59:59Z"),
    },
  });
}

async function ensureService(providerId: string, name: string, modality: "CLINIC" | "HOME_VISIT") {
  const service = await prisma.service.findFirst({ where: { providerId, name } })
    ?? await prisma.service.create({ data: { providerId, name, description: "Synthetic private-pilot fixture", currency: "USD" } });
  await prisma.serviceModality.upsert({
    where: { serviceId_modality: { serviceId: service.id, modality } },
    create: { serviceId: service.id, modality, durationMinutes: 30, priceMinor: 0 },
    update: { active: true },
  });
}

async function main() {
  const { password, domain } = requirePilotSafety();
  const users = new Map<string, Awaited<ReturnType<typeof userFor>>>();
  for (const persona of personas) users.set(persona.key, await userFor(persona, password, domain));
  await doctorFixture(users.get("doctor-a")!.id, "A");
  await doctorFixture(users.get("doctor-b")!.id, "B");
  await otherProviderFixture(users.get("other-provider-a")!.id, "A");
  await otherProviderFixture(users.get("other-provider-b")!.id, "B");
  console.log(`Private-pilot synthetic fixtures ready: ${[...users.keys()].join(", ")}.`);
  console.log("Passwords and database identifiers were not printed.");
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : "Private-pilot fixture bootstrap failed."); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
