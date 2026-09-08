import { siemGatewayConfiguration } from "./siem-gateway.service";
import { siemWorkerConfiguration } from "./siem-outbox-worker.service";

const MIN_LEASE_TIMEOUT_MARGIN_MS = 5_000;

export function assertProductionSiemReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const gateway = siemGatewayConfiguration(env);
  const worker = siemWorkerConfiguration(env);
  if (!gateway.enabled) throw new Error("Phase C9 production SIEM export must be enabled.");
  if (!worker.enabled) throw new Error("Phase C9 production SIEM worker must be enabled.");
  if (worker.leaseSeconds * 1000 < gateway.timeoutMs + MIN_LEASE_TIMEOUT_MARGIN_MS) {
    throw new Error("SIEM_WORKER_LEASE_SECONDS must exceed SIEM_EXPORT_TIMEOUT_MS by at least 5 seconds.");
  }
}
