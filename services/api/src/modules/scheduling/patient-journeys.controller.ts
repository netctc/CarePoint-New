import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PatientJourneysService } from "./patient-journeys.service";

@Controller("patient-journeys")
export class PatientJourneysController {
  constructor(private readonly journeys: PatientJourneysService) {}
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Get("appointments/:appointmentId/reschedule-options")
  options(@CurrentPrincipal() p: AuthPrincipal, @Param("appointmentId") id: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.journeys.options(p, id, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Post("appointments/:appointmentId/reschedule")
  reschedule(@CurrentPrincipal() p: AuthPrincipal, @Param("appointmentId") id: string, @Body() body: { slotId?: unknown; expectedUpdatedAt?: unknown; idempotencyKey?: unknown; waitlistEntryId?: unknown }) { return this.journeys.reschedule(p, id, body ?? {}); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Get("appointments/:appointmentId/history")
  history(@CurrentPrincipal() p: AuthPrincipal, @Param("appointmentId") id: string) { return this.journeys.history(p, id); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Post("appointments/:appointmentId/waitlist")
  join(@CurrentPrincipal() p: AuthPrincipal, @Param("appointmentId") id: string, @Body() body: { from?: unknown; to?: unknown; expectedUpdatedAt?: unknown }) { return this.journeys.joinWaitlist(p, id, body ?? {}); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Get("waitlist")
  list(@CurrentPrincipal() p: AuthPrincipal) { return this.journeys.waitlist(p); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Post("waitlist/:entryId/withdraw")
  withdraw(@CurrentPrincipal() p: AuthPrincipal, @Param("entryId") id: string) { return this.journeys.withdraw(p, id); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Get("waitlist/:entryId/matches")
  matches(@CurrentPrincipal() p: AuthPrincipal, @Param("entryId") id: string) { return this.journeys.matches(p, id); }
}
@Controller("provider/waitlist")
export class ProviderWaitlistController {
  constructor(private readonly journeys: PatientJourneysService) {}
  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY") @Get()
  demand(@CurrentPrincipal() p: AuthPrincipal) { return this.journeys.providerDemand(p); }
}
