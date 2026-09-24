import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Headers,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { Prisma, type ExternalLabResult } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { OrdersModule } from "../orders/orders.module";
import { OrdersEnvelopeService } from "../orders/orders-envelope.service";
import { OrdersService } from "../orders/orders.service";

type Environment = "SANDBOX" | "PRODUCTION";
type MappingDirection = "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
type LabWebhookPayload = {
  externalOrderId: string;
  externalResultId: string;
  clinicalOrderId: string;
  observedAt?: string;
  conclusion?: string;
  observations: Array<{
    externalCode: string;
    value: string | number;
    unit?: string;
    referenceRange?: string;
    flag?: string;
  }>;
};

const MAX_MAPPING_BYTES = 64 * 1024;
const MAX_WEBHOOK_BYTES = 128 * 1024;
const MAX_OBSERVATIONS = 200;
const SAFE_CODE = /^[A-Z][A-Z0-9_:-]{1,79}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const SAFE_RESOURCE = /^[A-Za-z][A-Za-z0-9]{1,79}$/;
const SAFE_PATH = /^\/[A-Za-z0-9_./:-]{0,200}$/;

@Injectable()
export class IntegrationGatewaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: OrdersEnvelopeService,
    private readonly orders: OrdersService,
  ) {}

  async fhirOverview() {
    const configs = await this.prisma.fhirGatewayConfig.findMany({
      include: { mappings: { orderBy: [{ resourceType: "asc" }, { version: "desc" }] } },
      orderBy: [{ code: "asc" }, { environment: "asc" }],
    });
    return {
      secretsExposed: false,
      items: configs.map((config) => ({
        id: config.id,
        code: config.code,
        displayName: config.displayName,
        environment: config.environment,
        baseUrl: config.baseUrl,
        credentialReference: config.credentialReference,
        scopes: this.jsonStrings(config.scopes),
        enabled: config.enabled,
        lastTestStatus: config.lastTestStatus,
        lastTestAt: config.lastTestAt,
        lastErrorCode: config.lastErrorCode,
        mappings: config.mappings.map((mapping) => ({
          id: mapping.id,
          resourceType: mapping.resourceType,
          direction: mapping.direction,
          version: mapping.version,
          status: mapping.status,
          mapping: mapping.mapping,
          publishedAt: mapping.publishedAt,
          retiredAt: mapping.retiredAt,
        })),
      })),
    };
  }

  async createFhirConfig(principal: AuthPrincipal, raw: Record<string, unknown>) {
    const code = this.code(raw.code);
    const displayName = this.text(raw.displayName, 160, "displayName");
    const environment = this.environment(raw.environment);
    const baseUrl = this.baseUrl(raw.baseUrl, environment);
    const credentialReference = this.optionalReference(raw.credentialReference);
    const scopes = this.stringArray(raw.scopes, "scopes", 50, 120);
    const created = await this.prisma.fhirGatewayConfig.create({
      data: {
        code,
        displayName,
        environment,
        baseUrl,
        credentialReference,
        scopes: scopes as unknown as Prisma.InputJsonValue,
        createdByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_GATEWAY_CONFIG_CREATED",
      objectType: "FHIR_GATEWAY_CONFIG",
      objectId: created.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { code, environment, credentialReference, scopes, secretsExposed: false },
    });
    return this.fhirOverview();
  }

  async createFhirMapping(principal: AuthPrincipal, configIdRaw: string, raw: Record<string, unknown>) {
    const configId = this.id(configIdRaw, "configId");
    const config = await this.fhirConfig(configId);
    const resourceType = this.resourceType(raw.resourceType);
    const direction = this.direction(raw.direction);
    const mapping = this.fhirMapping(raw.mapping);
    const aggregate = await this.prisma.fhirResourceMapping.aggregate({
      where: { configId, resourceType, direction },
      _max: { version: true },
    });
    const version = (aggregate._max.version ?? 0) + 1;
    const created = await this.prisma.fhirResourceMapping.create({
      data: {
        configId,
        resourceType,
        direction,
        version,
        status: "DRAFT",
        mapping: mapping as unknown as Prisma.InputJsonValue,
        createdByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_RESOURCE_MAPPING_CREATED",
      objectType: "FHIR_RESOURCE_MAPPING",
      objectId: created.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { configCode: config.code, resourceType, direction, version },
    });
    return this.fhirOverview();
  }

  async publishFhirMapping(principal: AuthPrincipal, mappingIdRaw: string) {
    const mappingId = this.id(mappingIdRaw, "mappingId");
    const mapping = await this.prisma.fhirResourceMapping.findUnique({ where: { id: mappingId } });
    if (!mapping) throw new NotFoundException("FHIR resource mapping not found.");
    if (mapping.status === "PUBLISHED") return this.fhirOverview();
    if (mapping.status !== "DRAFT") throw new ConflictException("Only a DRAFT FHIR mapping can be published.");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.fhirResourceMapping.updateMany({
        where: {
          configId: mapping.configId,
          resourceType: mapping.resourceType,
          direction: mapping.direction,
          status: "PUBLISHED",
        },
        data: { status: "RETIRED", retiredAt: now },
      }),
      this.prisma.fhirResourceMapping.update({
        where: { id: mapping.id },
        data: { status: "PUBLISHED", publishedAt: now, retiredAt: null },
      }),
    ]);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_RESOURCE_MAPPING_PUBLISHED",
      objectType: "FHIR_RESOURCE_MAPPING",
      objectId: mapping.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { resourceType: mapping.resourceType, direction: mapping.direction, version: mapping.version },
    });
    return this.fhirOverview();
  }

  async testFhir(principal: AuthPrincipal, configIdRaw: string) {
    const config = await this.fhirConfig(this.id(configIdRaw, "configId"));
    const url = this.egressUrl(config.baseUrl, "metadata");
    let status = "FAILED";
    let errorCode: string | null = null;
    try {
      const response = await this.probe(url, { accept: "application/fhir+json" });
      const payload = await response.json().catch(() => null) as { resourceType?: unknown; fhirVersion?: unknown } | null;
      if (!response.ok || payload?.resourceType !== "CapabilityStatement") throw new Error("FHIR_CAPABILITY_STATEMENT_INVALID");
      status = "SUCCESS";
    } catch (error) {
      errorCode = this.errorCode(error, "FHIR_CONNECTIVITY_FAILED");
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.fhirGatewayConfig.update({
        where: { id: config.id },
        data: { lastTestStatus: status, lastTestAt: now, lastErrorCode: errorCode },
      }),
      this.prisma.integrationExchange.create({
        data: {
          connectorKind: "FHIR",
          configId: config.id,
          direction: "OUTBOUND",
          eventType: "CONNECTIVITY_TEST",
          status,
          errorCode,
        },
      }),
    ]);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_GATEWAY_CONNECTIVITY_TESTED",
      objectType: "FHIR_GATEWAY_CONFIG",
      objectId: config.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: status === "SUCCESS" ? "SUCCESS" : "DENIED",
      metadata: { environment: config.environment, status, errorCode },
    });
    return { id: config.id, status, errorCode, testedAt: now };
  }

  async activateFhir(principal: AuthPrincipal, configIdRaw: string) {
    const config = await this.fhirConfig(this.id(configIdRaw, "configId"));
    await this.assertActivationReady("FHIR", config.code, config.environment as Environment, config.lastTestStatus);
    const publishedMappings = await this.prisma.fhirResourceMapping.count({
      where: { configId: config.id, status: "PUBLISHED" },
    });
    if (publishedMappings < 1) throw new ConflictException("At least one published FHIR resource mapping is required.");
    await this.prisma.fhirGatewayConfig.update({ where: { id: config.id }, data: { enabled: true } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_GATEWAY_ACTIVATED",
      objectType: "FHIR_GATEWAY_CONFIG",
      objectId: config.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { environment: config.environment, publishedMappings },
    });
    return this.fhirOverview();
  }

  async labsOverview() {
    const configs = await this.prisma.labIntegrationConfig.findMany({
      include: { mappings: { orderBy: [{ externalCode: "asc" }, { version: "desc" }] } },
      orderBy: [{ code: "asc" }, { environment: "asc" }],
    });
    const events = await this.prisma.externalLabResult.findMany({
      orderBy: { receivedAt: "desc" },
      take: 100,
    });
    return {
      secretsExposed: false,
      releasePolicy: "PROFESSIONAL_VALIDATION_AND_RELEASE_REQUIRED",
      items: configs.map((config) => ({
        id: config.id,
        code: config.code,
        displayName: config.displayName,
        environment: config.environment,
        baseUrl: config.baseUrl,
        healthPath: config.healthPath,
        credentialReference: config.credentialReference,
        sourceSystem: config.sourceSystem,
        webhookSignature: "ED25519",
        enabled: config.enabled,
        lastTestStatus: config.lastTestStatus,
        lastTestAt: config.lastTestAt,
        lastErrorCode: config.lastErrorCode,
        mappings: config.mappings.map((mapping) => ({
          id: mapping.id,
          externalCode: mapping.externalCode,
          version: mapping.version,
          status: mapping.status,
          internalCodeSystem: mapping.internalCodeSystem,
          internalCode: mapping.internalCode,
          internalDisplay: mapping.internalDisplay,
          canonicalUnit: mapping.canonicalUnit,
          publishedAt: mapping.publishedAt,
          retiredAt: mapping.retiredAt,
        })),
      })),
      events: events.map((event) => this.presentLabEvent(event)),
    };
  }

  async createLabConfig(principal: AuthPrincipal, raw: Record<string, unknown>) {
    const code = this.code(raw.code);
    const displayName = this.text(raw.displayName, 160, "displayName");
    const environment = this.environment(raw.environment);
    const baseUrl = this.baseUrl(raw.baseUrl, environment);
    const healthPath = this.healthPath(raw.healthPath);
    const credentialReference = this.optionalReference(raw.credentialReference);
    const sourceSystem = this.text(raw.sourceSystem, 180, "sourceSystem");
    const webhookPublicKeyPem = this.ed25519PublicKey(raw.webhookPublicKeyPem);
    const created = await this.prisma.labIntegrationConfig.create({
      data: {
        code,
        displayName,
        environment,
        baseUrl,
        healthPath,
        credentialReference,
        sourceSystem,
        webhookPublicKeyPem,
        createdByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "LAB_INTEGRATION_CONFIG_CREATED",
      objectType: "LAB_INTEGRATION_CONFIG",
      objectId: created.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { code, environment, credentialReference, sourceSystem, secretsExposed: false },
    });
    return this.labsOverview();
  }

  async createLabMapping(principal: AuthPrincipal, configIdRaw: string, raw: Record<string, unknown>) {
    const configId = this.id(configIdRaw, "configId");
    const config = await this.labConfig(configId);
    const externalCode = this.text(raw.externalCode, 120, "externalCode");
    const internalCodeSystem = this.text(raw.internalCodeSystem, 240, "internalCodeSystem");
    const internalCode = this.text(raw.internalCode, 120, "internalCode");
    const internalDisplay = this.text(raw.internalDisplay, 240, "internalDisplay");
    const canonicalUnit = this.optionalText(raw.canonicalUnit, 80, "canonicalUnit");
    const aggregate = await this.prisma.labTestMapping.aggregate({
      where: { configId, externalCode },
      _max: { version: true },
    });
    const version = (aggregate._max.version ?? 0) + 1;
    const created = await this.prisma.labTestMapping.create({
      data: {
        configId,
        externalCode,
        version,
        status: "DRAFT",
        internalCodeSystem,
        internalCode,
        internalDisplay,
        canonicalUnit,
        createdByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "LAB_TEST_MAPPING_CREATED",
      objectType: "LAB_TEST_MAPPING",
      objectId: created.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { configCode: config.code, externalCode, version },
    });
    return this.labsOverview();
  }

  async publishLabMapping(principal: AuthPrincipal, mappingIdRaw: string) {
    const mappingId = this.id(mappingIdRaw, "mappingId");
    const mapping = await this.prisma.labTestMapping.findUnique({ where: { id: mappingId } });
    if (!mapping) throw new NotFoundException("Lab test mapping not found.");
    if (mapping.status === "PUBLISHED") return this.labsOverview();
    if (mapping.status !== "DRAFT") throw new ConflictException("Only a DRAFT lab mapping can be published.");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.labTestMapping.updateMany({
        where: { configId: mapping.configId, externalCode: mapping.externalCode, status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: now },
      }),
      this.prisma.labTestMapping.update({
        where: { id: mapping.id },
        data: { status: "PUBLISHED", publishedAt: now, retiredAt: null },
      }),
    ]);
    await this.audit.write({
      actorId: principal.accountId,
      action: "LAB_TEST_MAPPING_PUBLISHED",
      objectType: "LAB_TEST_MAPPING",
      objectId: mapping.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { externalCode: mapping.externalCode, version: mapping.version },
    });
    return this.labsOverview();
  }

  async testLab(principal: AuthPrincipal, configIdRaw: string) {
    const config = await this.labConfig(this.id(configIdRaw, "configId"));
    const url = this.egressUrl(config.baseUrl, config.healthPath);
    let status = "FAILED";
    let errorCode: string | null = null;
    try {
      const response = await this.probe(url, { accept: "application/json" });
      if (!response.ok) throw new Error("LAB_HEALTH_HTTP_" + response.status);
      status = "SUCCESS";
    } catch (error) {
      errorCode = this.errorCode(error, "LAB_CONNECTIVITY_FAILED");
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.labIntegrationConfig.update({
        where: { id: config.id },
        data: { lastTestStatus: status, lastTestAt: now, lastErrorCode: errorCode },
      }),
      this.prisma.integrationExchange.create({
        data: {
          connectorKind: "LAB",
          configId: config.id,
          direction: "OUTBOUND",
          eventType: "CONNECTIVITY_TEST",
          status,
          errorCode,
        },
      }),
    ]);
    await this.audit.write({
      actorId: principal.accountId,
      action: "LAB_GATEWAY_CONNECTIVITY_TESTED",
      objectType: "LAB_INTEGRATION_CONFIG",
      objectId: config.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: status === "SUCCESS" ? "SUCCESS" : "DENIED",
      metadata: { environment: config.environment, status, errorCode },
    });
    return { id: config.id, status, errorCode, testedAt: now };
  }

  async activateLab(principal: AuthPrincipal, configIdRaw: string) {
    const config = await this.labConfig(this.id(configIdRaw, "configId"));
    await this.assertActivationReady("LAB", config.code, config.environment as Environment, config.lastTestStatus);
    const mappings = await this.prisma.labTestMapping.count({ where: { configId: config.id, status: "PUBLISHED" } });
    if (mappings < 1) throw new ConflictException("At least one published lab mapping is required.");
    await this.prisma.labIntegrationConfig.update({ where: { id: config.id }, data: { enabled: true } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "LAB_GATEWAY_ACTIVATED",
      objectType: "LAB_INTEGRATION_CONFIG",
      objectId: config.id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: "SUCCESS",
      metadata: { environment: config.environment, publishedMappings: mappings },
    });
    return this.labsOverview();
  }

  async ingestLabResult(configIdRaw: string, eventIdRaw: string | undefined, signatureRaw: string | undefined, raw: unknown) {
    const config = await this.labConfig(this.id(configIdRaw, "configId"));
    if (!config.enabled) throw new ConflictException("Lab connector is not active.");
    const eventId = this.id(eventIdRaw, "x-carepoint-event-id");
    const payload = this.labPayload(raw);
    const canonical = stableJson(payload);
    if (Buffer.byteLength(canonical, "utf8") > MAX_WEBHOOK_BYTES) throw new BadRequestException("Lab webhook payload is too large.");
    const payloadDigest = createHash("sha256").update(canonical).digest("hex");
    this.verifyWebhook(config.webhookPublicKeyPem, eventId, payloadDigest, signatureRaw);

    const existing = await this.prisma.externalLabResult.findUnique({
      where: { configId_externalEventId: { configId: config.id, externalEventId: eventId } },
    });
    if (existing) {
      if (existing.payloadDigest !== payloadDigest) throw new ConflictException("externalEventId was already used with different content.");
      return { ...this.presentLabEvent(existing), duplicate: true };
    }

    const order = await this.prisma.clinicalOrder.findUnique({
      where: { id: payload.clinicalOrderId },
      select: { id: true, type: true, status: true },
    });
    let status = "READY";
    let errorCode: string | null = null;
    if (!order || order.type !== "LABORATORY") {
      status = "QUARANTINED";
      errorCode = "LAB_ORDER_NOT_FOUND";
    } else if (order.status !== "SIGNED") {
      status = "QUARANTINED";
      errorCode = "LAB_ORDER_NOT_ACTIVE";
    } else {
      const missing = await this.missingLabMappings(config.id, payload.observations.map((item) => item.externalCode));
      if (missing.length > 0) {
        status = "QUARANTINED";
        errorCode = "UNMAPPED_TEST_CODE";
      }
    }

    const encrypted = await this.envelope.encrypt({ schemaVersion: 1, ...payload });
    const created = await this.prisma.$transaction(async (tx) => {
      const event = await tx.externalLabResult.create({
        data: {
          configId: config.id,
          externalEventId: eventId,
          externalOrderId: payload.externalOrderId,
          externalResultId: payload.externalResultId,
          clinicalOrderId: payload.clinicalOrderId,
          sourceSystem: config.sourceSystem,
          status,
          payloadDigest,
          ...this.envelopeData(encrypted),
          lastErrorCode: errorCode,
          processedAt: status === "READY" ? new Date() : null,
        },
      });
      await tx.integrationExchange.create({
        data: {
          connectorKind: "LAB",
          configId: config.id,
          direction: "INBOUND",
          eventType: "RESULT_WEBHOOK",
          status,
          externalEventId: eventId,
          resourceRef: payload.clinicalOrderId,
          payloadDigest,
          errorCode,
        },
      });
      return event;
    });
    await this.audit.write({
      actorId: null,
      action: "EXTERNAL_LAB_RESULT_RECEIVED",
      objectType: "EXTERNAL_LAB_RESULT",
      objectId: created.id,
      purpose: "SYSTEM_INTEGRATION",
      result: status === "READY" ? "SUCCESS" : "DENIED",
      metadata: {
        connectorCode: config.code,
        sourceSystem: config.sourceSystem,
        status,
        errorCode,
        payloadDigest,
        clinicalOrderId: payload.clinicalOrderId,
      },
    });
    return { ...this.presentLabEvent(created), duplicate: false };
  }

  async retryLabEvent(principal: AuthPrincipal, eventIdRaw: string) {
    const id = this.id(eventIdRaw, "eventId");
    const event = await this.prisma.externalLabResult.findUnique({ where: { id } });
    if (!event) throw new NotFoundException("External lab event not found.");
    if (event.status === "IMPORTED") return this.labsOverview();
    const payload = await this.decryptLabPayload(event);
    const order = await this.prisma.clinicalOrder.findUnique({
      where: { id: payload.clinicalOrderId },
      select: { id: true, type: true, status: true },
    });
    let status = "READY";
    let errorCode: string | null = null;
    if (!order || order.type !== "LABORATORY") {
      status = "QUARANTINED";
      errorCode = "LAB_ORDER_NOT_FOUND";
    } else if (order.status !== "SIGNED") {
      status = "QUARANTINED";
      errorCode = "LAB_ORDER_NOT_ACTIVE";
    } else {
      const missing = await this.missingLabMappings(event.configId, payload.observations.map((item) => item.externalCode));
      if (missing.length > 0) {
        status = "QUARANTINED";
        errorCode = "UNMAPPED_TEST_CODE";
      }
    }
    await this.prisma.externalLabResult.update({
      where: { id },
      data: {
        status,
        lastErrorCode: errorCode,
        retryCount: { increment: 1 },
        processedAt: status === "READY" ? new Date() : null,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "EXTERNAL_LAB_RESULT_RETRIED",
      objectType: "EXTERNAL_LAB_RESULT",
      objectId: id,
      purpose: "INTEGRATION_GOVERNANCE",
      result: status === "READY" ? "SUCCESS" : "DENIED",
      metadata: { status, errorCode },
    });
    return this.labsOverview();
  }

  async importLabResult(principal: AuthPrincipal, eventIdRaw: string) {
    const id = this.id(eventIdRaw, "eventId");
    const event = await this.prisma.externalLabResult.findUnique({ where: { id } });
    if (!event) throw new NotFoundException("External lab event not found.");
    if (event.status === "IMPORTED") throw new ConflictException("External lab event is already imported.");
    if (event.status !== "READY") throw new ConflictException("Only a READY external lab event can be imported.");
    const payload = await this.decryptLabPayload(event);
    const observations = await this.mapLabObservations(event.configId, payload.observations);
    if (!observations) {
      await this.prisma.externalLabResult.update({
        where: { id },
        data: { status: "QUARANTINED", lastErrorCode: "UNMAPPED_TEST_CODE", retryCount: { increment: 1 } },
      });
      throw new ConflictException("Published lab mappings changed; event returned to quarantine.");
    }
    const result = await this.orders.enterLabResult(
      principal,
      payload.clinicalOrderId,
      {
        observations,
        ...(payload.conclusion ? { conclusion: payload.conclusion } : {}),
      },
      {
        sourceSystem: event.sourceSystem,
        externalResultId: event.externalResultId,
        externalOrderId: event.externalOrderId,
      },
    );
    await this.prisma.externalLabResult.update({
      where: { id },
      data: {
        status: "IMPORTED",
        importedAt: new Date(),
        importedByActorId: principal.accountId,
        lastErrorCode: null,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "EXTERNAL_LAB_RESULT_IMPORTED",
      objectType: "EXTERNAL_LAB_RESULT",
      objectId: id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        clinicalOrderId: event.clinicalOrderId,
        sourceSystem: event.sourceSystem,
        releaseState: "ENTERED",
        patientVisible: false,
      },
    });
    return result;
  }

  private async assertActivationReady(kind: "FHIR" | "LAB", code: string, environment: Environment, lastTestStatus: string | null) {
    if (lastTestStatus !== "SUCCESS") throw new ConflictException("A successful connectivity test is required before activation.");
    if (environment !== "PRODUCTION") return;
    const sandbox = kind === "FHIR"
      ? await this.prisma.fhirGatewayConfig.findUnique({ where: { code_environment: { code, environment: "SANDBOX" } } })
      : await this.prisma.labIntegrationConfig.findUnique({ where: { code_environment: { code, environment: "SANDBOX" } } });
    if (!sandbox || sandbox.lastTestStatus !== "SUCCESS") {
      throw new ConflictException("Production activation requires a successful SANDBOX connectivity test for the same connector code.");
    }
  }

  private async fhirConfig(id: string) {
    const config = await this.prisma.fhirGatewayConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException("FHIR gateway config not found.");
    return config;
  }

  private async labConfig(id: string) {
    const config = await this.prisma.labIntegrationConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException("Lab integration config not found.");
    return config;
  }

  private async missingLabMappings(configId: string, externalCodes: string[]) {
    const unique = [...new Set(externalCodes)];
    const mappings = await this.prisma.labTestMapping.findMany({
      where: { configId, status: "PUBLISHED", externalCode: { in: unique } },
      select: { externalCode: true },
    });
    const mapped = new Set(mappings.map((item) => item.externalCode));
    return unique.filter((code) => !mapped.has(code));
  }

  private async mapLabObservations(configId: string, observations: LabWebhookPayload["observations"]) {
    const codes = [...new Set(observations.map((item) => item.externalCode))];
    const mappings = await this.prisma.labTestMapping.findMany({
      where: { configId, status: "PUBLISHED", externalCode: { in: codes } },
      orderBy: { version: "desc" },
    });
    const byCode = new Map<string, typeof mappings[number]>();
    for (const mapping of mappings) if (!byCode.has(mapping.externalCode)) byCode.set(mapping.externalCode, mapping);
    if (codes.some((code) => !byCode.has(code))) return null;
    return observations.map((observation) => {
      const mapping = byCode.get(observation.externalCode)!;
      return {
        display: mapping.internalDisplay,
        codeSystem: mapping.internalCodeSystem,
        code: mapping.internalCode,
        value: observation.value,
        unit: observation.unit || mapping.canonicalUnit || undefined,
        referenceRange: observation.referenceRange || undefined,
        flag: observation.flag || undefined,
      };
    });
  }

  private labPayload(raw: unknown): LabWebhookPayload {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("Lab webhook body must be an object.");
    const value = raw as Record<string, unknown>;
    const observationsRaw = value.observations;
    if (!Array.isArray(observationsRaw) || observationsRaw.length < 1 || observationsRaw.length > MAX_OBSERVATIONS) {
      throw new BadRequestException("observations must contain between 1 and 200 items.");
    }
    const observations = observationsRaw.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new BadRequestException(`observations[${index}] must be an object.`);
      const row = entry as Record<string, unknown>;
      const externalCode = this.text(row.externalCode, 120, `observations[${index}].externalCode`);
      if (typeof row.value !== "string" && typeof row.value !== "number") throw new BadRequestException(`observations[${index}].value is invalid.`);
      return {
        externalCode,
        value: row.value,
        unit: this.optionalText(row.unit, 80, `observations[${index}].unit`),
        referenceRange: this.optionalText(row.referenceRange, 160, `observations[${index}].referenceRange`),
        flag: this.optionalText(row.flag, 40, `observations[${index}].flag`),
      };
    });
    const observedAt = this.optionalIso(value.observedAt, "observedAt");
    return {
      externalOrderId: this.text(value.externalOrderId, 180, "externalOrderId"),
      externalResultId: this.text(value.externalResultId, 180, "externalResultId"),
      clinicalOrderId: this.id(value.clinicalOrderId, "clinicalOrderId"),
      ...(observedAt ? { observedAt } : {}),
      ...(value.conclusion ? { conclusion: this.text(value.conclusion, 10_000, "conclusion") } : {}),
      observations,
    };
  }

  private async decryptLabPayload(event: ExternalLabResult): Promise<LabWebhookPayload> {
    return this.envelope.decrypt<LabWebhookPayload>(this.envelopeFrom(event));
  }

  private envelopeFrom(row: Pick<ExternalLabResult, "algorithm" | "keyId" | "wrappedKey" | "iv" | "ciphertext">): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported external lab staging encryption.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: row.keyId, wrappedKey: row.wrappedKey, iv: row.iv, ciphertext: row.ciphertext };
  }

  private envelopeData(value: EncryptedEnvelope) {
    return { algorithm: value.algorithm, keyId: value.keyId, wrappedKey: value.wrappedKey, iv: value.iv, ciphertext: value.ciphertext };
  }

  private verifyWebhook(publicKeyPem: string, eventId: string, digest: string, signatureRaw: string | undefined) {
    if (!signatureRaw || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureRaw) || signatureRaw.length % 4 !== 0) {
      throw new BadRequestException("x-carepoint-signature must be canonical base64.");
    }
    const signature = Buffer.from(signatureRaw, "base64");
    if (signature.toString("base64") !== signatureRaw) throw new BadRequestException("x-carepoint-signature must be canonical base64.");
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new ConflictException("Lab webhook public key must be Ed25519.");
    const message = Buffer.from(eventId + "." + digest, "utf8");
    if (!verifySignature(null, message, key, signature)) throw new ConflictException("Lab webhook signature verification failed.");
  }

  private ed25519PublicKey(raw: unknown) {
    const value = this.text(raw, 4096, "webhookPublicKeyPem");
    let key;
    try { key = createPublicKey(value); } catch { throw new BadRequestException("webhookPublicKeyPem is invalid."); }
    if (key.asymmetricKeyType !== "ed25519") throw new BadRequestException("webhookPublicKeyPem must be an Ed25519 public key.");
    return key.export({ format: "pem", type: "spki" }).toString();
  }

  private async probe(url: URL, headers: Record<string, string>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      return await fetch(url, { method: "GET", headers, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private egressUrl(baseUrl: string, path: string) {
    const target = new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    const allow = new Set(
      (process.env.INTEGRATION_EGRESS_ALLOWLIST ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
    if (allow.size === 0) throw new ConflictException("INTEGRATION_EGRESS_ALLOWLIST is not configured.");
    if (!allow.has(target.hostname.toLowerCase())) throw new ConflictException("Integration egress host is not allowlisted.");
    if (target.username || target.password || target.hash) throw new BadRequestException("Integration endpoint URL is invalid.");
    if (process.env.NODE_ENV === "production" && target.protocol !== "https:") {
      throw new ConflictException("Production integration egress requires HTTPS.");
    }
    if (!["http:", "https:"].includes(target.protocol)) throw new BadRequestException("Integration endpoint must use HTTP(S).");
    return target;
  }

  private baseUrl(raw: unknown, environment: Environment) {
    const value = this.text(raw, 1000, "baseUrl");
    let url: URL;
    try { url = new URL(value.endsWith("/") ? value : value + "/"); } catch { throw new BadRequestException("baseUrl is invalid."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new BadRequestException("baseUrl must be a credential-free HTTP(S) URL.");
    }
    if (environment === "PRODUCTION" && url.protocol !== "https:") throw new BadRequestException("PRODUCTION baseUrl must use HTTPS.");
    return url.toString();
  }

  private fhirMapping(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("mapping must be an object.");
    const object = raw as Record<string, unknown>;
    if (!Array.isArray(object.fields) || object.fields.length < 1 || object.fields.length > 100) {
      throw new BadRequestException("mapping.fields must contain between 1 and 100 entries.");
    }
    const fields = object.fields.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new BadRequestException(`mapping.fields[${index}] must be an object.`);
      const row = entry as Record<string, unknown>;
      const transform = String(row.transform ?? "DIRECT").trim().toUpperCase();
      if (!["DIRECT", "CODE_MAP"].includes(transform)) throw new BadRequestException("mapping transform must be DIRECT or CODE_MAP.");
      return {
        sourcePath: this.path(row.sourcePath, `mapping.fields[${index}].sourcePath`),
        targetPath: this.path(row.targetPath, `mapping.fields[${index}].targetPath`),
        transform,
        ...(transform === "CODE_MAP" ? { terminologySystem: this.text(row.terminologySystem, 240, "terminologySystem") } : {}),
      };
    });
    const value = { schemaVersion: 1, fields };
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_MAPPING_BYTES) throw new BadRequestException("FHIR mapping is too large.");
    return value;
  }

  private path(raw: unknown, field: string) {
    const value = this.text(raw, 240, field);
    if (!/^[A-Za-z][A-Za-z0-9_.\[\]-]{0,239}$/.test(value)) throw new BadRequestException(`${field} is invalid.`);
    return value;
  }

  private environment(raw: unknown): Environment {
    const value = String(raw ?? "").trim().toUpperCase();
    if (value !== "SANDBOX" && value !== "PRODUCTION") throw new BadRequestException("environment must be SANDBOX or PRODUCTION.");
    return value;
  }

  private direction(raw: unknown): MappingDirection {
    const value = String(raw ?? "").trim().toUpperCase();
    if (!["INBOUND", "OUTBOUND", "BIDIRECTIONAL"].includes(value)) throw new BadRequestException("direction is invalid.");
    return value as MappingDirection;
  }

  private resourceType(raw: unknown) {
    const value = this.text(raw, 80, "resourceType");
    if (!SAFE_RESOURCE.test(value)) throw new BadRequestException("resourceType is invalid.");
    return value;
  }

  private healthPath(raw: unknown) {
    const value = raw == null || raw === "" ? "/health" : this.text(raw, 220, "healthPath");
    if (!SAFE_PATH.test(value) || value.includes("..")) throw new BadRequestException("healthPath is invalid.");
    return value;
  }

  private code(raw: unknown) {
    const value = this.text(raw, 80, "code").toUpperCase();
    if (!SAFE_CODE.test(value)) throw new BadRequestException("code is invalid.");
    return value;
  }

  private id(raw: unknown, field: string) {
    const value = this.text(raw, 180, field);
    if (!SAFE_ID.test(value)) throw new BadRequestException(`${field} is invalid.`);
    return value;
  }

  private optionalReference(raw: unknown) {
    if (raw == null || raw === "") return null;
    const value = this.text(raw, 180, "credentialReference");
    if (!/^[A-Za-z0-9_.:/-]{1,180}$/.test(value)) throw new BadRequestException("credentialReference is invalid.");
    return value;
  }

  private stringArray(raw: unknown, field: string, maxItems: number, maxLength: number) {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > maxItems) throw new BadRequestException(`${field} must be an array with at most ${maxItems} items.`);
    const values = raw.map((item, index) => this.text(item, maxLength, `${field}[${index}]`));
    if (new Set(values).size !== values.length) throw new BadRequestException(`${field} must not contain duplicates.`);
    return values;
  }

  private jsonStrings(raw: Prisma.JsonValue) {
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  }

  private optionalIso(raw: unknown, field: string) {
    if (raw == null || raw === "") return undefined;
    const value = this.text(raw, 80, field);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} must be an ISO date-time.`);
    return date.toISOString();
  }

  private optionalText(raw: unknown, max: number, field: string) {
    if (raw == null || raw === "") return undefined;
    return this.text(raw, max, field);
  }

  private text(raw: unknown, max: number, field: string) {
    if (typeof raw !== "string") throw new BadRequestException(`${field} must be a string.`);
    const value = raw.trim();
    if (!value || value.length > max || /[\0\r\n]/.test(value) && field !== "webhookPublicKeyPem") {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value;
  }

  private errorCode(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : "";
    const code = message.trim().toUpperCase().replace(/[^A-Z0-9_:-]+/g, "_").slice(0, 120);
    return code || fallback;
  }

  private presentLabEvent(event: ExternalLabResult) {
    return {
      id: event.id,
      configId: event.configId,
      externalEventId: event.externalEventId,
      externalOrderId: event.externalOrderId,
      externalResultId: event.externalResultId,
      clinicalOrderId: event.clinicalOrderId,
      sourceSystem: event.sourceSystem,
      status: event.status,
      payloadDigest: event.payloadDigest,
      retryCount: event.retryCount,
      lastErrorCode: event.lastErrorCode,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
      importedAt: event.importedAt,
      patientVisible: false,
    };
  }
}

@Controller("admin/integrations/fhir")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class AdminFhirGatewayController {
  constructor(private readonly gateways: IntegrationGatewaysService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  overview() { return this.gateways.fhirOverview(); }

  @Post("configs")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.gateways.createFhirConfig(principal, body ?? {});
  }

  @Post("configs/:configId/mappings")
  mapping(@CurrentPrincipal() principal: AuthPrincipal, @Param("configId") configId: string, @Body() body: Record<string, unknown>) {
    return this.gateways.createFhirMapping(principal, configId, body ?? {});
  }

  @Post("mappings/:mappingId/publish")
  publish(@CurrentPrincipal() principal: AuthPrincipal, @Param("mappingId") mappingId: string) {
    return this.gateways.publishFhirMapping(principal, mappingId);
  }

  @Post("configs/:configId/test")
  test(@CurrentPrincipal() principal: AuthPrincipal, @Param("configId") configId: string) {
    return this.gateways.testFhir(principal, configId);
  }

  @Post("configs/:configId/activate")
  activate(@CurrentPrincipal() principal: AuthPrincipal, @Param("configId") configId: string) {
    return this.gateways.activateFhir(principal, configId);
  }
}

@Controller("admin/integrations/labs")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class AdminLabGatewayController {
  constructor(private readonly gateways: IntegrationGatewaysService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  overview() { return this.gateways.labsOverview(); }

  @Post("configs")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.gateways.createLabConfig(principal, body ?? {});
  }

  @Post("configs/:configId/mappings")
  mapping(@CurrentPrincipal() principal: AuthPrincipal, @Param("configId") configId: string, @Body() body: Record<string, unknown>) {
    return this.gateways.createLabMapping(principal, configId, body ?? {});
  }

  @Post("mappings/:mappingId/publish")
  publish(@CurrentPrincipal() principal: AuthPrincipal, @Param("mappingId") mappingId: string) {
    return this.gateways.publishLabMapping(principal, mappingId);
  }

  @Post("configs/:configId/test")
  test(@CurrentPrincipal() principal: AuthPrincipal, @Param("configId") configId: string) {
    return this.gateways.testLab(principal, configId);
  }

  @Post("configs/:configId/activate")
  activate(@CurrentPrincipal() principal: AuthPrincipal, @Param("configId") configId: string) {
    return this.gateways.activateLab(principal, configId);
  }

  @Post("events/:eventId/retry")
  retry(@CurrentPrincipal() principal: AuthPrincipal, @Param("eventId") eventId: string) {
    return this.gateways.retryLabEvent(principal, eventId);
  }
}

@Controller("integrations/labs")
class ExternalLabWebhookController {
  constructor(private readonly gateways: IntegrationGatewaysService) {}

  @Public()
  @Post(":configId/results")
  @Header("Cache-Control", "no-store")
  ingest(
    @Param("configId") configId: string,
    @Headers("x-carepoint-event-id") eventId: string | undefined,
    @Headers("x-carepoint-signature") signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.gateways.ingestLabResult(configId, eventId, signature, body);
  }
}

@Controller("provider/external-lab-results")
class ProviderExternalLabResultController {
  constructor(private readonly gateways: IntegrationGatewaysService) {}

  @RequirePermissions("LAB_RESULT_ENTER")
  @Post(":eventId/import")
  @Header("Cache-Control", "no-store")
  import(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("eventId") eventId: string,
  ) {
    return this.gateways.importLabResult(principal, eventId);
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [
    AdminFhirGatewayController,
    AdminLabGatewayController,
    ExternalLabWebhookController,
    ProviderExternalLabResultController,
  ],
  providers: [IntegrationGatewaysService],
  exports: [IntegrationGatewaysService],
})
export class IntegrationGatewaysModule {}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + stableJson(object[key])).join(",") + "}";
}
