import type {
  ProductionObjectStorageBucketInspection,
  ProductionObjectStorageDomain,
} from "./production-object-storage";

export type GcpStorageBucketResource = {
  name?: string;
  location?: string;
  iamConfiguration?: {
    publicAccessPrevention?: string;
  };
  encryption?: {
    defaultKmsKeyName?: string;
  };
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
) => Promise<ProductionObjectStorageBucketInspection>;

export function createGcpObjectStorageBucketInspector(
  options: GcpObjectStorageInspectorOptions,
): InspectGcpObjectStorageBucket {
  const region = requiredRegion(options.region);

  return async (
    domain: ProductionObjectStorageDomain,
  ): Promise<ProductionObjectStorageBucketInspection> => {
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
    };
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
