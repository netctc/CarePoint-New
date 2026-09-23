import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import {
  ObservationService,
  type CreateConversionInput,
  type CreateMetricInput,
  type CreateMetricVersionInput,
  type CreateObservationInput,
  type CreateUnitInput,
} from "./observation.service";
import { ObservationTrendService } from "./observation-trend.service";
import { ProviderObservationService } from "./provider-observation.service";

@Controller("admin/clinical-metrics")
class AdminClinicalMetricController {
  constructor(private readonly observations: ObservationService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get()
  catalog() {
    return this.observations.adminCatalog();
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("units")
  unit(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateUnitInput) {
    return this.observations.createUnit(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("unit-conversions")
  conversion(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateConversionInput) {
    return this.observations.createConversion(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  metric(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateMetricInput) {
    return this.observations.createMetric(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":metricId/versions")
  version(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("metricId") metricId: string,
    @Body() body: CreateMetricVersionInput,
  ) {
    return this.observations.createMetricVersion(principal, metricId, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":metricId/versions/:version/activate")
  activate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("metricId") metricId: string,
    @Param("version") version: string,
  ) {
    return this.observations.activateMetricVersion(principal, metricId, Number(version));
  }
}

@Controller("patient/observations")
class PatientObservationController {
  constructor(
    private readonly observations: ObservationService,
    private readonly trends: ObservationTrendService,
  ) {}

  @RequirePermissions("PATIENT_MANAGE_OBSERVATIONS")
  @Get("catalog")
  @Header("Cache-Control", "no-store")
  catalog(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.observations.patientCatalog(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_OBSERVATIONS")
  @Post()
  @Header("Cache-Control", "no-store")
  record(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateObservationInput) {
    return this.observations.recordMine(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_OBSERVATIONS")
  @Get("stats")
  @Header("Cache-Control", "no-store")
  stats(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("code") code: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.trends.patientStats(principal, code, from, to);
  }

  @RequirePermissions("PATIENT_MANAGE_OBSERVATIONS")
  @Get("history")
  @Header("Cache-Control", "no-store")
  history(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("code") code: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    return this.observations.historyMine(
      principal,
      code,
      from,
      to,
      limit === undefined ? undefined : Number(limit),
    );
  }
}

@Controller("doctor/patients")
class DoctorObservationController {
  constructor(private readonly observations: ObservationService) {}

  @RequirePermissions("CLINICAL_OBSERVATION_READ")
  @Get(":patientId/observations")
  @Header("Cache-Control", "no-store")
  history(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("code") code: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    return this.observations.historyForDoctor(
      principal,
      patientId,
      code,
      from,
      to,
      limit === undefined ? undefined : Number(limit),
    );
  }
}

@Controller("provider/patients")
class ProviderObservationController {
  constructor(
    private readonly observations: ProviderObservationService,
    private readonly trends: ObservationTrendService,
  ) {}

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post(":patientId/observations")
  @Header("Cache-Control", "no-store")
  record(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.observations.record(principal, patientId, body);
  }

  @RequirePermissions("CLINICAL_OBSERVATION_READ")
  @Get(":patientId/observations/trends")
  @Header("Cache-Control", "no-store")
  trend(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("code") code: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("sourceType") sourceType?: string,
  ) {
    return this.trends.providerTrend(principal, patientId, code, from, to, sourceType);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [
    AdminClinicalMetricController,
    PatientObservationController,
    DoctorObservationController,
    ProviderObservationController,
  ],
  providers: [ObservationService, ProviderObservationService, ObservationTrendService],
  exports: [ObservationService, ProviderObservationService, ObservationTrendService],
})
export class ObservationModule {}
