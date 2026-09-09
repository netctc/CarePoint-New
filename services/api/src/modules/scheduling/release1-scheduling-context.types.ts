import type { AppointmentModality } from "@prisma/client";

export type HomeVisitCoverageInput = {
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
};

export type Release1ServiceModalityInput = {
  modality: AppointmentModality;
  durationMinutes: number;
  priceMinor: number;
  clinicLocationId?: string;
  clinicArrivalInstructions?: string;
  homeVisitCoverage?: HomeVisitCoverageInput;
};

export type Release1DeliveryContextInput = {
  clinicLocationId?: string;
  clinicArrivalInstructions?: string;
  homeVisitCoverage?: HomeVisitCoverageInput;
};

export type Release1AvailabilityRuleInput = {
  serviceId: string;
  modality: AppointmentModality;
  timezone: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  intervalMinutes: number;
  slotCapacity?: number;
  effectiveFrom: string;
  effectiveUntil?: string;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
};

export type ProviderLocationInput = {
  label?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  arrivalInstructions?: string;
  addressValidated?: boolean;
};

export type AvailabilityExceptionInput = {
  serviceId?: string;
  modality?: AppointmentModality;
  kind?: "UNAVAILABLE" | "VACATION";
  startsAt?: string;
  endsAt?: string;
  reason?: string;
};

export type HomeVisitBookingInput = {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  instructions?: string;
  contactPhone?: string;
  contactConfirmed?: boolean;
  addressValidated?: boolean;
};

export type Release1BookingInput = {
  slotId: string;
  idempotencyKey: string;
  homeVisit?: HomeVisitBookingInput;
};

export type DiscoveryInput = {
  q?: string;
  specialty?: string;
  providerClass?: string;
  providerCategory?: string;
  service?: string;
  modality?: string;
  location?: string;
  page?: string;
  limit?: string;
};
