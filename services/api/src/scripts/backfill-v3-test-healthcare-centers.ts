import { PrismaClient } from "@prisma/client";

const APPLY_CONFIRMATION = "APPLY_V3_HEALTHCARE_CENTER_BACKFILL";
const LABEL_PREFIX = "CarePoint V3 Synthetic Clinic";
const DEFAULT_FIXTURE_DOMAIN = "carepoint.test";

function stableOffset(value: string, span: number) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return (hash % span) - Math.floor(span / 2);
}

function syntheticLocation(serviceId: string, sequence: number) {
  const latitude = 24.7136 + stableOffset(serviceId + ":lat", 19) * 0.003;
  const longitude = 46.6753 + stableOffset(serviceId + ":lng", 23) * 0.003;
  return {
    label: `${LABEL_PREFIX} · ${serviceId.slice(0, 8)}`,
    addressLine1: `${120 + (sequence % 70)} CarePoint Test Health District`,
    city: "Riyadh",
    region: "Riyadh",
    postalCode: `12${String(100 + (sequence % 899)).padStart(3, "0")}`,
    countryCode: "SA",
    latitude,
    longitude,
    arrivalInstructions: "Synthetic V3 test location. Report to the main reception desk.",
    addressValidatedAt: new Date(),
    active: true,
  };
}

async function main() {
  const prisma = new PrismaClient();
  const apply = process.argv.includes("--apply");
  const fixtureDomain =
    process.env.CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN?.trim().toLowerCase() ||
    DEFAULT_FIXTURE_DOMAIN;

  if (
    apply &&
    process.env.CAREPOINT_V3_HEALTHCARE_BACKFILL_CONFIRM !== APPLY_CONFIRMATION
  ) {
    throw new Error(
      `Refusing to mutate data. Set CAREPOINT_V3_HEALTHCARE_BACKFILL_CONFIRM=${APPLY_CONFIRMATION} and pass --apply.`,
    );
  }

  let eligible = 0;
  let alreadyReady = 0;
  let planned = 0;
  let createdLocations = 0;
  let linkedContexts = 0;
  let protectedExistingContexts = 0;

  try {
    const services = await prisma.service.findMany({
      where: {
        active: true,
        provider: { status: "ACTIVE" },
        modalities: {
          some: {
            modality: "CLINIC",
            active: true,
          },
        },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        providerId: true,
        provider: {
          select: {
            displayName: true,
            user: { select: { email: true } },
          },
        },
      },
      take: 1000,
    });

    const syntheticServices = services.filter((service) =>
      service.provider.user?.email?.toLowerCase().endsWith(`@${fixtureDomain}`),
    );

    for (const [index, service] of syntheticServices.entries()) {
      eligible++;
      const context = await prisma.serviceDeliveryContext.findFirst({
        where: { serviceId: service.id, modality: "CLINIC" },
      });

      if (context?.clinicLocationId) {
        const location = await prisma.providerLocation.findUnique({
          where: { id: context.clinicLocationId },
          select: {
            id: true,
            active: true,
            addressValidatedAt: true,
            providerId: true,
          },
        });
        if (
          location?.active === true &&
          location.addressValidatedAt != null &&
          location.providerId === service.providerId
        ) {
          alreadyReady++;
          continue;
        }

        protectedExistingContexts++;
        console.warn(
          `[SKIP] ${service.provider.displayName} / ${service.name}: existing CLINIC context points to a non-ready location; left untouched.`,
        );
        continue;
      }

      planned++;
      const desired = syntheticLocation(service.id, index);
      if (!apply) {
        console.log(
          `[PLAN] ${service.provider.displayName} / ${service.name} -> ${desired.label}`,
        );
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const current = await tx.serviceDeliveryContext.findFirst({
          where: { serviceId: service.id, modality: "CLINIC" },
        });
        if (current?.clinicLocationId) return;

        let location = await tx.providerLocation.findFirst({
          where: {
            providerId: service.providerId,
            label: desired.label,
          },
        });

        if (!location) {
          location = await tx.providerLocation.create({
            data: {
              providerId: service.providerId,
              ...desired,
            },
          });
          createdLocations++;
        } else if (!location.active || location.addressValidatedAt == null) {
          location = await tx.providerLocation.update({
            where: { id: location.id },
            data: {
              active: true,
              addressValidatedAt: location.addressValidatedAt ?? new Date(),
            },
          });
        }

        if (current) {
          await tx.serviceDeliveryContext.update({
            where: { id: current.id },
            data: {
              clinicLocationId: location.id,
              clinicArrivalInstructions:
                current.clinicArrivalInstructions ??
                "Report to the main reception desk.",
            },
          });
        } else {
          await tx.serviceDeliveryContext.create({
            data: {
              serviceId: service.id,
              modality: "CLINIC",
              clinicLocationId: location.id,
              clinicArrivalInstructions:
                "Report to the main reception desk.",
            },
          });
        }
        linkedContexts++;
      });
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? "APPLY" : "DRY_RUN",
          fixtureDomain,
          eligibleSyntheticClinicServices: eligible,
          alreadyReady,
          planned,
          createdLocations,
          linkedContexts,
          protectedExistingContexts,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "V3 healthcare-centre backfill failed.",
  );
  process.exitCode = 1;
});
