/**
 * CarePoint V2 shared design foundations.
 * Phase 0 declaration only: intentionally not wired into existing screens.
 */
export const carePointV2Colors = {
  surface: "#FAF8FF",
  canvas: "#F8FAFC",
  card: "#FFFFFF",
  surfaceLow: "#F2F3FF",
  surfaceHigh: "#E2E7FF",
  ink: "#131B2E",
  muted: "#6E7881",
  outline: "#D8E0EA",
  clinicalBlue: "#0EA5E9",
  clinicalBlueDeep: "#006591",
  neuralViolet: "#8B5CF6",
  cyanSignal: "#22D3EE",
  midnight: "#0F172A",
  careGreen: "#10B981",
  attention: "#F59E0B",
  safety: "#FB7185",
} as const;

export const carePointV2Spacing = { x1: 8, x2: 16, x3: 24, x4: 32, x5: 40, x6: 48 } as const;
export const carePointV2Radius = { control: 12, card: 22, overlay: 28 } as const;
export const carePointV2Modalities = ["CLINIC", "TELEMEDICINE", "HOME_VISIT", "TRANSPORT"] as const;
export type CarePointV2Modality = (typeof carePointV2Modalities)[number];
export const carePointV2Accessibility = {
  statusRequiresText: true,
  statusRequiresNonColorSignal: true,
  criticalDataUsesSolidSurface: true,
  rtlSupported: true,
} as const;
