import type {
  ProductionObjectStorageBucketInspection,
  ProductionObjectStorageDomain,
} from "./production-object-storage";

export type GcpStorageLifecycleRuleResource = {
  action?: { type?: string };
  condition?: Record<string, unknown> & {
    age?: number;
    isLive?: boolean;
    matchesPrefix?: string[];
  };
};

export type GcpStorageBucketResource = {
  name?: string;
  location?: string;
  iamConfiguration?: {
    publicAccessPrevention?: string;
    uniformBucketLevelAccess?: { enabled?: boolean };
  };
  encryption?: {
    defaultKmsKeyName?: string;
  };
  lifecycle?: {
    rule?: GcpStorageLifecycleRuleResource[];
  };
};

export type GcpObjectStorageLifecycleRuleInspection = {
  actionType: string;
  ageDays?: number | undefined;
  isLive?: boolean | undefined;
  matchesPrefix: string[];
  unsupportedConditions: string[];
};

export type GcpObjectStorageBucketInspection = ProductionObjectStorageBucketInspection & {
  uniformBucketLevelAccessEnabled: boolean;
  lifecycleRules: GcpObjectStorageLifecycleRuleInspection[];
};

export interface GcpStorageClientPort {
  getBucket(request: { bucketRef: string }): Promise<{ bucket?: GcpStorageBucketResource }>;
}

export type GcpObjectStorageInspectorOptions = {
  region: string;
  client: GcpStorageClientPort;
};

export type InspectGcpObjectStorageBucket = (
  domain: ProductionObjectStorageDomain,
) => Promise<GcpObjectStorageBucketInspection>;

export function createGcpObjectStorageBucketInspector(
  options: GcpObjectStorageInspectorOptions,
): InspectGcpObjectStorageBucket {
  const region = requiredRegion(options.region);

  return async (
    domain: ProductionObjectStorageDomain,
  ): Promise<GcpObjectStorageBucketInspection> => {
    if (domain.provider !== "gcp-cloud-storage") {
      throw namedError("GcpProviderMismatch", "GCP object-storage inspector received a non-GCP storage domain.");
    }
    if (domain.region !== region) {
      throw namedError("GcpRegionMismatch", "GCP Cloud Storage inspector region does not match the storage domain.");
    }

    const response = await options.client.getBucket({ bucketRef: domain.bucketRef });
    const resource = response.bucket;
    if (!resource) {
      throw namedError("GcpBucketNotFound", "GCP Cloud Storage returned no bucket resource.");
    }

    const location = resource.location?.trim().toLowerCase() ?? "";
    const kmsKeyRef = resource.encryption?.defaultKmsKeyName?.trim();

    return {
      provider: "gcp-cloud-storage",
      region: location,
      bucketRef: resource.name?.trim() ?? "",
      publicAccessDisabled: resource.iamConfiguration?.publicAccessPrevention?.trim().toLowerCase() === "enforced",
      customerManagedEncryption: Boolean(kmsKeyRef),
      ...(kmsKeyRef ? { kmsKeyRef } : {}),
      uniformBucketLevelAccessEnabled: resource.iamConfiguration?.uniformBucketLevelAccess?.enabled === true,
      lifecycleRules: (resource.lifecycle?.rule ?? []).map(normalizeLifecycleRule),
    };
  };
}

function normalizeLifecycleRule(rule: GcpStorageLifecycleRuleResource): GcpObjectStorageLifecycleRuleInspection {
  const condition = rule.condition ?? {};
  const unsupportedConditions = Object.keys(condition).filter(
    (name) => name !== "age" && name !== "isLive" && name !== "matchesPrefix",
  );
  const age = condition.age;
  const prefixes = Array.isArray(condition.matchesPrefix)
    ? condition.matchesPrefix.map((value) => String(value).trim()).filter(Boolean)
    : [];

  return {
    actionType: rule.action?.type?.trim() ?? "",
    ...(Number.isInteger(age) ? { ageDays: age } : {}),
    ...(typeof condition.isLive === "boolean" ? { isLive: condition.isLive } : {}),
    matchesPrefix: prefixes,
    unsupportedConditions,
  };
}

function requiredRegion(value: string): string {
  const region = value.trim();
  if (!region) throw new Error("GCP object-storage inspector region is required.");
  return region;
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
