import {
  createProductionGcpObjectStorageInspectionRuntime,
  type GcpObjectStorageInspectionRuntime,
} from "../cloud/gcp-object-storage-inspection-runtime";
import type {
  GcpObjectStorageBucketInspection,
  InspectGcpObjectStorageBucket,
} from "../cloud/gcp-object-storage-inspector-adapter";
import {
  productionObjectStorageContract,
  validateProductionObjectStorageBucketInspection,
  type ProductionObjectStorageDomain,
} from "../cloud/production-object-storage";

export interface ProductionGcpObjectStoragePreflightOptions {
  inspectBucket?: InspectGcpObjectStorageBucket;
}

export async function assertProductionGcpObjectStorageReady(
  env: NodeJS.ProcessEnv = process.env,
  options: ProductionGcpObjectStoragePreflightOptions = {},
): Promise<void> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return;

  const contract = productionObjectStorageContract(env);
  if (!contract || contract.provider !== "gcp-cloud-storage") {
    throw new Error("GCP production object-storage preflight requires the GCP Cloud Storage contract.");
  }

  let runtime: GcpObjectStorageInspectionRuntime | null = null;
  let inspectBucket = options.inspectBucket;
  if (!inspectBucket) {
    runtime = await createProductionGcpObjectStorageInspectionRuntime(env);
    if (!runtime) {
      throw new Error("GCP production object-storage inspection runtime is unavailable for preflight.");
    }
    inspectBucket = runtime.inspectBucket;
  }

  try {
    const inspected = new Map<string, GcpObjectStorageBucketInspection>();
    for (const domain of contract.domains) {
      let inspection = inspected.get(domain.bucketRef);
      if (!inspection) {
        try {
          inspection = await inspectBucket(domain);
        } catch (error) {
          throw new Error(
            `Production GCP Cloud Storage preflight could not inspect bucket '${domain.bucketRef}': ${errorMessage(error)}`,
          );
        }
        inspected.set(domain.bucketRef, inspection);
      }

      validateProductionObjectStorageBucketInspection(domain, inspection);
      if (!inspection.uniformBucketLevelAccessEnabled) {
        throw new Error(
          `GCP Cloud Storage bucket '${domain.bucketRef}' must enable uniform bucket-level access.`,
        );
      }
      if (domain.lifecycleRetentionDays !== undefined) {
        validateGcpLifecycle(domain, inspection);
      }
    }
  } finally {
    await runtime?.close();
  }
}

function validateGcpLifecycle(
  domain: ProductionObjectStorageDomain,
  inspection: GcpObjectStorageBucketInspection,
): void {
  const maxDays = domain.lifecycleRetentionDays;
  if (maxDays === undefined) return;

  const matchingRule = inspection.lifecycleRules.find((rule) => {
    if (rule.actionType !== "Delete") return false;
    if (!Number.isInteger(rule.ageDays) || (rule.ageDays ?? 0) < 1 || (rule.ageDays as number) > maxDays) {
      return false;
    }
    if (rule.isLive === false || rule.unsupportedConditions.length > 0) return false;
    if (rule.matchesPrefix.length === 0) return true;
    return rule.matchesPrefix.some((prefix) => prefixCovers(prefix, domain.prefix));
  });

  if (!matchingRule) {
    throw new Error(
      `GCP Cloud Storage bucket '${domain.bucketRef}' needs a Delete lifecycle rule covering prefix '${domain.prefix}' within ${maxDays} day(s) without narrowing conditions.`,
    );
  }
}

function prefixCovers(rulePrefix: string, targetPrefix: string): boolean {
  const rule = normalizePrefix(rulePrefix);
  const target = normalizePrefix(targetPrefix);
  return !rule || target === rule || target.startsWith(`${rule}/`);
}

function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
