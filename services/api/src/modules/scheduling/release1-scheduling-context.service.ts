import { Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Release1AvailabilityPolicyService } from "./release1-availability-policy.service";
import { Release1ContextualBookingService } from "./release1-contextual-booking.service";
import { Release1LocationDiscoveryService } from "./release1-location-discovery.service";
import type {
  AvailabilityExceptionInput,
  DiscoveryInput,
  ProviderLocationInput,
  Release1AvailabilityRuleInput,
  Release1BookingInput,
  Release1DeliveryContextInput,
  Release1ServiceModalityInput,
} from "./release1-scheduling-context.types";

@Injectable()
export class Release1SchedulingContextService {
  constructor(
    private readonly locationDiscovery: Release1LocationDiscoveryService,
    private readonly availabilityPolicy: Release1AvailabilityPolicyService,
    private readonly contextualBooking: Release1ContextualBookingService,
  ) {}

  listProviderLocations(principal: AuthPrincipal) { return this.locationDiscovery.listProviderLocations(principal); }
  createProviderLocation(principal: AuthPrincipal, input: ProviderLocationInput) { return this.locationDiscovery.createProviderLocation(principal, input); }
  setProviderLocationActive(principal: AuthPrincipal, locationId: string, active: boolean) { return this.locationDiscovery.setProviderLocationActive(principal, locationId, active); }
  validateServiceContexts(principal: AuthPrincipal, modalities: readonly Release1ServiceModalityInput[]) { return this.locationDiscovery.validateServiceContexts(principal, modalities); }
  configureServiceContexts(principal: AuthPrincipal, serviceId: string, modalities: readonly Release1ServiceModalityInput[]) { return this.locationDiscovery.configureServiceContexts(principal, serviceId, modalities); }
  configureSingleServiceContext(principal: AuthPrincipal, serviceId: string, modality: string, input: Release1DeliveryContextInput) { return this.locationDiscovery.configureSingleServiceContext(principal, serviceId, modality, input); }
  listProviderServices(principal: AuthPrincipal) { return this.locationDiscovery.listProviderServices(principal); }
  legacySearch(input: { q?: string; modality?: string }) { return this.locationDiscovery.legacySearch(input); }
  discovery(input: DiscoveryInput) { return this.locationDiscovery.discovery(input); }

  validateAvailabilityRulePolicy(principal: AuthPrincipal, input: Release1AvailabilityRuleInput) { return this.availabilityPolicy.validateAvailabilityRulePolicy(principal, input); }
  saveAvailabilityRulePolicy(principal: AuthPrincipal, ruleId: string, input: Release1AvailabilityRuleInput) { return this.availabilityPolicy.saveAvailabilityRulePolicy(principal, ruleId, input); }
  listAvailabilityRules(principal: AuthPrincipal) { return this.availabilityPolicy.listAvailabilityRules(principal); }
  createAvailabilityException(principal: AuthPrincipal, input: AvailabilityExceptionInput) { return this.availabilityPolicy.createAvailabilityException(principal, input); }
  listAvailabilityExceptions(principal: AuthPrincipal) { return this.availabilityPolicy.listAvailabilityExceptions(principal); }
  setAvailabilityExceptionActive(principal: AuthPrincipal, exceptionId: string, active: boolean) { return this.availabilityPolicy.setAvailabilityExceptionActive(principal, exceptionId, active); }
  generateAvailability(principal: AuthPrincipal, input: { fromDate: string; toDate: string; ruleId?: string }) { return this.availabilityPolicy.generateAvailability(principal, input); }
  unblockSlot(principal: AuthPrincipal, slotId: string) { return this.availabilityPolicy.unblockSlot(principal, slotId); }

  book(principal: AuthPrincipal, input: Release1BookingInput) { return this.contextualBooking.book(principal, input); }
  listPatientAppointments(principal: AuthPrincipal) { return this.contextualBooking.listPatientAppointments(principal); }
  listProviderAppointments(principal: AuthPrincipal, input: { from?: string; to?: string }) { return this.contextualBooking.listProviderAppointments(principal, input); }
}

export type {
  AvailabilityExceptionInput,
  DiscoveryInput,
  ProviderLocationInput,
  Release1AvailabilityRuleInput,
  Release1BookingInput,
  Release1DeliveryContextInput,
  Release1ServiceModalityInput,
} from "./release1-scheduling-context.types";
