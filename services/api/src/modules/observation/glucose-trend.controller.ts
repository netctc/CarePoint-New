import { Controller, Get, Header, Param, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { GlucoseTrendService } from "./glucose-trend.service";

@Controller("provider/patients")
export class ProviderGlucoseTrendController {
  constructor(private readonly glucoseTrends: GlucoseTrendService) {}

  @RequirePermissions("CLINICAL_OBSERVATION_READ")
  @Get(":patientId/glucose-trends")
  @Header("Cache-Control", "no-store")
  trend(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("code") code?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("sourceType") sourceType?: string,
  ) {
    return this.glucoseTrends.providerTrend(principal, patientId, code, from, to, sourceType);
  }
}
