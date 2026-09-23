import { Controller, Get, Header, Param } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PhysioSourceEvidenceService } from "./physio-source-evidence.service";

@Controller("provider/physio-assessments")
export class PhysioSourceEvidenceController {
  constructor(private readonly evidence: PhysioSourceEvidenceService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("appointments/:appointmentId/source-responses")
  @Header("Cache-Control", "no-store")
  eligible(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
  ) {
    return this.evidence.eligibleForAppointment(principal, appointmentId);
  }
}
