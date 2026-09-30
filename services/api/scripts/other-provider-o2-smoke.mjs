import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@carepoint/identity";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const password = process.env.SLICE6_PATIENT_PASSWORD;
if (!password) throw new Error("SLICE6_PATIENT_PASSWORD is required for Other Provider O2 acceptance.");

const prisma = new PrismaClient();
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const providerEmail = `provider-o2-${stamp}@carepoint.test`;
const patientEmail = `patient-o2-${stamp}@carepoint.test`;
const categorySlug = `o2-capability-${stamp}`;
let providerId;
let patientId;
let categoryId;

function assert(ok, message) { if (!ok) throw new Error(message); }

async function call(path, { method = "GET", token, body, expected } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  const allowed = expected === undefined ? null : (Array.isArray(expected) ? expected : [expected]);
  if (allowed) assert(allowed.includes(response.status), `${method} ${path} expected ${allowed.join("/")} but got ${response.status}: ${text}`);
  else assert(response.ok, `${method} ${path} failed ${response.status}: ${text}`);
  return { response, payload, text };
}

async function cleanup() {
  if (providerId) {
    const orders = await prisma.clinicalOrder.findMany({ where: { providerId }, select: { id: true } });
    if (orders.length > 0) await prisma.laboratoryResult.deleteMany({ where: { orderId: { in: orders.map((item) => item.id) } } });
    await prisma.clinicalOrder.deleteMany({ where: { providerId } });
    await prisma.appointment.deleteMany({ where: { providerId } });
    await prisma.availabilitySlot.deleteMany({ where: { providerId } });
    await prisma.availabilityRule.deleteMany({ where: { providerId } });
    await prisma.service.deleteMany({ where: { providerId } });
    await prisma.provider.deleteMany({ where: { id: providerId } });
  }
  if (patientId) await prisma.patientProfile.deleteMany({ where: { id: patientId } });
  await prisma.user.deleteMany({ where: { email: { in: [providerEmail, patientEmail] } } });
  if (categoryId) await prisma.providerCategory.deleteMany({ where: { id: categoryId } });
  else await prisma.providerCategory.deleteMany({ where: { slug: categorySlug } });
}

function serviceBody(name, modality) {
  return {
    labels: { en: name, ar: name, fr: name, es: name },
    currency: "USD",
    modalities: [{ modality, durationMinutes: 30, priceMinor: 5000 }],
  };
}

try {
  await cleanup();
  const passwordHash = hashPassword(password);
  const category = await prisma.providerCategory.create({
    data: {
      slug: categorySlug,
      labels: { en: "O2 Lab Provider", ar: "مزود مختبر O2", fr: "Prestataire laboratoire O2", es: "Proveedor de laboratorio O2" },
      family: "DIAGNOSTIC",
      active: true,
      requiredCredentialTypes: [],
      capabilities: {
        enabledModalities: ["CLINIC"],
        clinicalOrderCapabilities: ["LABORATORY"],
      },
    },
  });
  categoryId = category.id;

  const providerUser = await prisma.user.create({ data: { email: providerEmail, passwordHash, role: "OTHER_PROVIDER" } });
  const provider = await prisma.provider.create({
    data: {
      userId: providerUser.id,
      class: "OTHER_PROVIDER",
      displayName: "O2 Lab Provider",
      status: "ACTIVE",
      otherProviderProfile: { create: { categoryId: category.id } },
    },
  });
  providerId = provider.id;

  const patientUser = await prisma.user.create({
    data: {
      email: patientEmail,
      passwordHash,
      role: "PATIENT",
      patientProfile: { create: { firstName: "O2", lastName: "Patient" } },
    },
    include: { patientProfile: true },
  });
  patientId = patientUser.patientProfile.id;

  const providerLogin = await call("/iam/login", { method: "POST", body: { email: providerEmail, password }, expected: 201 });
  const providerToken = providerLogin.payload.accessToken;
  assert(providerToken, "O2 provider login did not issue access token.");

  const deniedService = await call("/provider/services", {
    method: "POST",
    token: providerToken,
    body: serviceBody(`O2 forbidden home ${stamp}`, "HOME_VISIT"),
    expected: 403,
  });
  assert(/not authorized for service modalities.*HOME_VISIT/i.test(deniedService.text), "O2 forbidden service modality did not identify HOME_VISIT.");
  assert(await prisma.service.count({ where: { providerId, name: `O2 forbidden home ${stamp}` } }) === 0, "O2 denied service modality mutated persistence.");

  const clinicService = (await call("/provider/services", {
    method: "POST",
    token: providerToken,
    body: serviceBody(`O2 clinic ${stamp}`, "CLINIC"),
    expected: 201,
  })).payload;
  assert(clinicService.id && clinicService.modalities?.some((item) => item.modality === "CLINIC"), "O2 allowed CLINIC service was not created.");

  const today = new Date();
  const dateOnly = (value) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  const clinicRule = (await call("/provider/availability/rules", {
    method: "POST",
    token: providerToken,
    body: {
      serviceId: clinicService.id,
      modality: "CLINIC",
      timezone: "Asia/Beirut",
      weekday: today.getUTCDay(),
      startMinute: 540,
      endMinute: 720,
      intervalMinutes: 30,
      slotCapacity: 1,
      effectiveFrom: dateOnly(today),
    },
    expected: 201,
  })).payload;
  assert(clinicRule.id && clinicRule.modality === "CLINIC", "O2 allowed CLINIC availability rule was not created.");

  const legacyService = await prisma.service.create({
    data: {
      providerId,
      name: `O2 legacy home ${stamp}`,
      labels: { en: "Legacy Home", ar: "Legacy Home", fr: "Legacy Home", es: "Legacy Home" },
      currency: "USD",
      active: false,
      modalities: { create: [{ modality: "HOME_VISIT", durationMinutes: 30, priceMinor: 5000, active: true }] },
    },
  });

  await call(`/provider/services/${legacyService.id}/status`, {
    method: "PATCH",
    token: providerToken,
    body: { active: true },
    expected: 403,
  });
  const legacyAfterActivationDeny = await prisma.service.findUnique({ where: { id: legacyService.id } });
  assert(legacyAfterActivationDeny?.active === false, "O2 denied legacy service activation mutated service state.");

  const activeLegacyService = await prisma.service.create({
    data: {
      providerId,
      name: `O2 active legacy home ${stamp}`,
      labels: { en: "Active Legacy Home", ar: "Active Legacy Home", fr: "Active Legacy Home", es: "Active Legacy Home" },
      currency: "USD",
      active: true,
      modalities: { create: [{ modality: "HOME_VISIT", durationMinutes: 30, priceMinor: 5000, active: true }] },
    },
  });

  await call("/provider/availability/rules", {
    method: "POST",
    token: providerToken,
    body: {
      serviceId: activeLegacyService.id,
      modality: "HOME_VISIT",
      timezone: "Asia/Beirut",
      weekday: today.getUTCDay(),
      startMinute: 540,
      endMinute: 720,
      intervalMinutes: 30,
      slotCapacity: 1,
      effectiveFrom: dateOnly(today),
    },
    expected: 403,
  });
  assert(await prisma.availabilityRule.count({ where: { providerId, serviceId: activeLegacyService.id } }) === 0, "O2 denied legacy availability rule mutated persistence.");

  const legacyRule = await prisma.availabilityRule.create({
    data: {
      providerId,
      serviceId: activeLegacyService.id,
      modality: "HOME_VISIT",
      timezone: "Asia/Beirut",
      weekday: today.getUTCDay(),
      startMinute: 540,
      endMinute: 720,
      intervalMinutes: 30,
      slotCapacity: 1,
      effectiveFrom: new Date(`${dateOnly(today)}T00:00:00.000Z`),
      active: true,
    },
  });
  const slotsBefore = await prisma.availabilitySlot.count({ where: { providerId, sourceRuleId: legacyRule.id } });
  await call("/provider/availability/generate", {
    method: "POST",
    token: providerToken,
    body: { fromDate: dateOnly(today), toDate: dateOnly(new Date(today.getTime() + 6 * 86400000)), ruleId: legacyRule.id },
    expected: 403,
  });
  const slotsAfter = await prisma.availabilitySlot.count({ where: { providerId, sourceRuleId: legacyRule.id } });
  assert(slotsAfter === slotsBefore, "O2 denied legacy availability generation created slots.");

  const appointment = await prisma.appointment.create({
    data: {
      patientId,
      providerId,
      serviceId: clinicService.id,
      modality: "CLINIC",
      status: "COMPLETED",
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 30 * 60 * 1000),
    },
  });

  const prescriptionDenied = await call(`/clinical-orders/appointments/${appointment.id}/prescriptions`, {
    method: "POST",
    token: providerToken,
    body: {
      idempotencyKey: `o2-rx-${stamp}`,
      medication: { name: "O2 TEST MED" },
      dosageInstruction: "O2 test only",
    },
    expected: 403,
  });
  assert(/not authorized for PRESCRIPTION/i.test(prescriptionDenied.text), "O2 PRESCRIPTION capability denial is missing.");

  const labOrder = (await call(`/clinical-orders/appointments/${appointment.id}/laboratory`, {
    method: "POST",
    token: providerToken,
    body: {
      idempotencyKey: `o2-lab-${stamp}`,
      tests: [{ display: "O2 TEST" }],
      priority: "ROUTINE",
    },
    expected: 201,
  })).payload;
  assert(labOrder.id && labOrder.type === "LABORATORY" && labOrder.status === "SIGNED", "O2 allowed LABORATORY capability failed.");

  const resultBody = {
    observations: [{ display: "O2 TEST", value: "NORMAL", unit: "unit" }],
    conclusion: `O2 synthetic result ${stamp}`,
  };
  const entryDenied = await call(`/clinical-orders/${labOrder.id}/lab-result`, {
    method: "POST",
    token: providerToken,
    body: resultBody,
    expected: 403,
  });
  assert(/not authorized for LAB_RESULT_ENTRY/i.test(entryDenied.text), "O2 own-order LAB_RESULT_ENTRY bypass was not closed.");
  assert(await prisma.laboratoryResult.count({ where: { orderId: labOrder.id } }) === 0, "O2 denied LAB_RESULT_ENTRY created a result.");

  await prisma.providerCategory.update({
    where: { id: categoryId },
    data: { capabilities: { enabledModalities: ["CLINIC"], clinicalOrderCapabilities: ["LABORATORY", "LAB_RESULT_ENTRY"] } },
  });
  const entered = (await call(`/clinical-orders/${labOrder.id}/lab-result`, {
    method: "POST",
    token: providerToken,
    body: resultBody,
    expected: 201,
  })).payload;
  assert(entered.labResult?.status === "ENTERED", "O2 newly-enabled LAB_RESULT_ENTRY did not take effect.");

  const validateDenied = await call(`/clinical-orders/${labOrder.id}/lab-result/validate`, {
    method: "POST",
    token: providerToken,
    body: {},
    expected: 403,
  });
  assert(/not authorized for LAB_RESULT_VALIDATE/i.test(validateDenied.text), "O2 own-order LAB_RESULT_VALIDATE bypass was not closed.");
  let storedResult = await prisma.laboratoryResult.findUnique({ where: { orderId: labOrder.id } });
  assert(storedResult?.status === "ENTERED", "O2 denied validation mutated laboratory result state.");

  await prisma.providerCategory.update({
    where: { id: categoryId },
    data: { capabilities: { enabledModalities: ["CLINIC"], clinicalOrderCapabilities: ["LABORATORY", "LAB_RESULT_ENTRY", "LAB_RESULT_VALIDATE"] } },
  });
  const validated = (await call(`/clinical-orders/${labOrder.id}/lab-result/validate`, {
    method: "POST",
    token: providerToken,
    body: {},
    expected: 201,
  })).payload;
  assert(validated.labResult?.status === "VALIDATED", "O2 newly-enabled LAB_RESULT_VALIDATE did not take effect.");

  const released = (await call(`/clinical-orders/${labOrder.id}/lab-result/release`, {
    method: "POST",
    token: providerToken,
    body: {},
    expected: 201,
  })).payload;
  assert(released.status === "FULFILLED" && released.labResult?.status === "RELEASED", "O2 release path regressed after capability enforcement.");

  storedResult = await prisma.laboratoryResult.findUnique({ where: { orderId: labOrder.id } });
  assert(storedResult?.status === "RELEASED", "O2 laboratory result release did not persist.");

  console.log(JSON.stringify({
    status: "passed",
    phase: "Other-Provider-O2",
    categoryModalityEnforcement: true,
    deniedServiceNoMutation: true,
    allowedClinicService: true,
    allowedClinicAvailability: true,
    legacyServiceActivationProtected: true,
    legacyAvailabilityRuleProtected: true,
    legacyAvailabilityGenerationProtected: true,
    prescriptionCapabilityEnforced: true,
    laboratoryCapabilityAllowed: true,
    ownOrderLabEntryBypassClosed: true,
    labEntryDynamicCapability: true,
    ownOrderLabValidationBypassClosed: true,
    labValidationDynamicCapability: true,
    releaseRegressionSafe: true
  }));
} finally {
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
}
