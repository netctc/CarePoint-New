import "dotenv/config";
import { Prisma, PrismaClient, type AppointmentModality, type ProviderClass, type UserRole } from "@prisma/client";
import { hashPassword } from "@carepoint/identity";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
const CONFIRMATION = "CREATE_SYNTHETIC_TEST_FIXTURES";
const ALLOWED_MODALITIES: AppointmentModality[] = ["CLINIC", "TELEMEDICINE", "HOME_VISIT"];
const PATIENT_COUNT = 5;
const HISTORY_DAYS = 30;
const FUTURE_DAYS = 30;
const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16];

type FixtureConfig = {
  password: string;
  domain: string;
  timezone: string;
};

type ManagedUser = {
  key: string;
  email: string;
  role: UserRole;
  userId: string;
};

type SchedulableService = {
  providerId: string;
  serviceId: string;
  modalities: AppointmentModality[];
  durationMinutes: number;
};

function safeLocalPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  return normalized || "unknown";
}

function requireTestSafety(): FixtureConfig {
  if (process.env.CAREPOINT_TEST_FIXTURES_CONFIRM !== CONFIRMATION) {
    throw new Error(`CAREPOINT_TEST_FIXTURES_CONFIRM must equal ${CONFIRMATION}.`);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "").toLowerCase();
  if (!/(test|pilot|staging|uat)/.test(databaseName)) {
    throw new Error("Refusing test fixtures: database name must contain test, pilot, staging or uat.");
  }
  const password = process.env.CAREPOINT_TEST_FIXTURE_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error("CAREPOINT_TEST_FIXTURE_PASSWORD must contain at least 16 characters.");
  }
  const domain = process.env.CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error("CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN must be a valid explicit domain such as carepoint.test.");
  }
  const tz = process.env.CAREPOINT_TEST_FIXTURE_TIMEZONE?.trim() || "Asia/Riyadh";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    throw new Error("CAREPOINT_TEST_FIXTURE_TIMEZONE must be a valid IANA timezone.");
  }
  return { password, domain, timezone: tz };
}

async function managedUser(email: string, role: UserRole, password: string): Promise<ManagedUser> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== role) throw new Error(`Fixture email ${email} already belongs to role ${existing.role}.`);
  const passwordHash = hashPassword(password);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, role, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null },
      })
    : await prisma.user.create({
        data: { email, passwordHash, role, status: "ACTIVE" },
      });

  // These are synthetic accounts owned by this bootstrap. Reset only their auth
  // state so repeated fixture loads keep a known password and force fresh MFA setup.
  await prisma.authSession.deleteMany({ where: { userId: user.id } });
  await prisma.authChallenge.deleteMany({ where: { userId: user.id } });
  await prisma.mfaEnrollment.deleteMany({ where: { userId: user.id } });

  return { key: email.slice(0, email.indexOf("@")), email, role, userId: user.id };
}

async function ensurePatient(user: ManagedUser, index: number) {
  const profile = await prisma.patientProfile.upsert({
    where: { userId: user.userId },
    create: {
      userId: user.userId,
      firstName: "Synthetic",
      lastName: `Patient ${String(index).padStart(2, "0")}`,
      phone: `+96655510${String(index).padStart(3, "0")}`,
    },
    update: {
      firstName: "Synthetic",
      lastName: `Patient ${String(index).padStart(2, "0")}`,
      phone: `+96655510${String(index).padStart(3, "0")}`,
    },
  });
  return profile;
}

async function ensureProvider(userId: string, kind: ProviderClass, displayName: string) {
  const existing = await prisma.provider.findUnique({ where: { userId } });
  if (existing && existing.class !== kind) throw new Error(`Provider ${displayName} has incompatible class ${existing.class}.`);
  if (existing) {
    return prisma.provider.update({
      where: { id: existing.id },
      data: { displayName, legalName: displayName, status: "ACTIVE" },
    });
  }
  return prisma.provider.create({
    data: { userId, class: kind, displayName, legalName: displayName, status: "ACTIVE" },
  });
}

async function ensureCredential(providerId: string, number: string, type = "professional-license") {
  const current = await prisma.providerCredential.findFirst({ where: { providerId, number } });
  const data = {
    type,
    issuer: "SYNTHETIC-TEST",
    number,
    validFrom: dayjs().subtract(1, "year").toDate(),
    validUntil: dayjs().add(2, "year").toDate(),
    status: "VERIFIED",
  };
  if (current) return prisma.providerCredential.update({ where: { id: current.id }, data });
  return prisma.providerCredential.create({ data: { providerId, ...data } });
}

async function ensureService(
  providerId: string,
  name: string,
  modalities: AppointmentModality[],
  durationMinutes = 30,
): Promise<SchedulableService | null> {
  const validModalities = [...new Set(modalities)].filter((value): value is AppointmentModality => ALLOWED_MODALITIES.includes(value));
  if (validModalities.length === 0) return null;
  const labels = { en: name, ar: name, fr: name, es: name } as Prisma.InputJsonValue;
  let service = await prisma.service.findFirst({ where: { providerId, name } });
  if (!service) {
    service = await prisma.service.create({
      data: {
        providerId,
        name,
        labels,
        description: "Synthetic integral-test service",
        descriptionLabels: labels,
        currency: "SAR",
        active: true,
      },
    });
  } else {
    service = await prisma.service.update({
      where: { id: service.id },
      data: { labels, description: "Synthetic integral-test service", descriptionLabels: labels, currency: "SAR", active: true },
    });
  }
  for (const modality of validModalities) {
    await prisma.serviceModality.upsert({
      where: { serviceId_modality: { serviceId: service.id, modality } },
      create: { serviceId: service.id, modality, durationMinutes, priceMinor: 15000, active: true },
      update: { durationMinutes, priceMinor: 15000, active: true },
    });
  }
  return { providerId, serviceId: service.id, modalities: validModalities, durationMinutes };
}

function categoryModalities(capabilities: Prisma.JsonValue): AppointmentModality[] {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return [];
  const raw = (capabilities as Record<string, unknown>).enabledModalities;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is AppointmentModality =>
    typeof value === "string" && ALLOWED_MODALITIES.includes(value as AppointmentModality),
  );
}

async function ensureDoctors(config: FixtureConfig, credentials: ManagedUser[], services: SchedulableService[]) {
  const specialties = await prisma.medicalSpecialty.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  if (specialties.length === 0) throw new Error("No active medical specialties exist. Run npm run db:bootstrap first.");

  for (const specialty of specialties) {
    const code = safeLocalPart(specialty.code);
    const user = await managedUser(`test.doctor.${code}@${config.domain}`, "DOCTOR", config.password);
    credentials.push(user);
    const provider = await ensureProvider(user.userId, "DOCTOR", `Dr. Synthetic ${specialty.code}`);
    const profile = await prisma.doctorProfile.upsert({
      where: { providerId: provider.id },
      create: { providerId: provider.id, licenseNumber: `TEST-DOC-${specialty.code}`, licenseIssuer: "SYNTHETIC-TEST" },
      update: { licenseNumber: `TEST-DOC-${specialty.code}`, licenseIssuer: "SYNTHETIC-TEST" },
    });
    await prisma.doctorSpecialty.upsert({
      where: { doctorId_specialtyId: { doctorId: profile.id, specialtyId: specialty.id } },
      create: { doctorId: profile.id, specialtyId: specialty.id, primary: true },
      update: { primary: true },
    });
    await ensureCredential(provider.id, `TEST-DOC-${specialty.code}`, "medical-license");
    const service = await ensureService(
      provider.id,
      `Synthetic ${specialty.code} Consultation`,
      ["CLINIC", "TELEMEDICINE", "HOME_VISIT"],
      30,
    );
    if (service) services.push(service);
  }
}

async function ensureOtherProviders(config: FixtureConfig, credentials: ManagedUser[], services: SchedulableService[]) {
  const categories = await prisma.providerCategory.findMany({ where: { active: true }, orderBy: { slug: "asc" } });
  if (categories.length === 0) throw new Error("No active provider categories exist. Run npm run db:bootstrap first.");

  for (const category of categories) {
    const slug = safeLocalPart(category.slug);
    const user = await managedUser(`test.provider.${slug}@${config.domain}`, "OTHER_PROVIDER", config.password);
    credentials.push(user);
    const provider = await ensureProvider(user.userId, "OTHER_PROVIDER", `Synthetic Provider ${category.slug}`);
    await prisma.otherProviderProfile.upsert({
      where: { providerId: provider.id },
      create: { providerId: provider.id, categoryId: category.id },
      update: { categoryId: category.id },
    });

    const required = Array.isArray(category.requiredCredentialTypes)
      ? category.requiredCredentialTypes.filter((value): value is string => typeof value === "string")
      : [];
    if (required.length === 0) {
      await ensureCredential(provider.id, `TEST-PRV-${slug.toUpperCase()}`);
    } else {
      for (const [index, type] of required.entries()) {
        await ensureCredential(provider.id, `TEST-PRV-${slug.toUpperCase()}-${index + 1}`, type);
      }
    }

    const modalities = categoryModalities(category.capabilities);
    const service = await ensureService(provider.id, `Synthetic ${category.slug} Service`, modalities, 45);
    if (service) services.push(service);
  }
}

async function ensureAvailability(services: SchedulableService[], config: FixtureConfig) {
  const today = dayjs().tz(config.timezone).startOf("day");
  const until = today.add(FUTURE_DAYS, "day");
  const ruleMap = new Map<string, string>();

  for (const service of services) {
    for (const modality of service.modalities) {
      for (let weekday = 0; weekday <= 6; weekday += 1) {
        const existing = await prisma.availabilityRule.findFirst({
          where: {
            providerId: service.providerId,
            serviceId: service.serviceId,
            modality,
            timezone: config.timezone,
            weekday,
            startMinute: 9 * 60,
            endMinute: 17 * 60,
          },
        });
        const ruleData = {
          providerId: service.providerId,
          serviceId: service.serviceId,
          modality,
          timezone: config.timezone,
          weekday,
          startMinute: 9 * 60,
          endMinute: 17 * 60,
          intervalMinutes: 60,
          slotCapacity: 2,
          effectiveFrom: new Date(`${today.format("YYYY-MM-DD")}T00:00:00.000Z`),
          effectiveUntil: new Date(`${until.format("YYYY-MM-DD")}T00:00:00.000Z`),
          active: true,
        };
        const rule = existing
          ? await prisma.availabilityRule.update({ where: { id: existing.id }, data: ruleData })
          : await prisma.availabilityRule.create({ data: ruleData });
        ruleMap.set(`${service.serviceId}|${modality}|${weekday}`, rule.id);
      }
    }
  }

  const slots: Prisma.AvailabilitySlotCreateManyInput[] = [];
  for (let offset = 0; offset <= FUTURE_DAYS; offset += 1) {
    const date = today.add(offset, "day");
    for (const service of services) {
      for (const modality of service.modalities) {
        const ruleId = ruleMap.get(`${service.serviceId}|${modality}|${date.day()}`) ?? null;
        for (const hour of SLOT_HOURS) {
          const startsAt = dayjs.tz(`${date.format("YYYY-MM-DD")}T${String(hour).padStart(2, "0")}:00:00`, config.timezone);
          if (startsAt.isBefore(dayjs().add(1, "hour"))) continue;
          slots.push({
            providerId: service.providerId,
            serviceId: service.serviceId,
            modality,
            startsAt: startsAt.toDate(),
            endsAt: startsAt.add(service.durationMinutes, "minute").toDate(),
            capacity: 2,
            bookedCount: 0,
            status: "OPEN",
            sourceRuleId: ruleId,
          });
        }
      }
    }
  }
  const result = slots.length
    ? await prisma.availabilitySlot.createMany({ data: slots, skipDuplicates: true })
    : { count: 0 };
  return { candidateCount: slots.length, createdCount: result.count };
}

async function ensureHistory(patientIds: string[], services: SchedulableService[], config: FixtureConfig) {
  if (patientIds.length === 0 || services.length === 0) return 0;
  let count = 0;
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo -= 2) {
    const index = count % services.length;
    const service = services[index]!;
    const patientId = patientIds[count % patientIds.length]!;
    const modality = service.modalities[count % service.modalities.length]!;
    const date = dayjs().tz(config.timezone).subtract(daysAgo, "day");
    const startsAt = dayjs.tz(`${date.format("YYYY-MM-DD")}T${String(10 + (count % 5)).padStart(2, "0")}:00:00`, config.timezone);
    const statusCycle = ["COMPLETED", "COMPLETED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
    const status = statusCycle[count % statusCycle.length]!;
    const key = `test-history-${date.format("YYYYMMDD")}-${safeLocalPart(service.providerId).slice(0, 12)}-${count}`;
    await prisma.appointment.upsert({
      where: { idempotencyKey: key },
      create: {
        patientId,
        providerId: service.providerId,
        serviceId: service.serviceId,
        idempotencyKey: key,
        modality,
        status,
        startsAt: startsAt.toDate(),
        endsAt: startsAt.add(service.durationMinutes, "minute").toDate(),
        cancelledAt: status === "CANCELLED" ? startsAt.subtract(1, "day").toDate() : null,
        cancellationReason: status === "CANCELLED" ? "Synthetic test cancellation" : null,
      },
      update: {
        patientId,
        providerId: service.providerId,
        serviceId: service.serviceId,
        modality,
        status,
        startsAt: startsAt.toDate(),
        endsAt: startsAt.add(service.durationMinutes, "minute").toDate(),
        cancelledAt: status === "CANCELLED" ? startsAt.subtract(1, "day").toDate() : null,
        cancellationReason: status === "CANCELLED" ? "Synthetic test cancellation" : null,
      },
    });
    count += 1;
  }
  return count;
}

async function main() {
  const config = requireTestSafety();
  const credentials: ManagedUser[] = [];

  const admin = await managedUser(`test.admin@${config.domain}`, "ADMIN", config.password);
  const support = await managedUser(`test.support@${config.domain}`, "SUPPORT", config.password);
  credentials.push(admin, support);

  const patientIds: string[] = [];
  for (let index = 1; index <= PATIENT_COUNT; index += 1) {
    const user = await managedUser(`test.patient.${String(index).padStart(2, "0")}@${config.domain}`, "PATIENT", config.password);
    credentials.push(user);
    const patient = await ensurePatient(user, index);
    patientIds.push(patient.id);
  }

  const services: SchedulableService[] = [];
  await ensureDoctors(config, credentials, services);
  await ensureOtherProviders(config, credentials, services);

  const availability = await ensureAvailability(services, config);
  const historyCount = await ensureHistory(patientIds, services, config);

  console.log("");
  console.log("CarePoint synthetic integral-test fixtures are ready.");
  console.log(`Managed users: ${credentials.length}; patients: ${patientIds.length}; schedulable services: ${services.length}.`);
  console.log(`Historical appointments: ${historyCount}; future slot candidates: ${availability.candidateCount}; newly created slots: ${availability.createdCount}.`);
  console.log(`Fixture timezone: ${config.timezone}; horizon: last ${HISTORY_DAYS} days / next ${FUTURE_DAYS} days.`);
  console.log("");
  console.log("Login accounts (all use CAREPOINT_TEST_FIXTURE_PASSWORD):");
  for (const item of credentials) console.log(`  ${item.role.padEnd(14)} ${item.email}`);
  console.log("");
  console.log("MFA state for these synthetic users was reset. ADMIN/DOCTOR/OTHER_PROVIDER will be prompted to enroll MFA on first login where policy requires it.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Synthetic test fixture bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
