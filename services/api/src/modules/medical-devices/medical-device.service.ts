import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import {
  assertCanonicalRange,
  convertMeasurement,
  normalizeGlucoseContext,
  normalizeMetricCode,
  normalizeUnitCode,
  type ConversionRule,
} from "../observation/observation.engine";
import {
  assertSignedEventTimestamp,
  generateDeviceCredential,
  normalizeDeviceMeasurement,
  normalizeDeviceType,
  normalizeEd25519PublicKey,
  normalizeEventId,
  payloadDigest,
  signatureMessage,
  verifyEd25519,
  type DeviceMeasurementInput,
} from "./medical-device.engine";

const DIRECT_DEVICE_SOURCE = "DIRECT_DEVICE";
const INTEGRATION_SOURCE = "INTEGRATION_WEBHOOK";
const PROVIDER_SOURCE = "PROVIDER_CAPTURE";
const ACTIVE = "ACTIVE";

type DeviceEventHeaders = {
  eventId: string;
  timestamp: string;
  signature: string;
  credentialId?: string | null;
};

type PreparedObservation = {
  patientId: string;
  deviceId: string;
  providerId: string | null;
  encounterId: string | null;
  code: string;
  labels: Prisma.JsonValue;
  observationTypeId: string;
  observationTypeVersionId: string;
  metricVersion: number;
  observedAt: Date;
  value: number;
  unitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  glucoseContext: string | null;
  encrypted: EncryptedEnvelope;
};

@Injectable()
export class MedicalDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async adminWorkspace() {
    const [models, devices, integrations] = await Promise.all([
      this.prisma.deviceModel.findMany({ orderBy: [{ active: "desc" }, { code: "asc" }] }),
      this.prisma.device.findMany({
        include: {
          model: true,
          integration: { select: { id: true, code: true, providerName: true, status: true } },
          credentials: {
            select: { id: true, publicKeyFingerprint: true, status: true, expiresAt: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 3,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.prisma.deviceIntegrationConfig.findMany({
        select: {
          id: true, code: true, providerName: true, status: true, observationScopes: true,
          publicKeyFingerprint: true, healthState: true, lastSuccessAt: true, lastErrorCode: true,
          revokedAt: true, createdAt: true, updatedAt: true,
        },
        orderBy: { code: "asc" },
      }),
    ]);
    return { models, devices, integrations, secretsExposed: false };
  }

  async createModel(principal: AuthPrincipal, raw: Record<string, unknown>) {
    const code = this.code(raw.code, "code");
    const manufacturer = this.text(raw.manufacturer, "manufacturer", 120);
    const modelName = this.text(raw.modelName, "modelName", 120);
    const deviceType = this.deviceType(raw.deviceType);
    const observationCodes = this.codes(raw.observationCodes, "observationCodes", 30);
    await this.assertObservationCodes(observationCodes);
    const row = await this.prisma.deviceModel.create({
      data: {
        code, manufacturer, modelName, deviceType,
        observationCodes: observationCodes as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "DEVICE_MODEL_CREATED",
      objectType: "DEVICE_MODEL",
      objectId: row.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: { code, deviceType, observationCodeCount: observationCodes.length },
    });
    return row;
  }

  async registerDevice(principal: AuthPrincipal, raw: Record<string, unknown>) {
    const modelId = this.id(raw.modelId, "modelId");
    const serialNumber = this.text(raw.serialNumber, "serialNumber", 180);
    const assignedPatientId = this.optionalId(raw.assignedPatientId, "assignedPatientId");
    const assignedProviderId = this.optionalId(raw.assignedProviderId, "assignedProviderId");
    const integrationId = this.optionalId(raw.integrationId, "integrationId");
    await this.assertAssignmentTargets(assignedPatientId, assignedProviderId, integrationId);
    const model = await this.prisma.deviceModel.findUnique({ where: { id: modelId } });
    if (!model?.active) throw new BadRequestException("An active device model is required.");

    const row = await this.prisma.device.create({
      data: { modelId, serialNumber, assignedPatientId, assignedProviderId, integrationId },
      include: { model: true },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "DEVICE_REGISTERED",
      objectType: "DEVICE",
      objectId: row.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: {
        modelId, assignedPatient: Boolean(assignedPatientId), assignedProvider: Boolean(assignedProviderId),
        integrationBound: Boolean(integrationId),
      },
    });
    return row;
  }

  async assignDevice(principal: AuthPrincipal, deviceIdRaw: string, raw: Record<string, unknown>) {
    const deviceId = this.id(deviceIdRaw, "deviceId");
    const expectedVersion = this.positiveInteger(raw.expectedVersion, "expectedVersion");
    const assignedPatientId = this.optionalId(raw.assignedPatientId, "assignedPatientId");
    const assignedProviderId = this.optionalId(raw.assignedProviderId, "assignedProviderId");
    const integrationId = this.optionalId(raw.integrationId, "integrationId");
    await this.assertAssignmentTargets(assignedPatientId, assignedProviderId, integrationId);

    const result = await this.prisma.device.updateMany({
      where: { id: deviceId, status: ACTIVE, version: expectedVersion },
      data: {
        assignedPatientId, assignedProviderId, integrationId,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException("Device version/status conflict.");
    const row = await this.prisma.device.findUnique({ where: { id: deviceId }, include: { model: true } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "DEVICE_ASSIGNMENT_CHANGED",
      objectType: "DEVICE",
      objectId: deviceId,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: {
        assignedPatient: Boolean(assignedPatientId), assignedProvider: Boolean(assignedProviderId),
        integrationBound: Boolean(integrationId),
      },
    });
    return row;
  }

  async rotateCredential(principal: AuthPrincipal, deviceIdRaw: string, raw: Record<string, unknown>) {
    const deviceId = this.id(deviceIdRaw, "deviceId");
    const expectedVersion = this.positiveInteger(raw.expectedVersion, "expectedVersion");
    const expiresAt = raw.expiresAt == null || raw.expiresAt === "" ? null : this.futureDate(raw.expiresAt, "expiresAt");
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.status !== ACTIVE || device.version !== expectedVersion) {
      throw new ConflictException("Only the current ACTIVE device version can rotate credentials.");
    }
    const generated = generateDeviceCredential();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.deviceCredential.updateMany({
        where: { deviceId, status: ACTIVE },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      const credential = await tx.deviceCredential.create({
        data: {
          deviceId,
          publicKeyPem: generated.publicKeyPem,
          publicKeyFingerprint: generated.fingerprint,
          expiresAt,
        },
      });
      await tx.device.update({ where: { id: deviceId }, data: { version: { increment: 1 } } });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "DEVICE_CREDENTIAL_ROTATED",
        objectType: "DEVICE",
        objectId: deviceId,
        purpose: "CLINICAL_CONFIGURATION",
        result: "SUCCESS",
        metadata: { credentialId: credential.id, publicKeyFingerprint: generated.fingerprint, privateKeyStored: false },
      });
      return credential;
    });
    return {
      credentialId: result.id,
      deviceId,
      publicKeyFingerprint: generated.fingerprint,
      publicKeyPem: generated.publicKeyPem,
      privateKeyPem: generated.privateKeyPem,
      privateKeyReturnedOnce: true,
      privateKeyStored: false,
      expiresAt,
    };
  }

  async revokeDevice(principal: AuthPrincipal, deviceIdRaw: string, raw: Record<string, unknown>) {
    const deviceId = this.id(deviceIdRaw, "deviceId");
    const expectedVersion = this.positiveInteger(raw.expectedVersion, "expectedVersion");
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const result = await tx.device.updateMany({
        where: { id: deviceId, status: ACTIVE, version: expectedVersion },
        data: { status: "REVOKED", revokedAt: now, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException("Device version/status conflict.");
      await tx.deviceCredential.updateMany({
        where: { deviceId, status: ACTIVE },
        data: { status: "REVOKED", revokedAt: now },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "DEVICE_REVOKED",
        objectType: "DEVICE",
        objectId: deviceId,
        purpose: "CLINICAL_CONFIGURATION",
        result: "SUCCESS",
        metadata: { futureIngestionBlocked: true, historicalObservationsPreserved: true },
      });
      return tx.device.findUnique({ where: { id: deviceId } });
    });
    return row;
  }

  async createIntegration(principal: AuthPrincipal, raw: Record<string, unknown>) {
    const code = this.code(raw.code, "code");
    const providerName = this.text(raw.providerName, "providerName", 160);
    const observationScopes = this.codes(raw.observationScopes, "observationScopes", 50);
    await this.assertObservationCodes(observationScopes);
    if (typeof raw.webhookPublicKeyPem !== "string") throw new BadRequestException("webhookPublicKeyPem is required.");
    let key: { pem: string; fingerprint: string };
    try { key = normalizeEd25519PublicKey(raw.webhookPublicKeyPem); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid webhook key."); }
    const row = await this.prisma.deviceIntegrationConfig.create({
      data: {
        code, providerName,
        observationScopes: observationScopes as unknown as Prisma.InputJsonValue,
        webhookPublicKey: key.pem,
        publicKeyFingerprint: key.fingerprint,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "DEVICE_INTEGRATION_CREATED",
      objectType: "DEVICE_INTEGRATION",
      objectId: row.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: { code, observationScopeCount: observationScopes.length, publicKeyFingerprint: key.fingerprint, secretStored: false },
    });
    return this.presentIntegration(row);
  }

  async revokeIntegration(principal: AuthPrincipal, integrationIdRaw: string) {
    const integrationId = this.id(integrationIdRaw, "integrationId");
    const now = new Date();
    const row = await this.prisma.deviceIntegrationConfig.update({
      where: { id: integrationId },
      data: { status: "REVOKED", healthState: "REVOKED", revokedAt: now },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "DEVICE_INTEGRATION_REVOKED",
      objectType: "DEVICE_INTEGRATION",
      objectId: integrationId,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: { futureWebhookIngestionBlocked: true },
    });
    return this.presentIntegration(row);
  }

  async assignedDevices(principal: AuthPrincipal, patientIdRaw: string, appointmentIdRaw: string) {
    if (principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("Device capture requires OTHER_PROVIDER role.");
    const context = await this.capabilities.workspaceContext(principal);
    const patientId = this.id(patientIdRaw, "patientId");
    const appointmentId = this.id(appointmentIdRaw, "appointmentId");
    await this.requireEncounter(context.providerId, patientId, appointmentId);
    const rows = await this.prisma.device.findMany({
      where: {
        status: ACTIVE,
        assignedPatientId: patientId,
        assignedProviderId: context.providerId,
        model: { active: true },
      },
      include: { model: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      patientId,
      providerId: context.providerId,
      items: rows.flatMap((device) => {
        const allowed = this.jsonStrings(device.model.observationCodes)
          .filter((code) => context.observationCodes.has(code));
        if (allowed.length === 0) return [];
        return [{
          id: device.id,
          serialNumber: device.serialNumber,
          version: device.version,
          model: {
            id: device.model.id,
            code: device.model.code,
            manufacturer: device.model.manufacturer,
            modelName: device.model.modelName,
            deviceType: device.model.deviceType,
          },
          observationCodes: allowed,
          sourceType: "DEVICE",
        }];
      }),
      capabilityEnforced: true,
    };
  }

  async captureFromProvider(principal: AuthPrincipal, patientIdRaw: string, raw: Record<string, unknown>) {
    if (principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("Device capture requires OTHER_PROVIDER role.");
    const context = await this.capabilities.workspaceContext(principal);
    const patientId = this.id(patientIdRaw, "patientId");
    const deviceId = this.id(raw.deviceId, "deviceId");
    const encounterId = this.id(raw.encounterId, "encounterId");
    const eventId = this.eventId(raw.externalEventId);
    const measurement = this.measurement(raw);
    if (!context.observationCodes.has(measurement.code)) {
      throw new ForbiddenException(`Other Provider category is not authorized for observation ${measurement.code}.`);
    }
    const device = await this.requireActiveDevice(deviceId);
    if (device.assignedPatientId !== patientId || device.assignedProviderId !== context.providerId) {
      throw new ForbiddenException("Device is not assigned to this provider/patient context.");
    }
    await this.requireEncounter(context.providerId, patientId, encounterId);
    this.assertDeviceCode(device.model.observationCodes, measurement.code);
    const prepared = await this.prepareObservation({
      patientId,
      deviceId,
      providerId: context.providerId,
      encounterId,
      measurement,
    });
    return this.persistEvent({
      principalActorId: principal.accountId,
      sourceKind: PROVIDER_SOURCE,
      externalEventId: eventId,
      integrationId: device.integrationId,
      prepared,
      bodyForDigest: raw,
    });
  }

  async ingestDirectDevice(deviceIdRaw: string, headers: DeviceEventHeaders, raw: Record<string, unknown>) {
    const deviceId = this.id(deviceIdRaw, "deviceId");
    const device = await this.requireActiveDevice(deviceId);
    if (!device.assignedPatientId) throw new ForbiddenException("Device has no active patient assignment.");
    const eventId = this.eventId(headers.eventId);
    const timestamp = this.signedTimestamp(headers.timestamp);
    const credentialId = this.id(headers.credentialId, "credentialId");
    const credential = await this.prisma.deviceCredential.findFirst({
      where: {
        id: credentialId, deviceId, status: ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!credential) throw new UnauthorizedException("Active device credential is required.");
    const message = signatureMessage(`device:${deviceId}:${credential.id}`, timestamp, eventId, raw);
    if (!verifyEd25519(credential.publicKeyPem, message, headers.signature)) {
      throw new UnauthorizedException("Device signature is invalid.");
    }
    const measurement = this.measurement(raw);
    this.assertDeviceCode(device.model.observationCodes, measurement.code);
    const prepared = await this.prepareObservation({
      patientId: device.assignedPatientId,
      deviceId,
      providerId: device.assignedProviderId,
      encounterId: null,
      measurement,
    });
    return this.persistEvent({
      principalActorId: null,
      sourceKind: DIRECT_DEVICE_SOURCE,
      externalEventId: eventId,
      integrationId: device.integrationId,
      prepared,
      bodyForDigest: raw,
    });
  }

  async ingestIntegration(codeRaw: string, headers: DeviceEventHeaders, raw: Record<string, unknown>) {
    const code = this.code(codeRaw, "integrationCode");
    const integration = await this.prisma.deviceIntegrationConfig.findUnique({ where: { code } });
    if (!integration || integration.status !== ACTIVE) throw new UnauthorizedException("Active device integration is required.");
    const eventId = this.eventId(headers.eventId);
    const timestamp = this.signedTimestamp(headers.timestamp);
    const message = signatureMessage(`integration:${code}`, timestamp, eventId, raw);
    if (!verifyEd25519(integration.webhookPublicKey, message, headers.signature)) {
      await this.markIntegrationFailure(integration.id, "SIGNATURE_INVALID");
      throw new UnauthorizedException("Integration signature is invalid.");
    }

    const deviceId = this.id(raw.deviceId, "deviceId");
    const payload = this.object(raw.measurement, "measurement");
    const device = await this.requireActiveDevice(deviceId);
    if (device.integrationId !== integration.id) {
      await this.markIntegrationFailure(integration.id, "DEVICE_NOT_BOUND");
      throw new ForbiddenException("Device is not bound to this integration.");
    }
    if (!device.assignedPatientId) throw new ForbiddenException("Device has no active patient assignment.");
    const measurement = this.measurement(payload);
    const integrationScopes = this.jsonStrings(integration.observationScopes);
    if (!integrationScopes.includes(measurement.code)) {
      await this.markIntegrationFailure(integration.id, "SCOPE_DENIED");
      throw new ForbiddenException("Integration is not scoped for this observation.");
    }
    this.assertDeviceCode(device.model.observationCodes, measurement.code);
    const prepared = await this.prepareObservation({
      patientId: device.assignedPatientId,
      deviceId,
      providerId: device.assignedProviderId,
      encounterId: null,
      measurement,
    });
    const result = await this.persistEvent({
      principalActorId: null,
      sourceKind: INTEGRATION_SOURCE,
      externalEventId: eventId,
      integrationId: integration.id,
      prepared,
      bodyForDigest: raw,
    });
    await this.prisma.deviceIntegrationConfig.update({
      where: { id: integration.id },
      data: { healthState: "HEALTHY", lastSuccessAt: new Date(), lastErrorCode: null },
    });
    return result;
  }

  private async prepareObservation(input: {
    patientId: string;
    deviceId: string;
    providerId: string | null;
    encounterId: string | null;
    measurement: DeviceMeasurementInput;
  }): Promise<PreparedObservation> {
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: input.patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Assigned patient not found.");
    const code = normalizeMetricCode(input.measurement.code);
    const version = await this.prisma.observationTypeVersion.findFirst({
      where: { status: "ACTIVE", observationType: { code, active: true } },
      include: { observationType: true },
      orderBy: { version: "desc" },
    });
    if (!version) throw new NotFoundException("Active observation type not found.");
    const unitCode = normalizeUnitCode(input.measurement.unitCode);
    const allowed = this.jsonStrings(version.allowedUnitCodes);
    if (!allowed.includes(unitCode)) throw new BadRequestException("unitCode is not allowed for this observation type.");
    const conversions = await this.conversions(unitCode, version.canonicalUnitCode);
    const normalized = convertMeasurement(
      input.measurement.value, unitCode, version.canonicalUnitCode, version.precision, conversions,
    );
    assertCanonicalRange(normalized.canonicalValue, version.minCanonical, version.maxCanonical);
    const glucoseContext = normalizeGlucoseContext(code, input.measurement.glucoseContext);
    const payload = {
      schemaVersion: 1,
      metricCode: version.observationType.code,
      metricVersion: version.version,
      originalValue: normalized.originalValue,
      originalUnitCode: normalized.originalUnitCode,
      canonicalValue: normalized.canonicalValue,
      canonicalUnitCode: normalized.canonicalUnitCode,
      glucoseContext,
      verificationStatus: "DEVICE_REPORTED",
      providerId: input.providerId,
      encounterId: input.encounterId,
      deviceId: input.deviceId,
      automatedDiagnosis: false,
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    return {
      patientId: patient.id,
      deviceId: input.deviceId,
      providerId: input.providerId,
      encounterId: input.encounterId,
      code: version.observationType.code,
      labels: version.observationType.labels,
      observationTypeId: version.observationTypeId,
      observationTypeVersionId: version.id,
      metricVersion: version.version,
      observedAt: new Date(input.measurement.observedAt),
      value: normalized.originalValue,
      unitCode: normalized.originalUnitCode,
      canonicalValue: normalized.canonicalValue,
      canonicalUnitCode: normalized.canonicalUnitCode,
      glucoseContext,
      encrypted,
    };
  }

  private async persistEvent(input: {
    principalActorId: string | null;
    sourceKind: string;
    externalEventId: string;
    integrationId: string | null;
    prepared: PreparedObservation;
    bodyForDigest: unknown;
  }) {
    const digest = payloadDigest(input.bodyForDigest);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceIngestionEvent.findUnique({
        where: {
          deviceId_externalEventId: {
            deviceId: input.prepared.deviceId,
            externalEventId: input.externalEventId,
          },
        },
      });
      if (existing) {
        if (existing.payloadDigest !== digest) throw new ConflictException("externalEventId was already used with a different payload.");
        if (existing.observationId) {
          return {
            eventId: existing.id,
            observationId: existing.observationId,
            idempotentReplay: true,
            sourceType: "DEVICE",
          };
        }
        throw new ConflictException("Device event is already being processed.");
      }

      const event = await tx.deviceIngestionEvent.create({
        data: {
          deviceId: input.prepared.deviceId,
          integrationId: input.integrationId,
          externalEventId: input.externalEventId,
          payloadDigest: digest,
          sourceKind: input.sourceKind,
          status: "PENDING",
          observedAt: input.prepared.observedAt,
        },
      });
      const observation = await tx.observation.create({
        data: {
          patientId: input.prepared.patientId,
          observationTypeId: input.prepared.observationTypeId,
          observationTypeVersionId: input.prepared.observationTypeVersionId,
          observedAt: input.prepared.observedAt,
          sourceType: "DEVICE",
          sourceId: input.prepared.deviceId,
          createdByActorId: input.principalActorId,
          ...this.envelopeData(input.prepared.encrypted),
        },
      });
      await tx.deviceIngestionEvent.update({
        where: { id: event.id },
        data: { status: "ACCEPTED", observationId: observation.id, processedAt: new Date() },
      });
      await tx.device.update({
        where: { id: input.prepared.deviceId },
        data: { lastSeenAt: new Date() },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: input.principalActorId ?? `device:${input.prepared.deviceId}`,
        action: "DEVICE_OBSERVATION_INGESTED",
        objectType: "OBSERVATION",
        objectId: observation.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "OBSERVATION",
          patientId: input.prepared.patientId,
          providerId: input.prepared.providerId ?? undefined,
          resourceId: observation.id,
          resourceVersion: input.prepared.metricVersion,
          deviceId: input.prepared.deviceId,
          sourceType: "DEVICE",
          sourceKind: input.sourceKind,
          decision: "ALLOW",
          automatedDiagnosis: false,
        },
      });
      return {
        eventId: event.id,
        observationId: observation.id,
        patientId: input.prepared.patientId,
        code: input.prepared.code,
        labels: input.prepared.labels,
        value: input.prepared.value,
        unitCode: input.prepared.unitCode,
        canonicalValue: input.prepared.canonicalValue,
        canonicalUnitCode: input.prepared.canonicalUnitCode,
        observedAt: input.prepared.observedAt,
        sourceType: "DEVICE",
        sourceId: input.prepared.deviceId,
        verificationStatus: "DEVICE_REPORTED",
        automatedDiagnosis: false,
        idempotentReplay: false,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async requireActiveDevice(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { model: true },
    });
    if (!device || device.status !== ACTIVE || device.revokedAt || !device.model.active) {
      throw new ForbiddenException("Active authorized device is required.");
    }
    return device;
  }

  private async requireEncounter(providerId: string, patientId: string, appointmentId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true },
    });
    if (!row) throw new ForbiddenException("Assigned confirmed/completed appointment is required for device capture.");
  }

  private async assertAssignmentTargets(patientId: string | null, providerId: string | null, integrationId: string | null) {
    const [patient, provider, integration] = await Promise.all([
      patientId ? this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } }) : null,
      providerId ? this.prisma.provider.findUnique({ where: { id: providerId }, select: { id: true, status: true } }) : null,
      integrationId ? this.prisma.deviceIntegrationConfig.findUnique({ where: { id: integrationId }, select: { id: true, status: true } }) : null,
    ]);
    if (patientId && !patient) throw new BadRequestException("assignedPatientId is invalid.");
    if (providerId && (!provider || provider.status !== ACTIVE)) throw new BadRequestException("assignedProviderId must reference an active provider.");
    if (integrationId && (!integration || integration.status !== ACTIVE)) throw new BadRequestException("integrationId must reference an active integration.");
  }

  private async assertObservationCodes(codes: string[]) {
    if (codes.length === 0) throw new BadRequestException("At least one observation code is required.");
    const count = await this.prisma.observationType.count({ where: { code: { in: codes }, active: true } });
    if (count !== codes.length) throw new BadRequestException("Every observation code must exist and be active.");
  }

  private assertDeviceCode(raw: Prisma.JsonValue, code: string) {
    if (!this.jsonStrings(raw).includes(code)) throw new ForbiddenException("Device model is not authorized for this observation code.");
  }

  private async conversions(fromUnitCode: string, toUnitCode: string): Promise<ConversionRule[]> {
    if (fromUnitCode === toUnitCode) return [];
    const rows = await this.prisma.unitConversion.findMany({
      where: {
        active: true,
        OR: [
          { fromUnitCode, toUnitCode },
          { fromUnitCode: toUnitCode, toUnitCode: fromUnitCode },
        ],
      },
      orderBy: { version: "desc" },
    });
    const latest = new Map<string, ConversionRule>();
    for (const row of rows) {
      const key = `${row.fromUnitCode}->${row.toUnitCode}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return [...latest.values()];
  }

  private measurement(raw: Record<string, unknown>) {
    try { return normalizeDeviceMeasurement(raw); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid device measurement."); }
  }
  private eventId(value: unknown) {
    try { return normalizeEventId(value); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid event ID."); }
  }
  private signedTimestamp(value: string) {
    try { return assertSignedEventTimestamp(value); }
    catch (error) { throw new UnauthorizedException(error instanceof Error ? error.message : "Invalid event timestamp."); }
  }
  private deviceType(value: unknown) {
    try { return normalizeDeviceType(value); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid device type."); }
  }
  private object(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${field} must be an object.`);
    return value as Record<string, unknown>;
  }
  private code(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_.:-]{2,79}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
  private codes(value: unknown, field: string, max: number) {
    if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new BadRequestException(`${field} must contain 1-${max} items.`);
    const result = value.map((item) => this.code(item, field));
    if (new Set(result).size !== result.length) throw new BadRequestException(`${field} must not contain duplicates.`);
    return result;
  }
  private text(value: unknown, field: string, max: number) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /[\r\n\0]/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
  private id(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
  private optionalId(value: unknown, field: string) {
    if (value == null || value === "") return null;
    return this.id(value, field);
  }
  private positiveInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }
  private futureDate(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO date-time.`);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) throw new BadRequestException(`${field} must be in the future.`);
    return parsed;
  }
  private jsonStrings(value: Prisma.JsonValue) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }
  private envelopeData(envelope: EncryptedEnvelope) {
    return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext };
  }
  private async markIntegrationFailure(id: string, code: string) {
    await this.prisma.deviceIntegrationConfig.update({
      where: { id },
      data: { healthState: "DEGRADED", lastErrorCode: code },
    }).catch(() => undefined);
  }
  private presentIntegration(row: {
    id: string; code: string; providerName: string; status: string; observationScopes: Prisma.JsonValue;
    publicKeyFingerprint: string; healthState: string; lastSuccessAt: Date | null; lastErrorCode: string | null;
    revokedAt: Date | null; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: row.id, code: row.code, providerName: row.providerName, status: row.status,
      observationScopes: row.observationScopes, publicKeyFingerprint: row.publicKeyFingerprint,
      healthState: row.healthState, lastSuccessAt: row.lastSuccessAt, lastErrorCode: row.lastErrorCode,
      revokedAt: row.revokedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
      secretExposed: false,
    };
  }
}
