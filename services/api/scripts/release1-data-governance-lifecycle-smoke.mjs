import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { roleHasPermission } from "@carepoint/identity";

const require = createRequire(import.meta.url);
const { DataGovernanceService } = require("../dist/modules/data-governance/data-governance.service.js");
const { DocumentStorageService } = require("../dist/modules/documents/document-storage.service.js");
const { DatabaseAuditService } = require("../dist/infrastructure/audit/audit.service.js");

const prisma = new PrismaClient();
const storageRoot = `/tmp/carepoint-retention-${process.pid}-${Date.now()}`;
const approval = "CI-RETENTION-APPROVAL-001";

process.env.NODE_ENV = "test";
process.env.DOCUMENT_STORAGE_PROVIDER = "local";
process.env.DOCUMENT_STORAGE_LOCAL_ROOT = storageRoot;
process.env.DATA_RESIDENCY_JURISDICTION = "CI-JURISDICTION";
process.env.DATA_RESIDENCY_REGION = "ci-region-1";
process.env.DATA_RESIDENCY_POLICY_VERSION = "ci-residency-v1";
process.env.DATA_RESIDENCY_EVIDENCE_REFERENCE = "CI-R3-EVIDENCE";
process.env.DATABASE_DEPLOYMENT_REGION = "ci-region-1";
process.env.REDIS_DEPLOYMENT_REGION = "ci-region-1";
process.env.DATA_RETENTION_EXECUTION_ENABLED = "true";
process.env.DATA_RETENTION_EXECUTION_MODE = "manual";
process.env.DATA_RETENTION_APPROVAL_REFERENCE = approval;
process.env.DATA_RETENTION_BATCH_SIZE = "100";
process.env.DATA_RETENTION_POLICY_JSON = JSON.stringify({
  version: "ci-release1-retention-v1",
  rules: [
    { dataClass: "AUTH_EPHEMERAL", action: "DELETE", retentionDays: 1 },
    { dataClass: "IDENTITY_PROFILE", action: "PRESERVE" },
    { dataClass: "CLINICAL_RECORD", action: "DELETE", retentionDays: 1 },
    { dataClass: "CLINICAL_DOCUMENT", action: "PURGE", retentionDays: 1 },
    { dataClass: "DIAGNOSTIC_REPORT", action: "DELETE", retentionDays: 1 },
    { dataClass: "CONSENT", action: "PRESERVE" },
    { dataClass: "FINANCIAL", action: "PRESERVE" },
    { dataClass: "COMMUNICATION", action: "DELETE", retentionDays: 1 },
    { dataClass: "AUDIT_SECURITY", action: "PRESERVE" },
  ],
});

assert.equal(roleHasPermission("ADMIN", "DATA_GOVERNANCE_MANAGE"), true);
assert.equal(roleHasPermission("PATIENT", "DATA_GOVERNANCE_MANAGE"), false);
assert.equal(roleHasPermission("DOCTOR", "DATA_GOVERNANCE_MANAGE"), false);

const audit = new DatabaseAuditService(prisma, {}, { wake() {} });
const storage = new DocumentStorageService();
const governance = new DataGovernanceService(prisma, audit, storage);
const principal = { accountId: `ci-retention-admin-${Date.now()}`, role: "ADMIN", sessionId: "ci-retention-session" };
const suffix = `${process.pid}-${Date.now()}`;
const heldEmail = `retention-held-${suffix}@carepoint.test`;
const purgeEmail = `retention-purge-${suffix}@carepoint.test`;
const old = new Date(Date.now() - 3 * 86_400_000);
const objectKey = `retention/${suffix}/document.enc`;
let heldUser;
let purgeUser;
let documentId;
let holdId;

try {
  heldUser = await prisma.user.create({
    data: { email: heldEmail, passwordHash: "retention-test", role: "PATIENT", patientProfile: { create: { firstName: "Held", lastName: "Retention" } } },
    include: { patientProfile: true },
  });
  purgeUser = await prisma.user.create({
    data: { email: purgeEmail, passwordHash: "retention-test", role: "PATIENT", patientProfile: { create: { firstName: "Purge", lastName: "Retention" } } },
    include: { patientProfile: true },
  });
  const heldPatientId = heldUser.patientProfile.id;
  const purgePatientId = purgeUser.patientProfile.id;

  const heldRecord = await prisma.clinicalRecord.create({
    data: { patientId: heldPatientId, providerId: "ci-provider-held", encounterRef: null, algorithm: "TEST", keyId: "test", wrappedKey: "test", iv: "test", ciphertext: "encrypted-held", createdAt: old },
  });
  const purgeRecord = await prisma.clinicalRecord.create({
    data: { patientId: purgePatientId, providerId: "ci-provider-purge", encounterRef: null, algorithm: "TEST", keyId: "test", wrappedKey: "test", iv: "test", ciphertext: "encrypted-purge", createdAt: old },
  });

  await storage.put(objectKey, "encrypted-document-ciphertext");
  const document = await prisma.clinicalDocument.create({
    data: {
      patientId: purgePatientId,
      providerId: null,
      encounterRef: null,
      orderId: null,
      kind: "PATIENT_UPLOAD",
      status: "AVAILABLE",
      storageMode: "ENCRYPTED_BLOB",
      storageProvider: "LOCAL_PRIVATE",
      objectKey,
      mediaType: "application/pdf",
      byteLength: 12,
      contentDigest: "digest",
      blobAlgorithm: "TEST",
      blobKeyId: "test",
      blobWrappedKey: "test",
      blobIv: "test",
      metadataAlgorithm: "TEST",
      metadataKeyId: "test",
      metadataWrappedKey: "test",
      metadataIv: "test",
      metadataCiphertext: "encrypted-metadata",
      releasedToPatient: true,
      createdByAccountId: purgeUser.id,
      createdAt: old,
    },
  });
  documentId = document.id;

  const report = await prisma.diagnosticReport.create({
    data: {
      patientId: purgePatientId,
      providerId: "ci-provider-purge",
      encounterRef: `retention-encounter-${suffix}`,
      documentId: null,
      type: "OTHER",
      status: "FINAL",
      algorithm: "TEST",
      keyId: "test",
      wrappedKey: "test",
      iv: "test",
      ciphertext: "encrypted-report",
      payloadDigest: "digest",
      createdAt: old,
    },
  });

  const conversation = await prisma.careConversation.create({
    data: {
      patientId: purgePatientId,
      appointmentId: null,
      createdByAccountId: purgeUser.id,
      clientConversationId: `retention-${suffix}`,
      status: "CLOSED",
      subjectAlgorithm: "TEST",
      subjectKeyId: "test",
      subjectWrappedKey: "test",
      subjectIv: "test",
      subjectCiphertext: "encrypted-subject",
      lastMessageAt: old,
      closedAt: old,
      createdAt: old,
    },
  });

  const sentinelAudit = await prisma.auditEvent.create({
    data: { actorId: null, action: "RETENTION_IMMUTABILITY_SENTINEL", objectType: "SECURITY_EVIDENCE", objectId: null, purpose: "TEST", result: "SUCCESS", metadata: { safe: true }, occurredAt: old },
  });

  const hold = await governance.createHold(principal, {
    scope: "PATIENT",
    scopeId: heldPatientId,
    dataClass: "CLINICAL_RECORD",
    reasonCode: "LEGAL",
    approvalReference: "CI-HOLD-APPROVAL-001",
  });
  holdId = hold.id;

  const status = await governance.status();
  assert.equal(status.residency.region, "ci-region-1");
  assert.equal(status.retention.policyVersion, "ci-release1-retention-v1");
  assert.equal(status.invariants.auditGenericDeletionAllowed, false);

  const dryRun = await governance.runRetention(principal, { mode: "DRY_RUN" });
  assert.equal(dryRun.totals.processed, 0);
  const dryClinical = dryRun.results.find((row) => row.dataClass === "CLINICAL_RECORD");
  assert.equal(dryClinical.examined >= 2, true);
  assert.equal(dryClinical.held >= 1, true);

  await assert.rejects(
    () => governance.runRetention(principal, { mode: "EXECUTE", approvalReference: "WRONG-APPROVAL" }),
    /approval reference does not match/,
  );

  const executed = await governance.runRetention(principal, { mode: "EXECUTE", approvalReference: approval });
  assert.equal(executed.totals.processed >= 4, true);

  const [heldAfter, purgeAfter, documentAfter, reportAfter, conversationAfter, sentinelAfter] = await Promise.all([
    prisma.clinicalRecord.findUnique({ where: { id: heldRecord.id } }),
    prisma.clinicalRecord.findUnique({ where: { id: purgeRecord.id } }),
    prisma.clinicalDocument.findUnique({ where: { id: document.id } }),
    prisma.diagnosticReport.findUnique({ where: { id: report.id } }),
    prisma.careConversation.findUnique({ where: { id: conversation.id } }),
    prisma.auditEvent.findUnique({ where: { id: sentinelAudit.id } }),
  ]);
  assert.ok(heldAfter, "patient-scoped legal hold must preserve the clinical record");
  assert.equal(purgeAfter, null, "unheld old clinical record must be deleted");
  assert.equal(reportAfter, null, "unheld old diagnostic report must be deleted");
  assert.equal(conversationAfter, null, "unheld closed old conversation must be deleted");
  assert.ok(sentinelAfter, "immutable audit/security evidence must survive generic retention");
  assert.equal(documentAfter.status, "REMOVED");
  assert.equal(documentAfter.objectKey, null);
  assert.equal(documentAfter.metadataCiphertext, "RETENTION_PURGED");
  assert.match(documentAfter.patientId, /^anon-[a-f0-9]{32}$/);
  await assert.rejects(() => storage.get(objectKey));

  await governance.releaseHold(principal, hold.id, { approvalReference: "CI-HOLD-RELEASE-001" });
  await governance.runRetention(principal, { mode: "EXECUTE", approvalReference: approval });
  assert.equal(await prisma.clinicalRecord.findUnique({ where: { id: heldRecord.id } }), null, "released hold must allow the approved retention policy to apply");

  const governanceAudit = await prisma.auditEvent.findMany({
    where: { action: { startsWith: "DATA_RETENTION_" } },
    orderBy: { occurredAt: "desc" },
    take: 20,
  });
  const auditText = JSON.stringify(governanceAudit);
  for (const rawPhi of [heldEmail, purgeEmail, heldPatientId, purgePatientId, "Held", "Purge", "encrypted-held", "encrypted-purge"]) {
    assert.equal(auditText.includes(rawPhi), false, `retention audit evidence leaked raw fixture data '${rawPhi}'`);
  }

  console.log(JSON.stringify({
    status: "passed",
    residencyContract: true,
    explicitPolicy: true,
    dryRun: true,
    executionApprovalGate: true,
    legalHold: true,
    clinicalRecordDeletion: true,
    documentObjectPurgeAndTombstone: true,
    diagnosticReportDeletion: true,
    communicationDeletion: true,
    auditPreserved: true,
    phiSafeAuditEvidence: true,
  }));
} finally {
  if (documentId) await prisma.clinicalDocument.deleteMany({ where: { id: documentId } }).catch(() => undefined);
  if (holdId) await prisma.dataRetentionHold.deleteMany({ where: { id: holdId } }).catch(() => undefined);
  if (heldUser?.id) await prisma.user.deleteMany({ where: { id: heldUser.id } }).catch(() => undefined);
  if (purgeUser?.id) await prisma.user.deleteMany({ where: { id: purgeUser.id } }).catch(() => undefined);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ action: { startsWith: "DATA_RETENTION_" }, actorId: principal.accountId }, { action: "RETENTION_IMMUTABILITY_SENTINEL" }] } }).catch(() => undefined);
  await prisma.$disconnect();
}
