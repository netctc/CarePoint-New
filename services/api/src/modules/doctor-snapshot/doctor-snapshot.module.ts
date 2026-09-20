import { Controller, Get, Header, Module, Param } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalProfileModule } from "../clinical-profile/clinical-profile.module";
import { HealthProfileModule } from "../health-profile/health-profile.module";
import { ObservationModule } from "../observation/observation.module";
import { QuestionnaireModule } from "../questionnaire/questionnaire.module";
import { DoctorSnapshotService } from "./doctor-snapshot.service";

@Controller("doctor/patients")
class DoctorSnapshotController {
  constructor(private readonly snapshot: DoctorSnapshotService) {}

  @RequirePermissions("CLINICAL_PATIENT_SNAPSHOT_READ")
  @Get(":patientId/snapshot")
  @Header("Cache-Control", "no-store")
  get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.snapshot.patientSnapshot(principal, patientId);
  }
}

@Module({
  imports: [
    HealthProfileModule,
    ClinicalProfileModule,
    QuestionnaireModule,
    ObservationModule,
  ],
  controllers: [DoctorSnapshotController],
  providers: [DoctorSnapshotService],
  exports: [DoctorSnapshotService],
})
export class DoctorSnapshotModule {}
