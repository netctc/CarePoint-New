export interface EmergencyAmbulanceLaunchConfiguration {
  enabled: boolean;
  jurisdiction?: string | undefined;
  licensedOperatorRef?: string | undefined;
  localApprovalRef?: string | undefined;
  support24x7Confirmed: boolean;
}

export function emergencyAmbulanceLaunchConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): EmergencyAmbulanceLaunchConfiguration {
  const production = env.NODE_ENV === "production";
  const enabled = explicitBoolean(
    env.EMERGENCY_AMBULANCE_ENABLED,
    "EMERGENCY_AMBULANCE_ENABLED",
    !production,
  );

  if (!enabled) {
    return { enabled: false, support24x7Confirmed: false };
  }

  if (!production) {
    return {
      enabled: true,
      jurisdiction: optionalReference(env.EMERGENCY_AMBULANCE_JURISDICTION),
      licensedOperatorRef: optionalReference(env.EMERGENCY_AMBULANCE_LICENSED_OPERATOR_REF),
      localApprovalRef: optionalReference(env.EMERGENCY_AMBULANCE_LOCAL_APPROVAL_REF),
      support24x7Confirmed: explicitBoolean(
        env.EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED,
        "EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED",
        false,
      ),
    };
  }

  const jurisdiction = requiredReference(
    env.EMERGENCY_AMBULANCE_JURISDICTION,
    "EMERGENCY_AMBULANCE_JURISDICTION",
  );
  const licensedOperatorRef = requiredReference(
    env.EMERGENCY_AMBULANCE_LICENSED_OPERATOR_REF,
    "EMERGENCY_AMBULANCE_LICENSED_OPERATOR_REF",
  );
  const localApprovalRef = requiredReference(
    env.EMERGENCY_AMBULANCE_LOCAL_APPROVAL_REF,
    "EMERGENCY_AMBULANCE_LOCAL_APPROVAL_REF",
  );
  const support24x7Confirmed = explicitBoolean(
    env.EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED,
    "EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED",
    false,
  );
  if (!support24x7Confirmed) {
    throw new Error(
      "Production emergency ambulance activation requires EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED=true.",
    );
  }

  return {
    enabled: true,
    jurisdiction,
    licensedOperatorRef,
    localApprovalRef,
    support24x7Confirmed,
  };
}

export function emergencyAmbulanceModuleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return emergencyAmbulanceLaunchConfiguration(env).enabled;
}

export function assertProductionEmergencyAmbulanceReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  emergencyAmbulanceLaunchConfiguration(env);
}

function explicitBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be explicitly set to 'true' or 'false'.`);
}

function requiredReference(value: string | undefined, name: string): string {
  const normalized = optionalReference(value);
  if (!normalized) {
    throw new Error(`Production emergency ambulance activation requires ${name}.`);
  }
  return normalized;
}

function optionalReference(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 240 || /[\r\n\0]/.test(normalized)) {
    throw new Error("Emergency ambulance approval references must be single-line values of at most 240 characters.");
  }
  return normalized;
}
