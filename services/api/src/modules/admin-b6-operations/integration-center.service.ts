import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

type IntegrationState = "HEALTHY" | "DEGRADED" | "NOT_CONFIGURED";

@Injectable()
export class IntegrationCenterService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot() {
    const now = new Date().toISOString();
    const [
      activeTerminologySystems,
      latestTerminologyChange,
      latestFhirJob,
      fhirConfigs,
      labConfigs,
      latestLabEvent,
      pendingSiem,
      failedSiem,
      latestSiemExport,
    ] = await Promise.all([
      this.prisma.codingSystem.count({ where: { active: true } }),
      this.prisma.codingSystem.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      this.prisma.fhirBulkExportJobState.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true, lastError: true } }),
      this.prisma.fhirGatewayConfig.findMany({
        select: { enabled: true, lastTestStatus: true, lastTestAt: true, lastErrorCode: true, credentialReference: true },
      }),
      this.prisma.labIntegrationConfig.findMany({
        select: { enabled: true, lastTestStatus: true, lastTestAt: true, lastErrorCode: true, credentialReference: true },
      }),
      this.prisma.externalLabResult.findFirst({
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true, status: true, lastErrorCode: true },
      }),
      this.prisma.siemAuditDelivery.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      this.prisma.siemAuditDelivery.count({ where: { status: "FAILED" } }),
      this.prisma.siemAuditDelivery.findFirst({
        where: { exportedAt: { not: null } },
        orderBy: { exportedAt: "desc" },
        select: { exportedAt: true },
      }),
    ]);

    const fhirEnabled = fhirConfigs.filter((item) => item.enabled);
    const fhirFailed = fhirConfigs.some((item) => item.lastTestStatus === "FAILED");
    const labEnabled = labConfigs.filter((item) => item.enabled);
    const labFailed = labConfigs.some((item) => item.lastTestStatus === "FAILED") || latestLabEvent?.status === "QUARANTINED";
    const siemEnabled = process.env.SIEM_EXPORT_ENABLED?.trim().toLowerCase() === "true";
    const bulkStorageConfigured = Boolean(
      process.env.CAREPOINT_BULK_EXPORT_BUCKET_REF?.trim()
      || process.env.BULK_EXPORT_S3_BUCKET?.trim()
      || process.env.DOCUMENT_S3_BUCKET?.trim(),
    );

    return {
      generatedAt: now,
      secretsExposed: false,
      items: [
        this.connector({
          key: "TERMINOLOGY",
          label: "Clinical terminology",
          state: activeTerminologySystems > 0 ? "HEALTHY" : "DEGRADED",
          configured: true,
          credentialReferences: [],
          lastSyncAt: latestTerminologyChange?.updatedAt.toISOString() ?? null,
          lastErrorCode: activeTerminologySystems > 0 ? null : "NO_ACTIVE_CODING_SYSTEM",
          details: { activeCodingSystems: activeTerminologySystems, mode: "INTERNAL_VERSIONED_CATALOG" },
        }),
        this.connector({
          key: "FHIR_R4",
          label: "FHIR R4 + SMART",
          state: latestFhirJob?.lastError || fhirFailed ? "DEGRADED" : "HEALTHY",
          configured: true,
          credentialReferences: [
            ...this.refs([
              ["SMART_BACKEND_CLIENTS_JSON", process.env.SMART_BACKEND_CLIENTS_JSON],
              ["SMART_BACKEND_CLIENTS_FILE", process.env.SMART_BACKEND_CLIENTS_FILE],
            ]),
            ...fhirConfigs.map((item) => item.credentialReference).filter((value): value is string => Boolean(value)),
          ],
          lastSyncAt: fhirConfigs.map((item) => item.lastTestAt).filter((value): value is Date => Boolean(value)).sort((a,b) => b.getTime() - a.getTime())[0]?.toISOString()
            ?? latestFhirJob?.updatedAt.toISOString()
            ?? null,
          lastErrorCode: latestFhirJob?.lastError ? "FHIR_BULK_JOB_ERROR" : fhirConfigs.find((item) => item.lastErrorCode)?.lastErrorCode ?? null,
          details: {
            mode: "READ_ONLY_FACADE_AND_DURABLE_BULK_EXPORT",
            bulkStorageConfigured,
            governedGatewayConfigs: fhirConfigs.length,
            enabledGatewayConfigs: fhirEnabled.length,
          },
        }),
        this.connector({
          key: "LAB_GATEWAY",
          label: "External laboratory gateway",
          state: labConfigs.length === 0 ? "NOT_CONFIGURED" : labFailed ? "DEGRADED" : "HEALTHY",
          configured: labConfigs.length > 0,
          credentialReferences: labConfigs.map((item) => item.credentialReference).filter((value): value is string => Boolean(value)),
          lastSyncAt: latestLabEvent?.receivedAt.toISOString()
            ?? labConfigs.map((item) => item.lastTestAt).filter((value): value is Date => Boolean(value)).sort((a,b) => b.getTime() - a.getTime())[0]?.toISOString()
            ?? null,
          lastErrorCode: latestLabEvent?.lastErrorCode ?? labConfigs.find((item) => item.lastErrorCode)?.lastErrorCode ?? null,
          details: {
            phase: "V2-C",
            stagingEncrypted: true,
            professionalReleaseRequired: true,
            governedGatewayConfigs: labConfigs.length,
            enabledGatewayConfigs: labEnabled.length,
          },
        }),
        this.connector({
          key: "DEVICE_INGESTION",
          label: "Medical device ingestion",
          state: "NOT_CONFIGURED",
          configured: false,
          credentialReferences: [],
          lastSyncAt: null,
          lastErrorCode: null,
          details: { phase: "V2-C", adapterBoundaryReady: true },
        }),
        this.connector({
          key: "SIEM",
          label: "Security event export",
          state: this.siemState(siemEnabled, failedSiem),
          configured: siemEnabled,
          credentialReferences: siemEnabled ? ["siem-export-api-key"] : [],
          lastSyncAt: latestSiemExport?.exportedAt?.toISOString() ?? null,
          lastErrorCode: failedSiem > 0 ? "FAILED_OUTBOX_ITEMS" : null,
          details: { pendingDeliveries: pendingSiem, failedDeliveries: failedSiem },
        }),
      ],
    };
  }

  private connector(input: {
    key: string;
    label: string;
    state: IntegrationState;
    configured: boolean;
    credentialReferences: string[];
    lastSyncAt: string | null;
    lastErrorCode: string | null;
    details: Record<string, unknown>;
  }) {
    return {
      ...input,
      credentialsPresent: input.credentialReferences.length > 0,
    };
  }

  private refs(entries: Array<[string, string | undefined]>): string[] {
    return entries.filter(([, value]) => Boolean(value?.trim())).map(([name]) => name);
  }

  private siemState(enabled: boolean, failed: number): IntegrationState {
    if (!enabled) return "NOT_CONFIGURED";
    return failed > 0 ? "DEGRADED" : "HEALTHY";
  }
}
