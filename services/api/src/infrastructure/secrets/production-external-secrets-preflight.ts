import { EXTERNAL_SECRET_NAMES, ExternalSecretResolverService } from "./external-secret-resolver.service";

export async function assertProductionExternalSecretsReady(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NODE_ENV !== "production") return;
  if (env !== process.env) {
    throw new Error("Production external secret preflight must run against process.env.");
  }

  const resolver = new ExternalSecretResolverService();
  for (const name of EXTERNAL_SECRET_NAMES) {
    try {
      await resolver.resolve(name);
    } catch (error) {
      const code = error instanceof Error ? error.name : "UnknownError";
      throw new Error(`External secret preflight failed for '${name}' (${code}).`);
    }
  }
}
