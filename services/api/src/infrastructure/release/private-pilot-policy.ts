const PILOT_FLAG_NAMES = [
  "CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED",
  "CAREPOINT_PAYMENTS_ENABLED",
  "CAREPOINT_TELEHEALTH_ENABLED",
  "CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED",
] as const;

export interface CarePointRuntimeFeatures {
  privatePilot: boolean;
  patientSelfRegistration: boolean;
  payments: boolean;
  telehealth: boolean;
  externalNotifications: boolean;
}

export function carePointRuntimeFeatures(env: NodeJS.ProcessEnv = process.env): CarePointRuntimeFeatures {
  const privatePilot = booleanFlag(env.CAREPOINT_PRIVATE_PILOT, "CAREPOINT_PRIVATE_PILOT", false);
  const defaults = !privatePilot;
  const features = {
    privatePilot,
    patientSelfRegistration: booleanFlag(
      env.CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED,
      "CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED",
      defaults,
    ),
    payments: booleanFlag(env.CAREPOINT_PAYMENTS_ENABLED, "CAREPOINT_PAYMENTS_ENABLED", defaults),
    telehealth: booleanFlag(env.CAREPOINT_TELEHEALTH_ENABLED, "CAREPOINT_TELEHEALTH_ENABLED", defaults),
    externalNotifications: booleanFlag(
      env.CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED,
      "CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED",
      defaults,
    ),
  };

  if (privatePilot) assertPrivatePilotConfiguration(env, features);
  return features;
}

export function assertPrivatePilotConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  features: CarePointRuntimeFeatures = carePointRuntimeFeaturesWithoutAssertion(env),
): void {
  if (!features.privatePilot) return;
  if (env.NODE_ENV !== "production") {
    throw new Error("CAREPOINT_PRIVATE_PILOT=true requires NODE_ENV=production so production transport and cookie controls remain active.");
  }

  for (const name of PILOT_FLAG_NAMES) {
    if (env[name]?.trim().toLowerCase() !== "false") {
      throw new Error(`${name}=false must be explicit for the private pilot.`);
    }
  }
  if (features.patientSelfRegistration || features.payments || features.telehealth || features.externalNotifications) {
    throw new Error("The private pilot must keep self-registration, payments, telehealth and external notifications disabled.");
  }
  if (env.EMERGENCY_AMBULANCE_ENABLED?.trim().toLowerCase() !== "false") {
    throw new Error("EMERGENCY_AMBULANCE_ENABLED=false must be explicit for the private pilot.");
  }
  if (env.NOTIFICATION_GATEWAY_PROVIDER?.trim().toLowerCase() !== "mock") {
    throw new Error("NOTIFICATION_GATEWAY_PROVIDER=mock is required for private-pilot in-app/synthetic notification handling.");
  }
}

function carePointRuntimeFeaturesWithoutAssertion(env: NodeJS.ProcessEnv): CarePointRuntimeFeatures {
  const privatePilot = booleanFlag(env.CAREPOINT_PRIVATE_PILOT, "CAREPOINT_PRIVATE_PILOT", false);
  const defaults = !privatePilot;
  return {
    privatePilot,
    patientSelfRegistration: booleanFlag(env.CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED, "CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED", defaults),
    payments: booleanFlag(env.CAREPOINT_PAYMENTS_ENABLED, "CAREPOINT_PAYMENTS_ENABLED", defaults),
    telehealth: booleanFlag(env.CAREPOINT_TELEHEALTH_ENABLED, "CAREPOINT_TELEHEALTH_ENABLED", defaults),
    externalNotifications: booleanFlag(env.CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED, "CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED", defaults),
  };
}

function booleanFlag(value: string | undefined, name: string, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
