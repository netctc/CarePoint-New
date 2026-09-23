import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import { HomeExercisePlanController } from "./home-exercise-plan.controller";
import { HomeExercisePlanService } from "./home-exercise-plan.service";
import { PhysioSourceEvidenceController } from "./physio-source-evidence.controller";
import { PhysioSourceEvidenceService } from "./physio-source-evidence.service";
import { PhysiotherapyService } from "./physiotherapy.service";

@Controller("provider/physio-assessments")
class PhysioAssessmentController {
  constructor(private readonly physiotherapy: PhysiotherapyService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.physiotherapy.createAssessment(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  history(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("scaleCode") scaleCode?: string,
  ) {
    return this.physiotherapy.assessmentHistory(principal, patientId, scaleCode);
  }
}

@Controller("provider/range-of-motion")
class RangeOfMotionController {
  constructor(private readonly physiotherapy: PhysiotherapyService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.physiotherapy.recordRangeOfMotion(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  history(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("jointCode") jointCode?: string,
    @Query("movementCode") movementCode?: string,
    @Query("side") side?: string,
  ) {
    const filters = {
      ...(jointCode === undefined ? {} : { jointCode }),
      ...(movementCode === undefined ? {} : { movementCode }),
      ...(side === undefined ? {} : { side }),
    };
    return this.physiotherapy.rangeOfMotionHistory(principal, patientId, filters);
  }
}

@Module({
  imports: [ProvidersModule, ClinicalModule],
  controllers: [
    PhysioAssessmentController,
    RangeOfMotionController,
    PhysioSourceEvidenceController,
    HomeExercisePlanController,
  ],
  providers: [PhysiotherapyService, PhysioSourceEvidenceService, HomeExercisePlanService],
})
export class PhysiotherapyModule {}
