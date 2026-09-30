import {
  productionObjectStorageContract,
  type ProductionObjectStorageBucketInspection,
  type ProductionObjectStorageDomain,
} from "./production-object-storage";

const INSTANCE_PRINCIPAL_AUTH_MODE = "instance-principal";
const FORBIDDEN_ENDPOINT_ENV_VARS = [
  "CAREPOINT_OCI_OBJECT_STORAGE_ENDPOINT",
  "OCI_OBJECT_STORAGE_ENDPOINT",
] as const;

export type OciObjectStorageDomainLabel = "clinical-documents" | "fhir-bulk-export";

type OciAuthenticationProvider = unknown;

type OciNamespaceResponse = { value?: string | undefined };
type OciGetObjectResponse = { value?: unknown };
type OciBucketResponse = {
  bucket?: {
    name?: string | undefined;
    namespace?: string | undefined;
    kmsKeyId?: string | undefined;
    publicAccessType?: string | undefined;
  } | undefined;
};
type OciLifecycleRule = {
  action?: string | undefined;
  target?: string | undefined;
  timeAmount?: number | undefined;
  timeUnit?: string | undefined;
  isEnabled?: boolean | undefined;
  objectNameFilter?: {
    inclusionPrefixes?: string[] | undefined;
    inclusionPatterns?: string[] | undefined;
    exclusionPatterns?: string[] | undefined;
  } | undefined;
};
type OciLifecycleResponse = {
  objectLifecyclePolicy?: { items?: OciLifecycleRule[] | undefined } | undefined;
};

export type OciObjectStorageLifecycleRuleInspection = {
  action: string;
  target?: string | undefined;
  timeAmount: number;
  timeUnit: string;
  enabled: boolean;
  inclusionPrefixes: string[];
  inclusionPatterns: string[];
  exclusionPatterns: string[];
};

export type OciObjectStorageBucketInspection = ProductionObjectStorageBucketInspection & {
  lifecycleRules: OciObjectStorageLifecycleRuleInspection[];
};

export interface OciObjectStorageClientPort {
  regionId: string;
  getNamespace(request: { compartmentId?: string | undefined }): Promise<OciNamespaceResponse>;
  getBucket(request: {
    namespaceName: string;
    bucketName: string;
  }): Promise<OciBucketResponse>;
  getObjectLifecyclePolicy(request: {
    namespaceName: string;
    bucketName: string;
  }): Promise<OciLifecycleResponse>;
  putObject(request: {
    namespaceName: string;
    bucketName: string;
    objectName: string;
    putObjectBody: string | Uint8Array;
    contentLength?: number | undefined;
    contentType?: string | undefined;
    cacheControl?: string | undefined;
    opcMeta?: Record<string, string> | undefined;
    opcSseKmsKeyId?: string | undefined;
  }): Promise<unknown>;
  getObject(request: {
    namespaceName: string;
    bucketName: string;
    objectName: string;
  }): Promise<OciGetObjectResponse>;
  deleteObject(request: {
    namespaceName: string;
    bucketName: string;
    objectName: string;
  }): Promise<unknown>;
  close(): void;
}

export interface OciObjectStorageSdkFactory {
  buildInstancePrincipal(): Promise<OciAuthenticationProvider>;
  createObjectStorageClient(provider: OciAuthenticationProvider): OciObjectStorageClientPort;
}

export type OciObjectStorageRuntimeOptions = {
  sdkFactory?: OciObjectStorageSdkFactory;
};

export type OciObjectStorageRuntime = {
  putString(
    label: OciObjectStorageDomainLabel,
    objectKey: string,
    body: string,
    options?: {
      contentType?: string | undefined;
      metadata?: Record<string, string> | undefined;
    },
  ): Promise<void>;
  getString(label: OciObjectStorageDomainLabel, objectKey: string): Promise<string>;
  delete(label: OciObjectStorageDomainLabel, objectKey: string): Promise<void>;
  inspectBucket(label: OciObjectStorageDomainLabel): Promise<OciObjectStorageBucketInspection>;
  close(): Promise<void>;
};

/**
 * Creates the live OCI Object Storage runtime used by Release 1 production.
 *
 * The adapter deliberately keeps OCI SDK loading dormant outside OCI production,
 * uses instance-principal authentication only, binds the client to the approved
 * Riyadh region, and derives bucket/key/prefix values from the provider-neutral
 * production object-storage contract.
 */
export async function createProductionOciObjectStorageRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: OciObjectStorageRuntimeOptions = {},
): Promise<OciObjectStorageRuntime | null> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "oci") return null;

  if (env.CAREPOINT_OCI_AUTH_MODE?.trim() !== INSTANCE_PRINCIPAL_AUTH_MODE) {
    throw new Error(
      `CAREPOINT_OCI_AUTH_MODE must be '${INSTANCE_PRINCIPAL_AUTH_MODE}' for OCI Release 1 production.`,
    );
  }
  for (const name of FORBIDDEN_ENDPOINT_ENV_VARS) {
    if (env[name]?.trim()) {
      throw new Error(`${name} endpoint overrides are forbidden in OCI Release 1 production.`);
    }
  }

  const contract = productionObjectStorageContract(env);
  if (!contract || contract.provider !== "oci-object-storage") {
    throw new Error("OCI Object Storage runtime requires the OCI production object-storage contract.");
  }

  const domains = new Map<OciObjectStorageDomainLabel, ProductionObjectStorageDomain>();
  for (const domain of contract.domains) domains.set(domain.label, domain);
  for (const label of ["clinical-documents", "fhir-bulk-export"] as const) {
    if (!domains.has(label)) throw new Error(`OCI Object Storage contract is missing '${label}'.`);
  }

  const sdkFactory = options.sdkFactory ?? loadDefaultSdkFactory();
  let provider: OciAuthenticationProvider;
  try {
    provider = await sdkFactory.buildInstancePrincipal();
  } catch (error) {
    throw new Error(`OCI instance-principal authentication initialization failed (${errorName(error)}).`);
  }

  let client: OciObjectStorageClientPort | undefined;
  try {
    client = sdkFactory.createObjectStorageClient(provider);
    client.regionId = contract.region;

    let namespaceResponse: OciNamespaceResponse;
    try {
      namespaceResponse = await client.getNamespace({
        ...(env.OCI_COMPARTMENT_OCID?.trim() ? { compartmentId: env.OCI_COMPARTMENT_OCID.trim() } : {}),
      });
    } catch (error) {
      throw new Error(`OCI Object Storage namespace discovery failed (${errorName(error)}).`);
    }
    const namespaceName = validateNamespace(namespaceResponse.value);

    let closed = false;
    return {
      async putString(label, objectKey, body, putOptions = {}) {
        const domain = requiredDomain(domains, label);
        const objectName = objectNameFor(domain, objectKey);
        try {
          await client!.putObject({
            namespaceName,
            bucketName: domain.bucketRef,
            objectName,
            putObjectBody: body,
            contentLength: Buffer.byteLength(body, "utf8"),
            contentType: putOptions.contentType ?? "application/octet-stream",
            cacheControl: "no-store",
            opcMeta: putOptions.metadata,
            opcSseKmsKeyId: domain.kmsKeyRef,
          });
        } catch (error) {
          throw new Error(`OCI Object Storage put failed (${errorName(error)}).`);
        }
      },
      async getString(label, objectKey) {
        const domain = requiredDomain(domains, label);
        const objectName = objectNameFor(domain, objectKey);
        let response: OciGetObjectResponse;
        try {
          response = await client!.getObject({
            namespaceName,
            bucketName: domain.bucketRef,
            objectName,
          });
        } catch (error) {
          throw new Error(`OCI Object Storage get failed (${errorName(error)}).`);
        }
        return readObjectBody(response.value);
      },
      async delete(label, objectKey) {
        const domain = requiredDomain(domains, label);
        const objectName = objectNameFor(domain, objectKey);
        try {
          await client!.deleteObject({
            namespaceName,
            bucketName: domain.bucketRef,
            objectName,
          });
        } catch (error) {
          throw new Error(`OCI Object Storage delete failed (${errorName(error)}).`);
        }
      },
      async inspectBucket(label) {
        const domain = requiredDomain(domains, label);
        let bucketResponse: OciBucketResponse;
        try {
          bucketResponse = await client!.getBucket({
            namespaceName,
            bucketName: domain.bucketRef,
          });
        } catch (error) {
          throw new Error(`OCI Object Storage bucket inspection failed (${errorName(error)}).`);
        }
        const bucket = bucketResponse.bucket;
        if (!bucket || bucket.name !== domain.bucketRef || bucket.namespace !== namespaceName) {
          throw new Error("OCI Object Storage bucket inspection returned an unexpected resource.");
        }

        let lifecycleRules: OciLifecycleRule[] = [];
        try {
          const lifecycle = await client!.getObjectLifecyclePolicy({
            namespaceName,
            bucketName: domain.bucketRef,
          });
          lifecycleRules = lifecycle.objectLifecyclePolicy?.items ?? [];
        } catch (error) {
          if (!isMissingLifecyclePolicy(error)) {
            throw new Error(`OCI Object Storage lifecycle inspection failed (${errorName(error)}).`);
          }
        }

        const kmsKeyRef = bucket.kmsKeyId?.trim();
        return {
          provider: "oci-object-storage",
          region: domain.region,
          bucketRef: domain.bucketRef,
          publicAccessDisabled: bucket.publicAccessType === "NoPublicAccess",
          customerManagedEncryption: Boolean(kmsKeyRef),
          ...(kmsKeyRef ? { kmsKeyRef } : {}),
          lifecycleRules: lifecycleRules.map(normalizeLifecycleRule),
        };
      },
      async close() {
        if (closed) return;
        closed = true;
        closeClient(client);
        closeProvider(provider);
      },
    };
  } catch (error) {
    closeClient(client);
    closeProvider(provider);
    throw error;
  }
}

function normalizeLifecycleRule(rule: OciLifecycleRule): OciObjectStorageLifecycleRuleInspection {
  return {
    action: String(rule.action ?? ""),
    ...(rule.target ? { target: String(rule.target) } : {}),
    timeAmount: Number(rule.timeAmount ?? 0),
    timeUnit: String(rule.timeUnit ?? ""),
    enabled: rule.isEnabled === true,
    inclusionPrefixes: rule.objectNameFilter?.inclusionPrefixes?.map(String) ?? [],
    inclusionPatterns: rule.objectNameFilter?.inclusionPatterns?.map(String) ?? [],
    exclusionPatterns: rule.objectNameFilter?.exclusionPatterns?.map(String) ?? [],
  };
}

function requiredDomain(
  domains: Map<OciObjectStorageDomainLabel, ProductionObjectStorageDomain>,
  label: OciObjectStorageDomainLabel,
): ProductionObjectStorageDomain {
  const domain = domains.get(label);
  if (!domain) throw new Error(`OCI Object Storage contract is missing '${label}'.`);
  return domain;
}

function objectNameFor(domain: ProductionObjectStorageDomain, objectKey: string): string {
  assertSafeObjectKey(objectKey);
  return domain.prefix ? `${domain.prefix}/${objectKey}` : objectKey;
}

function assertSafeObjectKey(objectKey: string): void {
  if (!objectKey || !/^[A-Za-z0-9/_\-.]+$/.test(objectKey) || objectKey.includes("..")) {
    throw new Error("Unsafe OCI Object Storage object key.");
  }
}

function validateNamespace(value: string | undefined): string {
  const namespace = value?.trim() ?? "";
  if (!namespace || namespace.length > 255 || /\s/.test(namespace)) {
    throw new Error("OCI Object Storage namespace discovery returned an invalid namespace.");
  }
  return namespace;
}

async function readObjectBody(value: unknown): Promise<string> {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") {
    throw new Error("OCI Object Storage get returned no object body.");
  }

  const asyncIterable = value as AsyncIterable<unknown>;
  if (typeof asyncIterable[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of asyncIterable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array | string));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  const webStream = value as {
    getReader?: () => {
      read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
      releaseLock?: () => void;
    };
  };
  if (typeof webStream.getReader === "function") {
    const reader = webStream.getReader();
    const chunks: Buffer[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value) chunks.push(Buffer.from(next.value));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  throw new Error("OCI Object Storage get returned an unsupported object body stream.");
}

function loadDefaultSdkFactory(): OciObjectStorageSdkFactory {
  try {
    // Runtime requires are intentional: non-OCI deployments do not initialize OCI SDK modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const common = require("oci-common") as {
      InstancePrincipalsAuthenticationDetailsProvider: {
        builder(): { build(): Promise<OciAuthenticationProvider> };
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const objectstorage = require("oci-objectstorage") as {
      ObjectStorageClient: new (args: {
        authenticationDetailsProvider: OciAuthenticationProvider;
      }) => OciObjectStorageClientPort;
    };
    return {
      buildInstancePrincipal: () => common.InstancePrincipalsAuthenticationDetailsProvider.builder().build(),
      createObjectStorageClient: (provider) => new objectstorage.ObjectStorageClient({ authenticationDetailsProvider: provider }),
    };
  } catch (error) {
    throw new Error(`OCI Object Storage SDK modules could not be loaded (${errorName(error)}).`);
  }
}

function isMissingLifecyclePolicy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { statusCode?: unknown; status?: unknown; name?: unknown };
  const status = Number(candidate.statusCode ?? candidate.status ?? 0);
  if (status === 404) return true;
  const name = String(candidate.name ?? "");
  return name === "ObjectLifecyclePolicyNotFound" || name === "NoSuchObjectLifecyclePolicy";
}

function closeClient(client: OciObjectStorageClientPort | undefined): void {
  if (!client) return;
  try {
    client.close();
  } catch {
    // Best-effort cleanup only.
  }
}

function closeProvider(provider: OciAuthenticationProvider): void {
  const candidate = provider as { closeProvider?: () => void } | null;
  if (!candidate?.closeProvider) return;
  try {
    candidate.closeProvider();
  } catch {
    // Best-effort cleanup only.
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "OciSdkError";
  }
  return "OciSdkError";
}
