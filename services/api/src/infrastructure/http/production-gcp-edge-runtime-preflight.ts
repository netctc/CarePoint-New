import { GCP_KSA_PRIMARY_REGION } from "../cloud/production-cloud-provider";
import { browserOrigins, validatedBrowserOrigin } from "./browser-origin-readiness";
import {
  createProductionGcpCloudRunInspectionRuntime,
  type GcpCloudRunInspectionRuntime,
  type GcpCloudRunServiceInspection,
  type InspectGcpCloudRunService,
} from "./gcp-cloud-run-inspection-runtime";

const EXPECTED_EDGE_MODE = "external-application-load-balancer";
const EXPECTED_INGRESS = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER";
const ACCEPTED_VPC_EGRESS = new Set(["PRIVATE_RANGES_ONLY", "ALL_TRAFFIC"]);

export interface ProductionGcpEdgeRuntimePreflightOptions {
  inspectService?: InspectGcpCloudRunService;
}

export async function assertProductionGcpEdgeRuntimeReady(
  env: NodeJS.ProcessEnv = process.env,
  options: ProductionGcpEdgeRuntimePreflightOptions = {},
): Promise<void> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return;

  if (required(env, "CAREPOINT_GCP_EDGE_MODE") !== EXPECTED_EDGE_MODE) {
    throw new Error(`CAREPOINT_GCP_EDGE_MODE must be '${EXPECTED_EDGE_MODE}' for GCP Release 1 production.`);
  }
  if (required(env, "TRUST_PROXY").toLowerCase() !== "true") {
    throw new Error("TRUST_PROXY must be true behind the approved GCP external Application Load Balancer.");
  }

  const publicApiOrigin = validatedBrowserOrigin(required(env, "CAREPOINT_PUBLIC_API_ORIGIN"), true);
  const publicApiUrl = new URL(publicApiOrigin);
  if (publicApiUrl.hostname.toLowerCase().endsWith(".run.app")) {
    throw new Error("CAREPOINT_PUBLIC_API_ORIGIN must use the approved external load-balancer hostname, not run.app.");
  }
  browserOrigins(env);

  let runtime: GcpCloudRunInspectionRuntime | null = null;
  let inspectService = options.inspectService;
  if (!inspectService) {
    runtime = await createProductionGcpCloudRunInspectionRuntime(env);
    if (!runtime) {
      throw new Error("GCP Release 1 production edge preflight requires the Cloud Run inspection runtime.");
    }
    inspectService = runtime.inspectService;
  }

  try {
    let inspection: GcpCloudRunServiceInspection;
    try {
      inspection = await inspectService();
    } catch (error) {
      throw new Error(`Production GCP Cloud Run edge preflight could not inspect the configured service: ${errorName(error)}.`);
    }

    const projectId = required(env, "GCP_PROJECT_ID");
    const serviceId = required(env, "CAREPOINT_GCP_CLOUD_RUN_SERVICE");
    const serviceAccount = required(env, "CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL").toLowerCase();
    const expectedResourceName = `projects/${projectId}/locations/${GCP_KSA_PRIMARY_REGION}/services/${serviceId}`;

    if (inspection.resourceName !== expectedResourceName) {
      throw new Error("GCP Cloud Run service identity does not match the configured production service.");
    }
    if (inspection.projectId !== projectId || inspection.region !== GCP_KSA_PRIMARY_REGION || inspection.serviceId !== serviceId) {
      throw new Error("GCP Cloud Run service is outside the approved production project/region/service identity.");
    }
    if (inspection.reconciling) {
      throw new Error("GCP Cloud Run service is still reconciling and cannot pass production preflight.");
    }
    if (inspection.terminalState !== "CONDITION_SUCCEEDED") {
      throw new Error("GCP Cloud Run service has not reached a successful terminal condition.");
    }
    if (inspection.ingress !== EXPECTED_INGRESS) {
      throw new Error("GCP Cloud Run production ingress must be internal-and-cloud-load-balancing.");
    }
    if (!inspection.defaultUriDisabled) {
      throw new Error("GCP Cloud Run default run.app URI must be disabled for Release 1 production.");
    }
    if (inspection.serviceAccountEmail !== serviceAccount) {
      throw new Error("GCP Cloud Run revision identity must match CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL.");
    }
    if (inspection.minInstanceCount < 1) {
      throw new Error("GCP Cloud Run production must keep at least one warm service instance while API-colocated workers are required.");
    }
    if (inspection.cpuIdle !== false) {
      throw new Error("GCP Cloud Run production must use instance-based CPU allocation while API-colocated workers are required.");
    }
    if (!inspection.privateVpcConfigured) {
      throw new Error("GCP Cloud Run production requires VPC egress for the private data plane.");
    }
    if (!ACCEPTED_VPC_EGRESS.has(inspection.vpcEgress)) {
      throw new Error("GCP Cloud Run VPC egress must cover private database/cache traffic.");
    }
  } finally {
    await runtime?.close();
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for GCP edge/runtime production preflight.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "GcpCloudRunError";
  }
  return "GcpCloudRunError";
}
