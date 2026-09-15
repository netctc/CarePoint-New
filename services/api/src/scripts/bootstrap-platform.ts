import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { hashPassword } from "@carepoint/identity";

const prisma = new PrismaClient();

const specialties = [
  ["CARD", { en: "Cardiology", ar: "أمراض القلب", fr: "Cardiologie", es: "Cardiología" }],
  ["NEUR", { en: "Neurology", ar: "طب الأعصاب", fr: "Neurologie", es: "Neurología" }],
  ["PED", { en: "Pediatrics", ar: "طب الأطفال", fr: "Pédiatrie", es: "Pediatría" }],
  ["DERM", { en: "Dermatology", ar: "الأمراض الجلدية", fr: "Dermatologie", es: "Dermatología" }],
  ["GENMED", { en: "General Medicine", ar: "الطب العام", fr: "Médecine générale", es: "Medicina general" }],
] as const;

const categories = [
  {
    slug: "nursing",
    labels: { en: "Nursing / ATS", ar: "التمريض / ATS", fr: "Soins infirmiers / ATS", es: "Enfermería / ATS" },
    family: "NON_DOCTOR_HEALTHCARE",
    requiredCredentialTypes: ["professional-license"],
    enabledModalities: ["CLINIC", "HOME_VISIT"],
  },
  {
    slug: "physiotherapy",
    labels: { en: "Physiotherapy", ar: "العلاج الطبيعي", fr: "Physiothérapie", es: "Fisioterapia" },
    family: "NON_DOCTOR_HEALTHCARE",
    requiredCredentialTypes: ["professional-license"],
    enabledModalities: ["CLINIC", "TELEMEDICINE", "HOME_VISIT"],
  },
  {
    slug: "nutrition",
    labels: { en: "Nutrition", ar: "التغذية", fr: "Nutrition", es: "Nutrición" },
    family: "NON_DOCTOR_HEALTHCARE",
    requiredCredentialTypes: ["professional-license"],
    enabledModalities: ["CLINIC", "TELEMEDICINE", "HOME_VISIT"],
  },
  {
    slug: "emergency-ambulance",
    labels: { en: "Emergency Ambulance", ar: "إسعاف طارئ", fr: "Ambulance d’urgence", es: "Ambulancia de urgencias" },
    family: "EMERGENCY_AMBULANCE",
    requiredCredentialTypes: ["transport-license", "emergency-medical-license"],
    enabledModalities: [],
  },
  {
    slug: "ground-medical-transport",
    labels: { en: "Ground Medical Transport", ar: "نقل طبي بري", fr: "Transport médical terrestre", es: "Transporte médico terrestre" },
    family: "MEDICAL_TRANSPORT_GROUND",
    requiredCredentialTypes: ["transport-license"],
    enabledModalities: [],
  },
  {
    slug: "air-medical-transport",
    labels: { en: "Air Medical Transport", ar: "نقل طبي جوي", fr: "Transport médical aérien", es: "Transporte médico aéreo" },
    family: "MEDICAL_TRANSPORT_AIR",
    requiredCredentialTypes: ["transport-license", "aviation-medical-approval"],
    enabledModalities: [],
  },
] as const;

async function seedReferenceData(): Promise<void> {
  for (const [code, labels] of specialties) {
    await prisma.medicalSpecialty.upsert({
      where: { code },
      create: { code, labels: labels as unknown as Prisma.InputJsonValue },
      update: { labels: labels as unknown as Prisma.InputJsonValue, active: true },
    });
  }
  for (const category of categories) {
    await prisma.providerCategory.upsert({
      where: { slug: category.slug },
      create: {
        slug: category.slug,
        labels: category.labels as unknown as Prisma.InputJsonValue,
        family: category.family,
        requiredCredentialTypes: [...category.requiredCredentialTypes] as unknown as Prisma.InputJsonValue,
        capabilities: { enabledModalities: [...category.enabledModalities] },
      },
      update: {
        labels: category.labels as unknown as Prisma.InputJsonValue,
        family: category.family,
        requiredCredentialTypes: [...category.requiredCredentialTypes] as unknown as Prisma.InputJsonValue,
        capabilities: { enabledModalities: [...category.enabledModalities] },
        active: true,
      },
    });
  }
}

async function bootstrapAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!email || !password) throw new Error("BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be provided together.");
  const existingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (existingAdmin) {
    console.log(`Admin bootstrap skipped: an ADMIN account already exists (${existingAdmin.email}).`);
    return;
  }
  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) throw new Error("Bootstrap admin email is already used by another account.");
  const admin = await prisma.user.create({ data: { email, passwordHash: hashPassword(password), role: "ADMIN" } });
  console.log(`Bootstrap ADMIN created: ${admin.email}`);
}

async function main(): Promise<void> {
  await seedReferenceData();
  await bootstrapAdmin();
  console.log("CarePoint reference data bootstrap completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
