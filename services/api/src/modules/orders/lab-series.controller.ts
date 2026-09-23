import { Controller, Get, Header, Param } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { LabSeriesService } from "./lab-series.service";

@Controller("provider/patients")
export class ProviderLabSeriesController {
  constructor(private readonly labSeries: LabSeriesService) {}

  @RequirePermissions("CLINICAL_ORDER_READ")
  @Get(":patientId/lab-series")
  @Header("Cache-Control", "no-store")
  series(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.labSeries.providerPatientSeries(principal, patientId);
  }
}
