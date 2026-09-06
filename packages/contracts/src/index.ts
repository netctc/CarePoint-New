export const SupportedLocales = ["en", "ar", "fr", "es"] as const;
export type SupportedLocale = (typeof SupportedLocales)[number];

export interface LocalizedText {
  en: string;
  ar: string;
  fr: string;
  es: string;
}

export function localizedText(value: LocalizedText, locale: SupportedLocale): string {
  return value[locale] || value.en;
}

export const UserRoles = ["PATIENT", "DOCTOR", "OTHER_PROVIDER", "ADMIN", "SUPPORT"] as const;
export type UserRole = (typeof UserRoles)[number];

export const ProviderClasses = ["DOCTOR", "OTHER_PROVIDER"] as const;
export type ProviderClass = (typeof ProviderClasses)[number];

export const OtherProviderFamilies = ["NON_DOCTOR_HEALTHCARE", "MEDICAL_TRANSPORT_GROUND", "MEDICAL_TRANSPORT_AIR", "EMERGENCY_AMBULANCE"] as const;
export type OtherProviderFamily = (typeof OtherProviderFamilies)[number];

export const AppointmentModalities = ["CLINIC", "TELEMEDICINE", "HOME_VISIT"] as const;
export type AppointmentModality = (typeof AppointmentModalities)[number];

export const AppointmentStatuses = ["REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const;
export type AppointmentStatus = (typeof AppointmentStatuses)[number];

export const EmergencyAmbulanceStatuses = ["REQUESTED", "DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING", "COMPLETED", "CANCELLED"] as const;
export type EmergencyAmbulanceStatus = (typeof EmergencyAmbulanceStatuses)[number];

export interface MedicalSpecialty { id: string; code: string; labels: LocalizedText; parentId: string | null; active: boolean; }
export interface OtherProviderCategory { id: string; slug: string; labels: LocalizedText; family: OtherProviderFamily; active: boolean; requiredCredentialTypes: readonly string[]; enabledModalities: readonly AppointmentModality[]; }

export interface CreateEmergencyAmbulanceRequestInput { patientId: string; latitude: number; longitude: number; pickupAddress?: string; callbackPhone?: string; note?: string; }
export interface EmergencyAmbulanceRequest { id: string; patientId: string; status: EmergencyAmbulanceStatus; latitude: number; longitude: number; pickupAddress: string | null; callbackPhone: string | null; note: string | null; assignedProviderId: string | null; etaMinutes: number | null; requestedAt: string; updatedAt: string; }

export function assertDoctorRole(role: UserRole): asserts role is "DOCTOR" { if (role !== "DOCTOR") throw new Error("Doctor application access is restricted to doctors."); }
export function assertOtherProviderFamily(value: string): asserts value is OtherProviderFamily { if (!(OtherProviderFamilies as readonly string[]).includes(value)) throw new Error(`Unsupported other-provider family: ${value}`); }
export function assertValidEmergencyLocation(latitude: number, longitude: number): void { if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error("Latitude must be between -90 and 90."); if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("Longitude must be between -180 and 180."); }
