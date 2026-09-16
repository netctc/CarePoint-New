import { assertProductionDataGovernanceReady } from "../data-governance/production-data-governance-preflight";
import {
  productionCloudContract,
  type ProductionCloudContract,
} from "./production-cloud-provider";

/**
 * Resolve and validate the production cloud contract before any provider-backed
 * startup dependency is initialized. Non-production runtimes remain unchanged.
 */
export function assertProductionCloudStartupReady(
  env: NodeJS.ProcessEnv = process.env,
): ProductionCloudContract | null {
  const contract = productionCloudContract(env);
  if (!contract) return null;

  assertProductionDataGovernanceReady(env);

  if (contract.provider === "gcp") {
    throw new Error(
      "GCP Release 1 production startup remains disabled until the GCP runtime binding is completed and accepted under R3-GCP G2.",
    );
  }

  return contract;
}
