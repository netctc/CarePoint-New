import {
  Injectable,
  InternalServerErrorException,
  type OnModuleDestroy,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createProductionGcpObjectStorageRuntime,
  type GcpObjectStorageRuntime,
} from "../../infrastructure/cloud/gcp-object-storage-runtime";
import {
  createProductionOciObjectStorageRuntime,
  type OciObjectStorageRuntime,
} from "../../infrastructure/cloud/oci-object-storage-runtime";

@Injectable()
export class TransportReportArtifactStorageService implements OnModuleDestroy {
  private gcpRuntimePromise?: Promise<GcpObjectStorageRuntime>;
  private ociRuntimePromise?: Promise<OciObjectStorageRuntime>;

  async putCsv(objectKey: string, csv: string): Promise<{ provider: string }> {
    this.assertSafeObjectKey(objectKey);
    if (process.env.NODE_ENV !== "production") {
      const root = resolve("/tmp/carepoint-transport-reports");
      await mkdir(root, { recursive: true, mode: 0o700 });
      await writeFile(this.localPath(objectKey), csv, {
        encoding: "utf8",
        mode: 0o600,
      });
      return { provider: "LOCAL_PRIVATE" };
    }

    const cloud = process.env.CAREPOINT_CLOUD_PROVIDER?.trim();
    if (cloud === "gcp") {
      await (await this.gcpRuntime()).putString(
        "transport-management-reports",
        objectKey,
        csv,
        {
          contentType: "text/csv; charset=utf-8",
          metadata: {
            carepoint: "transport-management-report",
            sanitized: "true",
            public: "false",
          },
        },
      );
      return { provider: "GCP_CLOUD_STORAGE" };
    }
    if (cloud === "oci") {
      await (await this.ociRuntime()).putString(
        "transport-management-reports",
        objectKey,
        csv,
        {
          contentType: "text/csv; charset=utf-8",
          metadata: {
            carepoint: "transport-management-report",
            sanitized: "true",
            public: "false",
          },
        },
      );
      return { provider: "OCI_OBJECT_STORAGE" };
    }

    throw new InternalServerErrorException(
      "Transport report artifact storage requires the approved production cloud object-storage runtime.",
    );
  }

  async getCsv(objectKey: string): Promise<string> {
    this.assertSafeObjectKey(objectKey);
    if (process.env.NODE_ENV !== "production") {
      return readFile(this.localPath(objectKey), "utf8");
    }

    const cloud = process.env.CAREPOINT_CLOUD_PROVIDER?.trim();
    if (cloud === "gcp") {
      return (await this.gcpRuntime()).getString(
        "transport-management-reports",
        objectKey,
      );
    }
    if (cloud === "oci") {
      return (await this.ociRuntime()).getString(
        "transport-management-reports",
        objectKey,
      );
    }
    throw new InternalServerErrorException(
      "Transport report artifact storage requires the approved production cloud object-storage runtime.",
    );
  }

  async deleteCsv(objectKey: string): Promise<void> {
    this.assertSafeObjectKey(objectKey);
    if (process.env.NODE_ENV !== "production") {
      try {
        await unlink(this.localPath(objectKey));
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
      return;
    }

    const cloud = process.env.CAREPOINT_CLOUD_PROVIDER?.trim();
    if (cloud === "gcp") {
      await (await this.gcpRuntime()).delete(
        "transport-management-reports",
        objectKey,
      );
      return;
    }
    if (cloud === "oci") {
      await (await this.ociRuntime()).delete(
        "transport-management-reports",
        objectKey,
      );
      return;
    }
    throw new InternalServerErrorException(
      "Transport report artifact storage requires the approved production cloud object-storage runtime.",
    );
  }

  encodeCsv(
    columns: readonly string[],
    rows: ReadonlyArray<Record<string, unknown>>,
  ): string {
    const line = (values: unknown[]) => values.map((value) => this.csvCell(value)).join(",");
    return "\uFEFF" + [
      line([...columns]),
      ...rows.map((row) => line(columns.map((column) => row[column]))),
    ].join("\r\n") + "\r\n";
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.closeRuntime(this.gcpRuntimePromise),
      this.closeRuntime(this.ociRuntimePromise),
    ]);
  }

  private csvCell(value: unknown): string {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  private localPath(objectKey: string): string {
    this.assertSafeObjectKey(objectKey);
    const storageId = createHash("sha256")
      .update(objectKey, "utf8")
      .digest("hex");
    return join(resolve("/tmp/carepoint-transport-reports"), storageId + ".csv");
  }

  private assertSafeObjectKey(objectKey: string): void {
    if (
      !objectKey ||
      objectKey.length > 900 ||
      !/^[A-Za-z0-9/_\-.]+$/.test(objectKey) ||
      objectKey.includes("..")
    ) {
      throw new InternalServerErrorException(
        "Unsafe transport report artifact object key.",
      );
    }
  }

  private async gcpRuntime(): Promise<GcpObjectStorageRuntime> {
    if (!this.gcpRuntimePromise) {
      this.gcpRuntimePromise = createProductionGcpObjectStorageRuntime(process.env).then(
        (runtime) => {
          if (!runtime) {
            throw new InternalServerErrorException(
              "GCP Cloud Storage runtime is unavailable for transport report artifacts.",
            );
          }
          return runtime;
        },
      );
    }
    return this.gcpRuntimePromise;
  }

  private async ociRuntime(): Promise<OciObjectStorageRuntime> {
    if (!this.ociRuntimePromise) {
      this.ociRuntimePromise = createProductionOciObjectStorageRuntime(process.env).then(
        (runtime) => {
          if (!runtime) {
            throw new InternalServerErrorException(
              "OCI Object Storage runtime is unavailable for transport report artifacts.",
            );
          }
          return runtime;
        },
      );
    }
    return this.ociRuntimePromise;
  }

  private async closeRuntime(
    runtimePromise: Promise<{ close(): Promise<void> }> | undefined,
  ): Promise<void> {
    if (!runtimePromise) return;
    try {
      await (await runtimePromise).close();
    } catch {
      // Best-effort runtime cleanup.
    }
  }
}
