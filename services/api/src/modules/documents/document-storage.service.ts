import { Injectable, InternalServerErrorException, type OnModuleDestroy } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  createProductionOciObjectStorageRuntime,
  type OciObjectStorageRuntime,
} from "../../infrastructure/cloud/oci-object-storage-runtime";
import { localSyntheticPilotProvidersAllowed } from "../../infrastructure/release/private-pilot-infrastructure-profile";

@Injectable()
export class DocumentStorageService implements OnModuleDestroy {
  private s3?: S3Client;
  private ociRuntimePromise?: Promise<OciObjectStorageRuntime>;

  storageProviderName(): string {
    const provider = this.provider();
    if (provider === "oci") return "OCI_OBJECT_STORAGE";
    return provider === "s3" ? "AWS_S3" : "LOCAL_PRIVATE";
  }

  async put(objectKey: string, ciphertext: string): Promise<void> {
    const provider = this.provider();
    if (provider === "local") {
      const path = this.safePath(objectKey);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, ciphertext, { encoding: "utf8", mode: 0o600 });
      return;
    }
    if (provider === "oci") {
      await (await this.ociRuntime()).putString("clinical-documents", objectKey, ciphertext, {
        contentType: "application/octet-stream",
        metadata: { carepoint: "clinical-document", encrypted: "true" },
      });
      return;
    }
    const bucket = this.required("DOCUMENT_S3_BUCKET");
    const kmsKeyId = this.required("DOCUMENT_S3_KMS_KEY_ID");
    await this.s3Client().send(new PutObjectCommand({
      Bucket: bucket,
      Key: this.s3Key(objectKey),
      Body: ciphertext,
      ContentType: "application/octet-stream",
      CacheControl: "no-store",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: kmsKeyId,
      Metadata: { carepoint: "clinical-document", encrypted: "true" },
    }));
  }

  async get(objectKey: string): Promise<string> {
    const provider = this.provider();
    if (provider === "local") return readFile(this.safePath(objectKey), "utf8");
    if (provider === "oci") return (await this.ociRuntime()).getString("clinical-documents", objectKey);
    const result = await this.s3Client().send(new GetObjectCommand({ Bucket: this.required("DOCUMENT_S3_BUCKET"), Key: this.s3Key(objectKey) }));
    if (!result.Body) throw new InternalServerErrorException("Document object body was not returned by S3.");
    return result.Body.transformToString("utf-8");
  }

  async remove(objectKey: string): Promise<void> {
    const provider = this.provider();
    if (provider === "local") { await rm(this.safePath(objectKey), { force: true }); return; }
    if (provider === "oci") { await (await this.ociRuntime()).delete("clinical-documents", objectKey); return; }
    await this.s3Client().send(new DeleteObjectCommand({ Bucket: this.required("DOCUMENT_S3_BUCKET"), Key: this.s3Key(objectKey) }));
  }

  async onModuleDestroy(): Promise<void> {
    const pending = this.ociRuntimePromise;
    if (!pending) return;
    try {
      await (await pending).close();
    } catch {
      // Best-effort provider cleanup during application shutdown.
    }
  }

  private provider(): "local" | "s3" | "oci" {
    if (process.env.NODE_ENV === "production" && process.env.CAREPOINT_CLOUD_PROVIDER?.trim() === "oci") {
      if (process.env.CAREPOINT_OBJECT_STORAGE_PROVIDER?.trim() !== "oci-object-storage") {
        throw new InternalServerErrorException(
          "OCI production document storage requires CAREPOINT_OBJECT_STORAGE_PROVIDER='oci-object-storage'.",
        );
      }
      return "oci";
    }

    const provider = process.env.DOCUMENT_STORAGE_PROVIDER ?? (process.env.NODE_ENV === "production" ? "s3" : "local");
    if (provider !== "local" && provider !== "s3") throw new InternalServerErrorException(`Unsupported document storage provider '${provider}'.`);
    if (process.env.NODE_ENV === "production" && provider === "local" && !localSyntheticPilotProvidersAllowed(process.env)) {
      throw new InternalServerErrorException("Local document storage is forbidden in production.");
    }
    if (process.env.NODE_ENV === "production" && provider === "s3" && process.env.AWS_ENDPOINT_URL_S3?.trim()) {
      throw new InternalServerErrorException("Custom S3 endpoints are forbidden for production document storage.");
    }
    return provider;
  }

  private async ociRuntime(): Promise<OciObjectStorageRuntime> {
    if (!this.ociRuntimePromise) {
      this.ociRuntimePromise = createProductionOciObjectStorageRuntime(process.env).then((runtime) => {
        if (!runtime) throw new InternalServerErrorException("OCI Object Storage runtime is unavailable for production document storage.");
        return runtime;
      });
    }
    return this.ociRuntimePromise;
  }

  private s3Client(): S3Client {
    if (!this.s3) this.s3 = new S3Client({ ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}), ...(process.env.AWS_ENDPOINT_URL_S3 ? { endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: process.env.DOCUMENT_S3_FORCE_PATH_STYLE === "true" } : {}) });
    return this.s3;
  }

  private s3Key(objectKey: string): string {
    this.assertSafeObjectKey(objectKey);
    const prefix = (process.env.DOCUMENT_S3_PREFIX ?? "carepoint/clinical").replace(/^\/+|\/+$/g, "");
    return prefix ? `${prefix}/${objectKey}` : objectKey;
  }

  private root(): string { return resolve(process.env.DOCUMENT_STORAGE_LOCAL_ROOT ?? "/tmp/carepoint-documents"); }
  private safePath(objectKey: string): string {
    this.assertSafeObjectKey(objectKey);
    const root = this.root();
    const candidate = resolve(join(root, objectKey));
    if (candidate !== root && !candidate.startsWith(root + sep)) throw new InternalServerErrorException("Document object key escapes storage root.");
    return candidate;
  }
  private assertSafeObjectKey(objectKey: string): void {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(objectKey) || objectKey.includes("..")) throw new InternalServerErrorException("Unsafe document object key.");
  }
  private required(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new InternalServerErrorException(`${name} is required for S3 document storage.`); return value; }
}
