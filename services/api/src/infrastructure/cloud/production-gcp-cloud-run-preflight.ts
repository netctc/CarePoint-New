import { GCP_KSA_PRIMARY_REGION } from "./production-cloud-provider";
import {
  createProductionGcpCloudRunInspectionRuntime,
  type GcpCloudRunInspectionRuntime,
  type InspectGcpCloudRunService,
} from "./gcp-cloud-run-inspection-runtime";

const REQUIRED_INGRESS = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER";
const ACCEPTED_VPC_EGRESS = new Set(["PRIVATE_RANGES_ONLY", "ALL_TRAFFIC"]);

export interface ProductionGcpCloudRunPreflightOptions {
  inspectService?: InspectGcpCloudRunService;
}

export async function assertProductionGcpCloudRunReady(
  env: NodeJS.ProcessEnv = process.env,
  options: ProductionGcpCloudRunPreflightOptions = {},
): Promise<void> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return;

  let runtime: GcpCloudRunInspectionRuntime | null = null;
  let inspectService = options.inspectService;
  if (!inspectService) {
    runtime = await createProductionGcpCloudRunInspectionRuntime(env);
    if (!runtime) {
      throw new Error("GCP Cloud Run inspection runtime is unavailable for production runtime preflight.");
    }
    inspectService = runtime.inspectService;
  }

  try {
    let inspection;
    try {
      inspection = await inspectService();
    } catch (error) {
      throw new Error(`Production GCP Cloud Run preflight could not inspect the configured service: ${errorName(error)}.`);
    }

    const projectId = required(env, "GCP_PROJECT_ID");
    const serviceId = required(env, "CAREPOINT_GCP_CLOUD_RUN_SERVICE");
    const expectedServiceAccount = required(env, "CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL").toLowerCase();
    const expectedNetwork = safeConfigValue(
      required(env, "CAREPOINT_GCP_CLOUD_RUN_NETWORK"),
      "CAREPOINT_GCP_CLOUD_RUN_NETWORK",
    );
    const expectedSubnetwork = safeConfigValue(
      required(env, "CAREPOINT_GCP_CLOUD_RUN_SUBNETWORK"),
      "CAREPOINT_GCP_CLOUD_RUN_SUBNETWORK",
    );
    const expectedEgress = required(env, "CAREPOINT_GCP_CLOUD_RUN_VPC_EGRESS").toUpperCase();

    if (!ACCEPTED_VPC_EGRESS.has(expectedEgress)) {
      throw new Error("CAREPOINT_GCP_CLOUD_RUN_VPC_EGRESS must be PRIVATE_RANGES_ONLY or ALL_TRAFFIC.");
    }
    if (inspection.projectId !== projectId) {
      throw new Error("GCP Cloud Run service project does not match GCP_PROJECT_ID.");
    }
    if (inspection.serviceId !== serviceId) {
      throw new Error("GCP Cloud Run service identity does not match CAREPOINT_GCP_CLOUD_RUN_SERVICE.");
    }
    if (inspection.region !== GCP_KSA_PRIMARY_REGION) {
      throw new Error(
        `GCP Cloud Run service must remain in '${GCP_KSA_PRIMARY_REGION}', got '${inspection.region || "unknown"}'.`,
      );
    }
    if (inspection.serviceAccountEmail !== expectedServiceAccount) {
      throw new Error("GCP Cloud Run revision service account does not match CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL.");
    }
    if (inspection.ingress !== REQUIRED_INGRESS) {
      throw new Error(
        `GCP Cloud Run production ingress must be ${REQUIRED_INGRESS}.`,
      );
    }
    if (inspection.invokerIamDisabled) {
      throw new Error("GCP Cloud Run production must keep the Cloud Run Invoker IAM check enabled.");
    }
    if (inspection.vpcConnector) {
      throw new Error("GCP Cloud Run production must use Direct VPC egress rather than a VPC Access connector.");
    }
    if (!inspection.vpcNetwork || inspection.vpcNetwork !== expectedNetwork) {
      throw new Error("GCP Cloud Run Direct VPC network does not match CAREPOINT_GCP_CLOUD_RUN_NETWORK.");
    }
    if (!inspection.vpcSubnetwork || inspection.vpcSubnetwork !== expectedSubnetwork) {
      throw new Error("GCP Cloud Run Direct VPC subnetwork does not match CAREPOINT_GCP_CLOUD_RUN_SUBNETWORK.");
    }
    if (!inspection.vpcEgress || inspection.vpcEgress !== expectedEgress) {
      throw new Error("GCP Cloud Run VPC egress does not match CAREPOINT_GCP_CLOUD_RUN_VPC_EGRESS.");
    }
  } finally {
    await runtime?.close();
  }
}

function safeConfigValue(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\r\n\0]/.test(normalized)) {
    throw new Error(`${name} contains an invalid Cloud Run network value.`);
  }
  return normalized;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for GCP Cloud Run production preflight.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "GcpCloudRunError";
  }
  return "GcpCloudRunError";
}
