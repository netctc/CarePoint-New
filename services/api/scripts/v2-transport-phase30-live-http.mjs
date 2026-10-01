import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { registerTestPatient } from "./support/register-test-patient.mjs";

const base = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const prisma = new PrismaClient();
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const providerPassword = process.env.SLICE6_DOCTOR_PASSWORD;
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD;

if (!adminPassword || !providerPassword || !patientPassword) {
  throw new Error("Phase 30 CI credentials must be provided through environment variables.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Phase 30 live acceptance must never run with NODE_ENV=production.");
}

const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

async function raw(path, { method = "GET", token, body } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = "Bearer " + token;
  const response = await fetch(base + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : Buffer.from(await response.arrayBuffer());
  return { status: response.status, payload, contentType, headers: response.headers };
}

async function request(path, options = {}) {
  const result = await raw(path, options);
  if (result.status < 200 || result.status >= 300) {
    const body = Buffer.isBuffer(result.payload)
      ? result.payload.toString("utf8")
      : JSON.stringify(result.payload);
    throw new Error((options.method || "GET") + " " + path + " -> " + result.status + " " + body);
  }
  return result.payload;
}

async function login(email, password) {
  const result = await request("/iam/login", {
    method: "POST",
    body: { email, password },
  });
  if (!result.accessToken) throw new Error("No access token for " + email);
  return result.accessToken;
}

async function createPatient(label) {
  const email = "phase30-" + label + "-" + suffix + "@carepoint.test";
  await registerTestPatient({
    base,
    email,
    password: patientPassword,
    firstName: "Phase30",
    lastName: label,
  });
  const token = await login(email, patientPassword);
  const user = await prisma.user.findUnique({
    where: { email },
    include: { patientProfile: true },
  });
  if (!user?.patientProfile) throw new Error("Phase 30 patient fixture missing: " + email);
  return { email, token, user, patient: user.patientProfile };
}

async function createGroundProvider(adminToken) {
  const email = "phase30-ground-" + suffix + "@carepoint.test";
  await request("/iam/accounts", {
    method: "POST",
    token: adminToken,
    body: {
      email,
      password: providerPassword,
      role: "OTHER_PROVIDER",
    },
  });
  const [user, category] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.providerCategory.findFirst({
      where: { family: "MEDICAL_TRANSPORT_GROUND", active: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!user || !category) throw new Error("Phase 30 ground provider prerequisite missing.");
  const provider = await prisma.provider.create({
    data: {
      userId: user.id,
      class: "OTHER_PROVIDER",
      displayName: "Phase 30 Ground " + suffix,
      status: "ACTIVE",
      otherProviderProfile: { create: { categoryId: category.id } },
    },
  });
  return {
    email,
    token: await login(email, providerPassword),
    user,
    provider,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const adminToken = await login("admin-ci@carepoint.test", adminPassword);
  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: "admin-ci@carepoint.test" },
  });
  const patientA = await createPatient("patient-a");
  const patientB = await createPatient("patient-b");
  const ground = await createGroundProvider(adminToken);

  const patientDeniedAdmin = await raw("/admin/transport/command-center", {
    token: patientA.token,
  });
  assert(patientDeniedAdmin.status === 403, "Patient unexpectedly gained transport admin access.");

  const capabilities = await request("/transport/location/capabilities", {
    token: patientA.token,
  });
  assert(capabilities.savedLocationsAvailable === true, "Saved locations capability is unavailable.");
  assert(capabilities.routeProvider === "none", "Phase 30 CI must exercise no-route-provider fallback.");
  assert(capabilities.routePreviewAvailable === false, "Route preview should be disabled without a provider.");

  const saved = await request("/transport/location/saved", {
    method: "POST",
    token: patientA.token,
    body: {
      label: "Phase 30 Home",
      kind: "HOME",
      address: "Phase 30 Home Address",
      latitude: 33.8938,
      longitude: 35.5018,
      source: "PHASE30_CI",
    },
  });
  assert(saved.id, "Saved location creation returned no id.");

  const patientBSaved = await request("/transport/location/saved", {
    token: patientB.token,
  });
  assert(
    !JSON.stringify(patientBSaved).includes(saved.id),
    "Saved location leaked across patients.",
  );
  const patientBMutation = await raw("/transport/location/saved/" + saved.id, {
    method: "PATCH",
    token: patientB.token,
    body: {
      label: "Unauthorized",
      kind: "OTHER",
      address: "Unauthorized",
    },
  });
  assert(patientBMutation.status === 404, "Cross-patient saved location mutation was not hidden.");

  const updatedSaved = await request("/transport/location/saved/" + saved.id, {
    method: "PATCH",
    token: patientA.token,
    body: {
      label: "Phase 30 Home Updated",
      kind: "HOME",
      address: "Phase 30 Home Address Updated",
      latitude: 33.8938,
      longitude: 35.5018,
      source: "PHASE30_CI",
    },
  });
  assert(updatedSaved.label === "Phase 30 Home Updated", "Saved location update failed.");

  const routeFallback = await request("/transport/location/route-preview", {
    method: "POST",
    token: patientA.token,
    body: {
      mode: "GROUND",
      pickup: { address: "Phase 30 Pickup" },
      destination: { address: "Phase 30 Destination" },
      languageCode: "en",
    },
  });
  assert(routeFallback.available === false, "Route fallback unexpectedly reported an external route.");
  assert(routeFallback.reason === "NOT_CONFIGURED", "Route fallback reason is not NOT_CONFIGURED.");

  const scheduledFor = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const requestBody = {
    clientRequestId: "phase30-request-" + suffix,
    mode: "GROUND",
    scheduledFor,
    pickupLatitude: 33.8938,
    pickupLongitude: 35.5018,
    pickupAddress: "PHASE30-PICKUP-" + suffix,
    destinationLatitude: 33.888,
    destinationLongitude: 35.515,
    destinationAddress: "PHASE30-DESTINATION-" + suffix,
    assistance: "WHEELCHAIR",
    companionCount: 1,
    equipment: ["OXYGEN"],
    callbackPhone: "+966500000030",
  };
  const transport = await request("/medical-transport", {
    method: "POST",
    token: patientA.token,
    body: requestBody,
  });
  const requestId = transport.request?.id;
  assert(requestId, "Phase 30 transport request was not created.");

  const accepted = await request("/provider/medical-transport/" + requestId + "/accept", {
    method: "POST",
    token: ground.token,
    body: {},
  });
  assert(accepted.assignedProviderId === ground.provider.id, "Provider acceptance mismatch.");

  const unit = await request("/admin/transport/providers/" + ground.provider.id + "/units", {
    method: "POST",
    token: adminToken,
    body: {
      code: "P30-" + suffix,
      registrationCode: "P30-REG-" + suffix,
      mode: "GROUND",
      capabilities: ["WHEELCHAIR", "OXYGEN"],
      active: true,
    },
  });
  assert(unit.id, "Transport unit creation failed.");

  const resourceOptions = await request("/provider/medical-transport/" + requestId + "/resources", {
    token: ground.token,
  });
  assert(
    resourceOptions.options?.units?.some((item) => item.id === unit.id),
    "Compatible transport unit is missing from resource options.",
  );
  assert(
    resourceOptions.options?.crew?.some((item) => item.id === ground.provider.id),
    "Eligible provider is missing from crew options.",
  );

  const resourceBody = {
    transportUnitId: unit.id,
    crewProviderIds: [ground.provider.id],
    idempotencyKey: "phase30-resource-" + suffix,
  };
  const resources = await request("/provider/medical-transport/" + requestId + "/resources", {
    method: "PATCH",
    token: ground.token,
    body: resourceBody,
  });
  assert(resources.current?.transportUnit?.id === unit.id, "Transport resources were not persisted.");
  const resourcesReplay = await request("/provider/medical-transport/" + requestId + "/resources", {
    method: "PATCH",
    token: ground.token,
    body: resourceBody,
  });
  assert(
    resourcesReplay.current?.assignmentId === resources.current?.assignmentId,
    "Resource idempotency replay created a different assignment.",
  );

  const trackingBeforeDeparture = await raw(
    "/provider/medical-transport/" + requestId + "/tracking/start",
    {
      method: "POST",
      token: ground.token,
      body: { shareWithPatient: true },
    },
  );
  assert(trackingBeforeDeparture.status === 409, "Tracking started before EN_ROUTE.");

  const enRoute = await request("/provider/medical-transport/" + requestId + "/status", {
    method: "POST",
    token: ground.token,
    body: { status: "EN_ROUTE", etaMinutes: 18 },
  });
  assert(enRoute.status === "EN_ROUTE", "Transport did not enter EN_ROUTE.");

  const missingConsent = await raw(
    "/provider/medical-transport/" + requestId + "/tracking/start",
    {
      method: "POST",
      token: ground.token,
      body: { shareWithPatient: false },
    },
  );
  assert(missingConsent.status === 400, "Tracking started without explicit patient sharing.");

  const trackingStart = await request(
    "/provider/medical-transport/" + requestId + "/tracking/start",
    {
      method: "POST",
      token: ground.token,
      body: { shareWithPatient: true },
    },
  );
  assert(trackingStart.sharingStatus === "ACTIVE", "Tracking session did not become active.");

  const beforeHeartbeat = await request("/medical-transport/" + requestId + "/tracking", {
    token: patientA.token,
  });
  assert(
    beforeHeartbeat.visible === false &&
      beforeHeartbeat.visibilityStatus === "WAITING_FOR_HEARTBEAT",
    "Patient tracking should wait for the first heartbeat.",
  );

  const heartbeatBody = {
    clientEventId: "phase30-heartbeat-" + suffix,
    latitude: requestBody.pickupLatitude,
    longitude: requestBody.pickupLongitude,
    accuracyMeters: 5,
    headingDegrees: 90,
    speedKph: 20,
    capturedAt: new Date().toISOString(),
  };
  const heartbeat = await request(
    "/provider/medical-transport/" + requestId + "/tracking/heartbeat",
    {
      method: "POST",
      token: ground.token,
      body: heartbeatBody,
    },
  );
  assert(heartbeat.replayed === false, "First telemetry heartbeat was marked as replayed.");

  const heartbeatReplay = await request(
    "/provider/medical-transport/" + requestId + "/tracking/heartbeat",
    {
      method: "POST",
      token: ground.token,
      body: heartbeatBody,
    },
  );
  assert(heartbeatReplay.replayed === true, "Telemetry idempotency replay was not detected.");
  assert(
    heartbeatReplay.telemetry?.id === heartbeat.telemetry?.id,
    "Telemetry replay returned a different persisted sample.",
  );

  const patientTracking = await request("/medical-transport/" + requestId + "/tracking", {
    token: patientA.token,
  });
  assert(patientTracking.visible === true, "Patient cannot see explicitly shared live tracking.");
  assert(patientTracking.visibilityStatus === "AVAILABLE", "Patient tracking is not AVAILABLE.");
  assert(
    Number(patientTracking.location?.latitude) === requestBody.pickupLatitude &&
      Number(patientTracking.location?.longitude) === requestBody.pickupLongitude,
    "Patient live coordinates do not match the accepted heartbeat.",
  );

  const otherPatientTracking = await raw("/medical-transport/" + requestId + "/tracking", {
    token: patientB.token,
  });
  assert(otherPatientTracking.status === 404, "Live tracking leaked to another patient.");

  const timeline = await request("/medical-transport/" + requestId + "/timeline", {
    token: patientA.token,
  });
  assert(timeline.automaticLifecycleMutation === false, "Milestones gained lifecycle authority.");
  assert(
    timeline.items?.some((item) => item.kind === "MILESTONE"),
    "No automated transport milestone was recorded.",
  );

  const telemetryOverview = await request("/admin/transport/telemetry", {
    token: adminToken,
  });
  assert(
    JSON.stringify(telemetryOverview).includes(requestId),
    "Admin telemetry overview does not include the live request.",
  );

  const statusBeforeSmartDispatch = (
    await prisma.medicalTransportRequest.findUniqueOrThrow({ where: { id: requestId } })
  ).status;
  const smart = await request("/admin/transport/smart-dispatch/evaluate", {
    method: "POST",
    token: adminToken,
    body: {},
  });
  assert(smart.autoAssignmentPerformed === false, "Smart dispatch auto-assigned a provider.");
  assert(smart.automaticLifecycleMutation === false, "Smart dispatch mutated lifecycle authority.");
  assert(
    smart.items?.some((item) => item.requestId === requestId),
    "Smart dispatch did not evaluate the Phase 30 request.",
  );
  const statusAfterSmartDispatch = (
    await prisma.medicalTransportRequest.findUniqueOrThrow({ where: { id: requestId } })
  ).status;
  assert(
    statusAfterSmartDispatch === statusBeforeSmartDispatch,
    "Smart dispatch changed the authoritative request status.",
  );

  const [liveOps, analytics, commandCenter] = await Promise.all([
    request("/admin/transport/live-operations", { token: adminToken }),
    request("/admin/transport/performance-analytics?windowDays=7&forecastDays=3", {
      token: adminToken,
    }),
    request("/admin/transport/command-center?windowDays=7&page=1&limit=200", {
      token: adminToken,
    }),
  ]);
  assert(JSON.stringify(liveOps).includes(requestId), "Live operations omitted the active request.");
  assert(analytics.generatedAt, "Performance analytics returned no generatedAt.");
  assert(JSON.stringify(commandCenter).includes(requestId), "Command center omitted the active request.");

  const stopped = await request(
    "/provider/medical-transport/" + requestId + "/tracking/stop",
    {
      method: "POST",
      token: ground.token,
      body: { reason: "PRIVACY_STOP" },
    },
  );
  assert(stopped.sharingStatus === "STOPPED", "Tracking stop was not persisted.");
  const patientTrackingStopped = await request(
    "/medical-transport/" + requestId + "/tracking",
    { token: patientA.token },
  );
  assert(
    patientTrackingStopped.visible === false &&
      patientTrackingStopped.visibilityStatus === "STOPPED",
    "Patient tracking remained visible after privacy stop.",
  );

  const telemetryAudit = await prisma.auditEvent.findFirst({
    where: {
      action: "MEDICAL_TRANSPORT_TELEMETRY_RECEIVED",
      objectId: requestId,
    },
    orderBy: { createdAt: "desc" },
  });
  const telemetryAuditJson = JSON.stringify(telemetryAudit?.metadata ?? {});
  assert(!telemetryAuditJson.includes("latitude"), "Latitude leaked into telemetry audit metadata.");
  assert(!telemetryAuditJson.includes("longitude"), "Longitude leaked into telemetry audit metadata.");

  const schedule = await request("/admin/transport/report-schedules", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Phase 30 Live Report " + suffix,
      cadence: "DAILY",
      hourUtc: 0,
      minuteUtc: 0,
      windowDays: 7,
      artifactRetentionDays: 7,
      mode: "ALL",
      sla: "ALL",
      enabled: true,
    },
  });
  assert(schedule.id, "Transport report schedule was not created.");

  const destination = await request("/admin/transport/report-destinations", {
    method: "POST",
    token: adminToken,
    body: {
      scheduleId: schedule.id,
      label: "Phase 30 Admin Recipient",
      recipientAccountId: adminUser.id,
      channel: "EMAIL",
    },
  });
  assert(destination.id, "Transport report destination was not created.");

  await prisma.transportManagementReportSchedule.update({
    where: { id: schedule.id },
    data: { nextRunAt: new Date(Date.now() - 60_000) },
  });

  await request("/admin/transport/report-runs/queue-due", {
    method: "POST",
    token: adminToken,
    body: {},
  });
  const run = await prisma.transportManagementReportRun.findFirst({
    where: { scheduleId: schedule.id, status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  assert(run, "Due report schedule did not create a QUEUED run.");

  const runList = await request("/admin/transport/report-runs?status=QUEUED&limit=200", {
    token: adminToken,
  });
  assert(JSON.stringify(runList).includes(run.id), "Queued run is missing from admin report-runs.");

  const executed = await request("/admin/transport/report-runs/" + run.id + "/execute", {
    method: "POST",
    token: adminToken,
    body: {},
  });
  assert(executed.status === "SUCCEEDED", "Transport report execution did not succeed.");
  assert(executed.artifactStorageProvider === "LOCAL_PRIVATE", "CI report artifact is not private local storage.");
  assert(executed.publicUrlIssued === false, "Report execution exposed a public URL.");
  assert(executed.artifactSha256, "Report execution produced no SHA-256 evidence.");

  const handoff = await request(
    "/admin/transport/report-runs/" + run.id + "/prepare-delivery-handoff",
    {
      method: "POST",
      token: adminToken,
      body: {},
    },
  );
  assert(
    handoff.deliveryStatus === "DELIVERY_OUTBOX_READY",
    "Report handoff did not create a durable delivery outbox.",
  );
  assert(handoff.publicUrlIssued === false, "Delivery handoff exposed a public URL.");
  assert(
    handoff.deliveryOutbox?.configuredDestinations === 1,
    "Delivery handoff did not see the configured destination.",
  );

  const deliveries = await request("/admin/transport/report-deliveries", {
    token: adminToken,
  });
  assert(JSON.stringify(deliveries).includes(run.id), "Delivery outbox does not reference the report run.");
  assert(
    !JSON.stringify(deliveries).includes("artifactObjectKey"),
    "Delivery list exposed the private object-storage key.",
  );

  const grant = await request(
    "/admin/transport/report-runs/" + run.id + "/download-grant",
    {
      method: "POST",
      token: adminToken,
      body: {},
    },
  );
  assert(grant.oneTime === true, "Download grant is not one-time.");
  assert(grant.publicUrlIssued === false, "Download grant exposed a public URL.");
  assert(grant.tokenTransport === "SAME_ORIGIN_POST_BODY", "Unexpected download token transport.");
  assert(typeof grant.grantToken === "string" && grant.grantToken.length >= 40, "Download grant token is invalid.");

  const downloaded = await raw("/admin/transport/report-runs/" + run.id + "/download", {
    method: "POST",
    token: adminToken,
    body: { grantToken: grant.grantToken },
  });
  assert(downloaded.status === 200, "Secure report download failed.");
  assert(Buffer.isBuffer(downloaded.payload), "Secure report download did not return binary content.");
  assert(downloaded.contentType.includes("text/csv"), "Secure report download is not CSV.");
  const csv = downloaded.payload.toString("utf8");
  assert(csv.includes("requestId"), "Downloaded report is missing management-report headers.");
  for (const sensitive of [
    requestBody.pickupAddress,
    requestBody.destinationAddress,
    requestBody.callbackPhone,
    patientA.email,
    patientA.patient.firstName,
    patientA.patient.lastName,
  ]) {
    assert(
      !csv.includes(String(sensitive)),
      "Sensitive patient data leaked into management-report CSV.",
    );
  }

  const replayDownload = await raw("/admin/transport/report-runs/" + run.id + "/download", {
    method: "POST",
    token: adminToken,
    body: { grantToken: grant.grantToken },
  });
  assert(replayDownload.status === 400, "One-time report grant was reusable.");

  const storedRun = await prisma.transportManagementReportRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  assert(storedRun.artifactIntegrityStatus === "VERIFIED", "Download did not verify artifact integrity.");

  const manifest = await request(
    "/admin/transport/report-runs/" + run.id + "/compliance-manifest",
    { token: adminToken },
  );
  assert(
    manifest.manifest?.schemaVersion === "carepoint.transport.governance-manifest.v1",
    "Compliance manifest schema version is invalid.",
  );
  assert(manifest.integrity?.algorithm === "SHA-256", "Compliance manifest hash algorithm is invalid.");
  assert(
    manifest.signature?.status === "EXTERNAL_SIGNING_REQUIRED" &&
      manifest.signature?.cryptographicSignaturePerformed === false,
    "Compliance manifest incorrectly claims a cryptographic signature.",
  );
  for (const field of [
    "rawAuditMetadataIncluded",
    "objectStorageKeyIncluded",
    "csvContentIncluded",
    "patientIdentityIncluded",
    "patientContactIncluded",
    "patientLocationIncluded",
  ]) {
    assert(manifest.exportPolicy?.[field] === false, "Compliance export policy drifted for " + field);
  }
  const manifestJson = JSON.stringify(manifest);
  assert(!manifestJson.includes(requestBody.pickupAddress), "Pickup address leaked into compliance manifest.");
  assert(!manifestJson.includes(requestBody.destinationAddress), "Destination address leaked into compliance manifest.");
  assert(!manifestJson.includes(requestBody.callbackPhone), "Callback phone leaked into compliance manifest.");

  const deletedSaved = await request("/transport/location/saved/" + saved.id, {
    method: "DELETE",
    token: patientA.token,
  });
  assert(deletedSaved.deleted === true, "Saved location cleanup through API failed.");

  console.log(
    JSON.stringify({
      status: "passed",
      savedLocationIsolation: true,
      routePreviewFallback: routeFallback.reason,
      resourceAssignmentId: resources.current.assignmentId,
      telemetryReplay: heartbeatReplay.replayed,
      patientTrackingVisible: patientTracking.visible,
      smartDispatchNonMutating: statusAfterSmartDispatch === statusBeforeSmartDispatch,
      reportRunStatus: executed.status,
      deliveryStatus: handoff.deliveryStatus,
      downloadOneTime: replayDownload.status === 400,
      artifactIntegrityStatus: storedRun.artifactIntegrityStatus,
      complianceManifestSha256: manifest.integrity.manifestSha256,
    }),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
