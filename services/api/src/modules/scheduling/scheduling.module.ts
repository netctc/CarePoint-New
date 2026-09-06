import { Body, Controller, Get, Module, Param, Patch, Post, Query } from "@nestjs/common";
import type { CreateAvailabilityRuleInput, CreateBookingInput, CreateProviderServiceInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { SchedulingService } from "./scheduling.service";

@Controller("provider/services")
class ProviderServicesController {
  constructor(private readonly scheduling: SchedulingService) {}

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.scheduling.listProviderServices(principal);
  }

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateProviderServiceInput) {
    return this.scheduling.createProviderService(principal, body);
  }

  @RequirePermissions("PROVIDER_MANAGE_SERVICES")
  @Patch(":serviceId/status")
  setStatus(@CurrentPrincipal() principal: AuthPrincipal, @Param("serviceId") serviceId: string, @Body() body: { active: boolean }) {
    return this.scheduling.setServiceActive(principal, serviceId, body.active === true);
  }
}

@Controller("provider/availability")
class ProviderAvailabilityController {
  constructor(private readonly scheduling: SchedulingService) {}

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Get("rules")
  rules(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.scheduling.listAvailabilityRules(principal);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Post("rules")
  createRule(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateAvailabilityRuleInput) {
    return this.scheduling.createAvailabilityRule(principal, body);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Post("generate")
  generate(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: { fromDate: string; toDate: string; ruleId?: string }) {
    return this.scheduling.generateAvailability(principal, body);
  }

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Post("slots/:slotId/block")
  block(@CurrentPrincipal() principal: AuthPrincipal, @Param("slotId") slotId: string) {
    return this.scheduling.blockSlot(principal, slotId);
  }
}

@Controller("provider/appointments")
class ProviderAppointmentsController {
  constructor(private readonly scheduling: SchedulingService) {}

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("from") from?: string, @Query("to") to?: string) {
    return this.scheduling.listProviderAppointments(principal, { from, to });
  }
}

@Controller("services")
class ServiceSearchController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Public()
  @Get("search")
  search(@Query("q") q?: string, @Query("modality") modality?: string) {
    return this.scheduling.searchServices({ q, modality });
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
    return this.scheduling.searchAvailability({ serviceId, modality, from, to });
  }
}

@Controller("bookings")
class BookingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @RequirePermissions("PATIENT_BOOK_APPOINTMENT")
  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateBookingInput) {
    return this.scheduling.book(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT")
  @Get("me")
  mine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.scheduling.listPatientAppointments(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT", "APPOINTMENT_OPERATE")
  @Post(":appointmentId/cancel")
  cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: { reason?: string }) {
    return this.scheduling.cancelAppointment(principal, appointmentId, body.reason);
  }
}

@Module({
  controllers: [
    ProviderServicesController,
    ProviderAvailabilityController,
    ProviderAppointmentsController,
    ServiceSearchController,
    AvailabilitySearchController,
    BookingController,
  ],
  providers: [SchedulingService],
})
export class SchedulingModule {}
