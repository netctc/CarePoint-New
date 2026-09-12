import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

@Injectable()
export class DocumentStorageService {
  private s3?: S3Client;

  storageProviderName(): string {
    const provider = this.provider();
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
    const result = await this.s3Client().send(new GetObjectCommand({
      Bucket: this.required("DOCUMENT_S3_BUCKET"),
      Key: this.s3Key(objectKey),
    }));
    if (!result.Body) throw new InternalServerErrorException("Document object body was not returned by S3.");
    return result.Body.transformToString("utf-8");
  }

  async remove(objectKey: string): Promise<void> {
    const provider = this.provider();
    if (provider === "local") {
      await rm(this.safePath(objectKey), { force: true });
      return;
    }
    await this.s3Client().send(new DeleteObjectCommand({
      Bucket: this.required("DOCUMENT_S3_BUCKET"),
      Key: this.s3Key(objectKey),
    }));
  }

  private provider(): "local" | "s3" {
    const provider = process.env.DOCUMENT_STORAGE_PROVIDER ?? (process.env.NODE_ENV === "production" ? "s3" : "local");
    if (provider !== "local" && provider !== "s3") throw new InternalServerErrorException(`Unsupported document storage provider '${provider}'.`);
    if (process.env.NODE_ENV === "production" && provider === "local") throw new InternalServerErrorException("Local document storage is forbidden in production.");
    if (process.env.NODE_ENV === "production" && process.env.AWS_ENDPOINT_URL_S3?.trim()) {
      throw new InternalServerErrorException("Custom S3 endpoints are forbidden for production document storage.");
    }
    return provider;
  }

  private s3Client(): S3Client {
    if (!this.s3) {
      this.s3 = new S3Client({
        ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
        ...(process.env.AWS_ENDPOINT_URL_S3 ? { endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: process.env.DOCUMENT_S3_FORCE_PATH_STYLE === "true" } : {}),
      });
    }
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

  private required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new InternalServerErrorException(`${name} is required for S3 document storage.`);
    return value;
  }
}
