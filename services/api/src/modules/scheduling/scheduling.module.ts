import { Body, Controller, Get, Module, Param, Patch, Post, Query } from "@nestjs/common";
import type { CreateProviderServiceInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import { ProvidersModule } from "../providers/providers.module";
import {
  Release1SchedulingContextService,
  type AvailabilityExceptionInput,
  type DiscoveryInput,
  type ProviderLocationInput,
  type Release1AvailabilityRuleInput,
  type Release1BookingInput,
  type Release1DeliveryContextInput,
  type Release1ServiceModalityInput,
} from "./release1-scheduling-context.service";
import { SchedulingService } from "./scheduling.service";

type Release1CreateProviderServiceInput = Omit<CreateProviderServiceInput, "modalities"> & {
  modalities: Release1ServiceModalityInput[];
};

@Controller("provider/locations")
class ProviderLocationsController {
  constructor(private readonly release1: Release1SchedulingContextService) {}

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.release1.listProviderLocations(principal);
  }

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: ProviderLocationInput) {
    return this.release1.createProviderLocation(principal, body);
  }

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Patch(":locationId/status")
  status(@CurrentPrincipal() principal: AuthPrincipal, @Param("locationId") locationId: string, @Body() body: { active?: boolean }) {
    return this.release1.setProviderLocationActive(principal, locationId, body.active === true);
  }
}

@Controller("provider/services")
class ProviderServicesController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly release1: Release1SchedulingContextService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.release1.listProviderServices(principal);
  }

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Release1CreateProviderServiceInput) {
    if (Array.isArray(body.modalities)) {
      await this.capabilities.assertServiceModalities(principal, body.modalities.map((item) => item.modality));
      await this.release1.validateServiceContexts(principal, body.modalities);
    }
    const created = await this.scheduling.createProviderService(principal, body);
    return this.release1.configureServiceContexts(principal, created.id, body.modalities ?? []);
  }

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Patch(":serviceId/status")
  async setStatus(@CurrentPrincipal() principal: AuthPrincipal, @Param("serviceId") serviceId: string, @Body() body: { active: boolean }) {
    const active = body.active === true;
    if (active) await this.capabilities.assertServiceActivation(principal, serviceId);
    return this.scheduling.setServiceActive(principal, serviceId, active);
  }

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Patch(":serviceId/delivery-context/:modality")
  configureDeliveryContext(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("serviceId") serviceId: string,
    @Param("modality") modality: string,
    @Body() body: Release1DeliveryContextInput,
  ) {
    return this.release1.configureSingleServiceContext(principal, serviceId, modality, body);
  }
}

@Controller("provider/availability")
class ProviderAvailabilityController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly release1: Release1SchedulingContextService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Get("rules")
  rules(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.release1.listAvailabilityRules(principal);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Post("rules")
  async createRule(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Release1AvailabilityRuleInput) {
    await this.capabilities.assertAvailabilityModality(principal, body.modality);
    await this.release1.validateAvailabilityRulePolicy(principal, body);
    const rule = await this.scheduling.createAvailabilityRule(principal, body);
    const policy = await this.release1.saveAvailabilityRulePolicy(principal, rule.id, body);
    return { ...rule, ...policy };
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Post("generate")
  async generate(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: { fromDate: string; toDate: string; ruleId?: string }) {
    await this.capabilities.assertAvailabilityGeneration(principal, body.ruleId);
    return this.release1.generateAvailability(principal, body);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Get("exceptions")
  exceptions(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.release1.listAvailabilityExceptions(principal);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Post("exceptions")
  createException(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: AvailabilityExceptionInput) {
    return this.release1.createAvailabilityException(principal, body);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Patch("exceptions/:exceptionId/status")
  exceptionStatus(@CurrentPrincipal() principal: AuthPrincipal, @Param("exceptionId") exceptionId: string, @Body() body: { active?: boolean }) {
    return this.release1.setAvailabilityExceptionActive(principal, exceptionId, body.active === true);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Post("slots/:slotId/block")
  block(@CurrentPrincipal() principal: AuthPrincipal, @Param("slotId") slotId: string) {
    return this.scheduling.blockSlot(principal, slotId);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Post("slots/:slotId/unblock")
  unblock(@CurrentPrincipal() principal: AuthPrincipal, @Param("slotId") slotId: string) {
    return this.release1.unblockSlot(principal, slotId);
  }
}

@Controller("provider/appointments")
class ProviderAppointmentsController {
  constructor(private readonly release1: Release1SchedulingContextService) {}

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("from") from?: string, @Query("to") to?: string) {
    return this.release1.listProviderAppointments(principal, {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }
}

@Controller("services")
class ServiceSearchController {
  constructor(private readonly release1: Release1SchedulingContextService) {}

  @Public()
  @Get("search")
  search(@Query("q") q?: string, @Query("modality") modality?: string) {
    return this.release1.legacySearch({
      ...(q ? { q } : {}),
      ...(modality ? { modality } : {}),
    });
  }

  @Public()
  @Get("discovery")
  discovery(
    @Query("q") q?: string,
    @Query("specialty") specialty?: string,
    @Query("providerClass") providerClass?: string,
    @Query("providerCategory") providerCategory?: string,
    @Query("service") service?: string,
    @Query("modality") modality?: string,
    @Query("location") location?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const input: DiscoveryInput = {
      ...(q ? { q } : {}),
      ...(specialty ? { specialty } : {}),
      ...(providerClass ? { providerClass } : {}),
      ...(providerCategory ? { providerCategory } : {}),
      ...(service ? { service } : {}),
      ...(modality ? { modality } : {}),
      ...(location ? { location } : {}),
      ...(page ? { page } : {}),
      ...(limit ? { limit } : {}),
    };
    return this.release1.discovery(input);
  }
}

@Controller("availability")
class AvailabilitySearchController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Public()
  @Get()
  search(
    @Query("serviceId") serviceId: string,
    @Query("modality") modality: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.scheduling.searchAvailability({
      serviceId,
      modality,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }
}

@Controller("bookings")
class BookingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly release1: Release1SchedulingContextService,
  ) {}

  @RequirePermissions("PATIENT_BOOK_APPOINTMENT")
  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Release1BookingInput) {
    return this.release1.book(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT")
  @Get("me")
  mine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.release1.listPatientAppointments(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT", "APPOINTMENT_OPERATE")
  @Post(":appointmentId/cancel")
  cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: { reason?: string }) {
    return this.scheduling.cancelAppointment(principal, appointmentId, body.reason);
  }
}

@Module({
  imports: [ProvidersModule],
  controllers: [
    ProviderLocationsController,
    ProviderServicesController,
    ProviderAvailabilityController,
    ProviderAppointmentsController,
    ServiceSearchController,
    AvailabilitySearchController,
    BookingController,
  ],
  providers: [SchedulingService, Release1SchedulingContextService],
})
export class SchedulingModule {}
