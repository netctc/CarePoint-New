import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

@Injectable()
export class DocumentStorageService {
  private provider(): string {
    const provider = process.env.DOCUMENT_STORAGE_PROVIDER ?? "local";
    if (process.env.NODE_ENV === "production" && provider === "local") {
      throw new InternalServerErrorException("Production document storage requires an external private object-storage adapter.");
    }
    if (provider !== "local") throw new InternalServerErrorException(`Document storage provider '${provider}' is not wired in this runtime yet.`);
    return provider;
  }

  storageProviderName(): string { return this.provider(); }

  async put(objectKey: string, ciphertext: string): Promise<void> {
    this.provider();
    const path = this.safePath(objectKey);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, ciphertext, { encoding: "utf8", mode: 0o600 });
  }

  async get(objectKey: string): Promise<string> {
    this.provider();
    return readFile(this.safePath(objectKey), "utf8");
  }

  async remove(objectKey: string): Promise<void> {
    this.provider();
    await rm(this.safePath(objectKey), { force: true });
  }

  private root(): string { return resolve(process.env.DOCUMENT_STORAGE_LOCAL_ROOT ?? "/tmp/carepoint-documents"); }

  private safePath(objectKey: string): string {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(objectKey)) throw new InternalServerErrorException("Unsafe document object key.");
    const root = this.root();
    const candidate = resolve(join(root, objectKey));
    if (candidate !== root && !candidate.startsWith(root + sep)) throw new InternalServerErrorException("Document object key escapes storage root.");
    return candidate;
  }
}
