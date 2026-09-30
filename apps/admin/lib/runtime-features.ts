function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export type AdminRuntimeFeatures = Readonly<{
  transportModuleEnabled: boolean;
}>;

export function adminRuntimeFeatures(
  env: NodeJS.ProcessEnv = process.env,
): AdminRuntimeFeatures {
  return {
    transportModuleEnabled: enabled(env.TRANSPORT_MODULE_ENABLED),
  };
}
