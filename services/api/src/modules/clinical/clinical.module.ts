import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalEnvelopeService } from "./clinical-envelope.service";
import { ClinicalService } from "./clinical.service";

@Controller("clinical")
class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get("timeline")
  timeline(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.clinical.patientTimeline(principal);
  }

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Get("patients/:patientId/timeline")
  providerTimeline(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.clinical.providerPatientTimeline(principal, patientId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD", "CLINICAL_RECORD_READ")
  @Get("appointments/:appointmentId")
  encounter(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.clinical.getEncounter(principal, appointmentId);
  }

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post("appointments/:appointmentId/records")
  write(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: any,
  ) {
    return this.clinical.writeRecord(principal, appointmentId, body);
  }

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post("appointments/:appointmentId/finalize")
  finalize(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.clinical.finalizeEncounter(principal, appointmentId);
  }
}

@Module({
  controllers: [ClinicalController],
  providers: [ClinicalService, ClinicalEnvelopeService],
  exports: [ClinicalService],
})
export class ClinicalModule {}
