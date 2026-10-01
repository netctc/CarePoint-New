import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

if (process.env.CAREPOINT_TRANSPORT_POSTGRES_ACCEPTANCE !== "true") {
  throw new Error(
    "CAREPOINT_TRANSPORT_POSTGRES_ACCEPTANCE=true is required for the Phase 29 PostgreSQL acceptance.",
  );
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Phase 29 PostgreSQL acceptance must never run with NODE_ENV=production.");
}

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { MedicalTransportService } = require("../dist/modules/transport/transport.module.js");

const db = new PrismaClient();
const runKey = "transport-phase29-" + randomUUID();
const createdUserIds = [];
const createdPatientIds = [];
const createdProviderIds = [];
const createdCategoryIds = [];
const audits = [];
const notifications = [];

const audit = {
  write: async (entry) => {
    audits.push(entry);
  },
};
const notificationGateway = {
  notifyAccount: async (entry) => {
    notifications.push(entry);
  },
};
const service = new MedicalTransportService(db, audit, notificationGateway);

let patient;
let otherPatient;
let providerA;
let providerB;
let groundCategory;
let admin;

function principal(accountId, role) {
  return { accountId, role, sessionId: runKey + ":" + role.toLowerCase() };
}

function futureIso(hours = 2) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function requestInput(clientRequestId, overrides = {}) {
  return {
    clientRequestId,
    mode: "GROUND",
    assistance: "WHEELCHAIR",
    companionCount: 1,
    equipment: ["OXYGEN"],
    scheduledFor: futureIso(),
    pickupAddress: "Phase 29 Pickup",
    destinationAddress: "Phase 29 Destination",
    callbackPhone: "+966500000000",
    ...overrides,
  };
}

function statusOf(error) {
  return typeof error?.getStatus === "function" ? error.getStatus() : null;
}

async function createAdmin() {
  const user = await db.user.create({
    data: {
      email: `${runKey}-admin@carepoint.test`,
      passwordHash: "phase29-not-a-login-secret",
      role: "ADMIN",
    },
  });
  createdUserIds.push(user.id);
  return {
    accountId: user.id,
    role: "ADMIN",
    sessionId: runKey + ":admin-session",
  };
}

async function createPatient(label) {
  const user = await db.user.create({
    data: {
      email: `${runKey}-${label}@carepoint.test`,
      passwordHash: "phase29-not-a-login-secret",
      role: "PATIENT",
      patientProfile: {
        create: {
          firstName: "Phase29",
          lastName: label,
          phone: "+966511111111",
        },
      },
    },
    include: { patientProfile: true },
  });
  createdUserIds.push(user.id);
  createdPatientIds.push(user.patientProfile.id);
  return {
    user,
    profile: user.patientProfile,
    principal: principal(user.id, "PATIENT"),
  };
}

async function createGroundProvider(label) {
  const user = await db.user.create({
    data: {
      email: `${runKey}-${label}@carepoint.test`,
      passwordHash: "phase29-not-a-login-secret",
      role: "OTHER_PROVIDER",
    },
  });
  createdUserIds.push(user.id);

  const provider = await db.provider.create({
    data: {
      userId: user.id,
      class: "OTHER_PROVIDER",
      displayName: "Phase 29 " + label,
      status: "ACTIVE",
      otherProviderProfile: {
        create: { categoryId: groundCategory.id },
      },
    },
  });
  createdProviderIds.push(provider.id);
  return {
    user,
    provider,
    principal: principal(user.id, "OTHER_PROVIDER"),
  };
}

async function cleanup() {
  const requests = createdPatientIds.length
    ? await db.medicalTransportRequest.findMany({
        where: { patientId: { in: createdPatientIds } },
        select: { id: true },
      })
    : [];
  const requestIds = requests.map((row) => row.id);

  if (requestIds.length) {
    await db.transportTripMilestone.deleteMany({
      where: { transportRequestId: { in: requestIds } },
    }).catch(() => undefined);
    await db.transportUnitTelemetry.deleteMany({
      where: { transportRequestId: { in: requestIds } },
    }).catch(() => undefined);
    await db.transportTrackingSession.deleteMany({
      where: { transportRequestId: { in: requestIds } },
    }).catch(() => undefined);
    await db.medicalTransportEvent.deleteMany({
      where: { transportRequestId: { in: requestIds } },
    });
    await db.medicalTransportRequest.deleteMany({
      where: { id: { in: requestIds } },
    });
  }

  if (createdProviderIds.length) {
    await db.otherProviderProfile.deleteMany({
      where: { providerId: { in: createdProviderIds } },
    });
    await db.provider.deleteMany({
      where: { id: { in: createdProviderIds } },
    });
  }
  if (createdPatientIds.length) {
    await db.patientProfile.deleteMany({
      where: { id: { in: createdPatientIds } },
    });
  }
  if (createdUserIds.length) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCategoryIds.length) {
    await db.providerCategory.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
  }
}

before(async () => {
  groundCategory = await db.providerCategory.create({
    data: {
      slug: runKey + "-ground",
      labels: { en: "Phase 29 Ground Transport" },
      family: "MEDICAL_TRANSPORT_GROUND",
      requiredCredentialTypes: [],
      capabilities: {},
      active: true,
    },
  });
  createdCategoryIds.push(groundCategory.id);

  admin = await createAdmin();
  patient = await createPatient("patient-a");
  otherPatient = await createPatient("patient-b");
  providerA = await createGroundProvider("provider-a");
  providerB = await createGroundProvider("provider-b");
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await db.$disconnect();
  }
});

test("Phase 29 PostgreSQL patient request is idempotent and patient-scoped", async () => {
  const input = requestInput(runKey + "-idem-request");
  const first = await service.createPatientRequest(patient.principal, input);
  const replay = await service.createPatientRequest(patient.principal, input);

  assert.equal(replay.request.id, first.request.id);
  assert.equal(
    await db.medicalTransportRequest.count({
      where: {
        patientId: patient.profile.id,
        clientRequestId: input.clientRequestId,
      },
    }),
    1,
  );
  assert.equal(
    await db.medicalTransportEvent.count({
      where: { transportRequestId: first.request.id, toStatus: "REQUESTED" },
    }),
    1,
  );

  await assert.rejects(
    () => service.getPatientRequest(otherPatient.principal, first.request.id),
    (error) => statusOf(error) === 404,
  );
});

test("Phase 29 PostgreSQL rejects incomplete locations without persisting a request", async () => {
  const clientRequestId = runKey + "-invalid-location";
  const before = await db.medicalTransportRequest.count({
    where: { patientId: patient.profile.id },
  });

  await assert.rejects(
    () =>
      service.createPatientRequest(
        patient.principal,
        requestInput(clientRequestId, {
          pickupAddress: undefined,
          pickupLatitude: undefined,
          pickupLongitude: undefined,
        }),
      ),
    (error) => statusOf(error) === 400,
  );

  assert.equal(
    await db.medicalTransportRequest.count({
      where: { patientId: patient.profile.id },
    }),
    before,
  );
});

test("Phase 29 PostgreSQL concurrent dispatch commits exactly one provider assignment", async () => {
  const created = await service.createPatientRequest(
    patient.principal,
    requestInput(runKey + "-concurrent-assign"),
  );

  const results = await Promise.allSettled([
    service.assign(admin, created.request.id, {
      providerId: providerA.provider.id,
      etaMinutes: 20,
    }),
    service.assign(admin, created.request.id, {
      providerId: providerB.provider.id,
      etaMinutes: 25,
    }),
  ]);

  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(results.filter((row) => row.status === "rejected").length, 1);
  for (const row of results) {
    if (row.status === "rejected") {
      assert.equal(statusOf(row.reason), 409, String(row.reason));
    }
  }

  const stored = await db.medicalTransportRequest.findUniqueOrThrow({
    where: { id: created.request.id },
  });
  assert.equal(stored.status, "ASSIGNED");
  assert.ok(
    [providerA.provider.id, providerB.provider.id].includes(
      stored.assignedProviderId,
    ),
  );
  assert.equal(
    await db.medicalTransportEvent.count({
      where: { transportRequestId: created.request.id, toStatus: "ASSIGNED" },
    }),
    1,
  );
});

test("Phase 29 PostgreSQL provider lifecycle rejects skips and preserves exact event order", async () => {
  const created = await service.createPatientRequest(
    patient.principal,
    requestInput(runKey + "-lifecycle"),
  );
  await service.assign(admin, created.request.id, {
    providerId: providerA.provider.id,
    etaMinutes: 15,
  });

  await assert.rejects(
    () =>
      service.providerUpdate(providerB.principal, created.request.id, {
        status: "EN_ROUTE",
      }),
    (error) => statusOf(error) === 404,
  );

  await assert.rejects(
    () =>
      service.providerUpdate(providerA.principal, created.request.id, {
        status: "ARRIVED",
      }),
    (error) => statusOf(error) === 409,
  );

  assert.equal(
    (
      await db.medicalTransportRequest.findUniqueOrThrow({
        where: { id: created.request.id },
      })
    ).status,
    "ASSIGNED",
  );

  for (const [index, status] of [
    "EN_ROUTE",
    "ARRIVED",
    "TRANSPORTING",
    "COMPLETED",
  ].entries()) {
    await service.providerUpdate(providerA.principal, created.request.id, {
      status,
      etaMinutes: index === 0 ? 12 : undefined,
    });
  }

  const events = await db.medicalTransportEvent.findMany({
    where: { transportRequestId: created.request.id },
    select: { fromStatus: true, toStatus: true },
  });
  assert.equal(events.length, 6);
  const transitions = new Map(
    events.map((row) => [
      String(row.fromStatus ?? "NULL") + "->" + row.toStatus,
      (events.filter(
        (candidate) =>
          candidate.fromStatus === row.fromStatus &&
          candidate.toStatus === row.toStatus,
      ).length),
    ]),
  );
  for (const transition of [
    "NULL->REQUESTED",
    "REQUESTED->ASSIGNED",
    "ASSIGNED->EN_ROUTE",
    "EN_ROUTE->ARRIVED",
    "ARRIVED->TRANSPORTING",
    "TRANSPORTING->COMPLETED",
  ]) {
    assert.equal(transitions.get(transition), 1, transition);
  }

  const stored = await db.medicalTransportRequest.findUniqueOrThrow({
    where: { id: created.request.id },
  });
  assert.equal(stored.status, "COMPLETED");
  assert.ok(stored.enRouteAt);
  assert.ok(stored.arrivedAt);
  assert.ok(stored.transportingAt);
  assert.ok(stored.completedAt);
});

test("Phase 29 PostgreSQL cancellation is persistence-idempotent and blocked after departure", async () => {
  const cancellable = await service.createPatientRequest(
    patient.principal,
    requestInput(runKey + "-cancel"),
  );
  await service.cancelPatientRequest(patient.principal, cancellable.request.id, {
    reason: "Phase 29 cancellation",
  });
  await service.cancelPatientRequest(patient.principal, cancellable.request.id, {
    reason: "Phase 29 cancellation replay",
  });

  assert.equal(
    (
      await db.medicalTransportRequest.findUniqueOrThrow({
        where: { id: cancellable.request.id },
      })
    ).status,
    "CANCELLED",
  );
  assert.equal(
    await db.medicalTransportEvent.count({
      where: {
        transportRequestId: cancellable.request.id,
        toStatus: "CANCELLED",
      },
    }),
    1,
  );

  const departed = await service.createPatientRequest(
    patient.principal,
    requestInput(runKey + "-departed-cancel"),
  );
  await service.assign(admin, departed.request.id, {
    providerId: providerA.provider.id,
  });
  await service.providerUpdate(providerA.principal, departed.request.id, {
    status: "EN_ROUTE",
  });

  await assert.rejects(
    () =>
      service.cancelPatientRequest(patient.principal, departed.request.id, {
        reason: "Too late",
      }),
    (error) => statusOf(error) === 409,
  );
  assert.equal(
    (
      await db.medicalTransportRequest.findUniqueOrThrow({
        where: { id: departed.request.id },
      })
    ).status,
    "EN_ROUTE",
  );
});

test("Phase 29 PostgreSQL transport-family mismatch cannot assign a ground provider to AIR", async () => {
  const created = await service.createPatientRequest(
    patient.principal,
    requestInput(runKey + "-air-mismatch", { mode: "AIR" }),
  );

  await assert.rejects(
    () =>
      service.assign(admin, created.request.id, {
        providerId: providerA.provider.id,
      }),
    (error) => statusOf(error) === 400,
  );

  const stored = await db.medicalTransportRequest.findUniqueOrThrow({
    where: { id: created.request.id },
  });
  assert.equal(stored.status, "REQUESTED");
  assert.equal(stored.assignedProviderId, null);
});

test("Phase 29 service emits bounded domain audit and notification intents", () => {
  const actions = new Set(audits.map((entry) => entry.action));
  for (const action of [
    "MEDICAL_TRANSPORT_REQUESTED",
    "MEDICAL_TRANSPORT_ASSIGNED",
    "MEDICAL_TRANSPORT_EN_ROUTE",
    "MEDICAL_TRANSPORT_ARRIVED",
    "MEDICAL_TRANSPORT_TRANSPORTING",
    "MEDICAL_TRANSPORT_COMPLETED",
    "MEDICAL_TRANSPORT_CANCELLED",
  ]) {
    assert.equal(actions.has(action), true, `missing audit intent ${action}`);
  }
  assert.ok(notifications.length > 0);
  assert.equal(
    notifications.some((entry) => "latitude" in entry || "longitude" in entry),
    false,
  );
});

console.log("Transport Phase 29 PostgreSQL transactional acceptance passed");
