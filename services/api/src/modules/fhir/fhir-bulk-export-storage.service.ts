import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

@Injectable()
export class FhirBulkExportStorageService {
  private s3?: S3Client;

  async put(objectKey: string, ndjson: string, expiresAt: string): Promise<void> {
    const provider = this.provider();
    if (provider === "local") {
      const path = this.safePath(objectKey);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, ndjson, { encoding: "utf8", mode: 0o600 });
      return;
    }

    await this.s3Client().send(new PutObjectCommand({
      Bucket: this.bucket(),
      Key: this.s3Key(objectKey),
      Body: ndjson,
      ContentType: "application/fhir+ndjson",
      CacheControl: "no-store",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: this.kmsKeyId(),
      Metadata: {
        carepoint: "fhir-bulk-export",
        expiresat: expiresAt,
      },
    }));
  }

  async get(objectKey: string): Promise<string> {
    if (this.provider() === "local") return readFile(this.safePath(objectKey), "utf8");
    const result = await this.s3Client().send(new GetObjectCommand({
      Bucket: this.bucket(),
      Key: this.s3Key(objectKey),
    }));
    if (!result.Body) throw new InternalServerErrorException("FHIR bulk export object body was not returned by S3.");
    return result.Body.transformToString("utf-8");
  }

  async remove(objectKey: string): Promise<void> {
    if (this.provider() === "local") {
      await rm(this.safePath(objectKey), { force: true });
      return;
    }
    await this.s3Client().send(new DeleteObjectCommand({
      Bucket: this.bucket(),
      Key: this.s3Key(objectKey),
    }));
  }

  private provider(): "local" | "s3" {
    const provider = process.env.BULK_EXPORT_STORAGE_PROVIDER
      ?? process.env.DOCUMENT_STORAGE_PROVIDER
      ?? (process.env.NODE_ENV === "production" ? "s3" : "local");
    if (provider !== "local" && provider !== "s3") {
      throw new InternalServerErrorException(`Unsupported FHIR bulk export storage provider '${provider}'.`);
    }
    if (process.env.NODE_ENV === "production" && provider === "local") {
      throw new InternalServerErrorException("Local FHIR bulk export storage is forbidden in production.");
    }
    if (process.env.NODE_ENV === "production" && process.env.BULK_EXPORT_STORAGE_LIFECYCLE_CONFIRMED !== "true") {
      throw new InternalServerErrorException("BULK_EXPORT_STORAGE_LIFECYCLE_CONFIRMED=true is required in production so expired bulk-export objects are removed by storage lifecycle policy.");
    }
    return provider;
  }

  private s3Client(): S3Client {
    if (!this.s3) {
      this.s3 = new S3Client({
        ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
        ...(process.env.AWS_ENDPOINT_URL_S3
          ? { endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: process.env.BULK_EXPORT_S3_FORCE_PATH_STYLE === "true" }
          : {}),
      });
    }
    return this.s3;
  }

  private bucket(): string {
    return this.required("BULK_EXPORT_S3_BUCKET", "DOCUMENT_S3_BUCKET");
  }

  private kmsKeyId(): string {
    return this.required("BULK_EXPORT_S3_KMS_KEY_ID", "DOCUMENT_S3_KMS_KEY_ID");
  }

  private s3Key(objectKey: string): string {
    this.assertSafeObjectKey(objectKey);
    const prefix = (process.env.BULK_EXPORT_S3_PREFIX ?? "carepoint/bulk-export").replace(/^\/+|\/+$/g, "");
    return prefix ? `${prefix}/${objectKey}` : objectKey;
  }

  private root(): string {
    return resolve(process.env.BULK_EXPORT_STORAGE_LOCAL_ROOT ?? "/tmp/carepoint-bulk-export");
  }

  private safePath(objectKey: string): string {
    this.assertSafeObjectKey(objectKey);
    const root = this.root();
    const candidate = resolve(join(root, objectKey));
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      throw new InternalServerErrorException("FHIR bulk export object key escapes storage root.");
    }
    return candidate;
  }

  private assertSafeObjectKey(objectKey: string): void {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(objectKey) || objectKey.includes("..")) {
      throw new InternalServerErrorException("Unsafe FHIR bulk export object key.");
    }
  }

  private required(primary: string, fallback: string): string {
    const value = process.env[primary]?.trim() || process.env[fallback]?.trim();
    if (!value) throw new InternalServerErrorException(`${primary} (or ${fallback}) is required for S3 bulk export storage.`);
    return value;
  }
}
