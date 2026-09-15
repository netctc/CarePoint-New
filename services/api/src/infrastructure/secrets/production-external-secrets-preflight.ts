import { EXTERNAL_SECRET_NAMES, ExternalSecretResolverService } from "./external-secret-resolver.service";
import type { CarePointRuntimeFeatures } from "../release/private-pilot-policy";

export async function assertProductionExternalSecretsReady(
  env: NodeJS.ProcessEnv = process.env,
  features?: CarePointRuntimeFeatures,
): Promise<void> {
  if (env.NODE_ENV !== "production") return;
  if (env !== process.env) {
    throw new Error("Production external secret preflight must run against process.env.");
  }

  const resolver = new ExternalSecretResolverService();
  const requiredNames = features?.privatePilot
    ? EXTERNAL_SECRET_NAMES.filter((name) => {
        if (name.startsWith("payment-") || name.startsWith("insurance-") || name.startsWith("claims-")) return features.payments;
        if (name.startsWith("notification-")) return features.externalNotifications;
        if (name.startsWith("livekit-")) return features.telehealth;
        return true;
      })
    : EXTERNAL_SECRET_NAMES;
  for (const name of requiredNames) {
    try {
      await resolver.resolve(name);
    } catch (error) {
      const code = error instanceof Error ? error.name : "UnknownError";
      throw new Error(`External secret preflight failed for '${name}' (${code}).`);
    }
  }
}
