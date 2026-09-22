import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  PatientMergeService,
  type ExecutePatientMergeInput,
  type PreviewPatientMergeInput,
  type RollbackPatientMergeInput,
} from "./patient-merge.service";

@Controller("admin/patients/merge")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class PatientMergeController {
  constructor(private readonly patientMerge: PatientMergeService) {}

  @Post("preview")
  @Header("Cache-Control", "no-store")
  preview(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: PreviewPatientMergeInput) {
    return this.patientMerge.preview(principal, body);
  }

  @Post(":jobId/execute")
  @Header("Cache-Control", "no-store")
  execute(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
    @Body() body: ExecutePatientMergeInput,
  ) {
    return this.patientMerge.execute(principal, jobId, body);
  }

  @Post(":jobId/rollback")
  @Header("Cache-Control", "no-store")
  rollback(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
    @Body() body: RollbackPatientMergeInput,
  ) {
    return this.patientMerge.rollback(principal, jobId, body);
  }

  @Get(":jobId")
  @Header("Cache-Control", "no-store")
  job(@Param("jobId") jobId: string) {
    return this.patientMerge.getJob(jobId);
  }

  @Get("resolve/:patientId")
  @Header("Cache-Control", "no-store")
  resolve(@Param("patientId") patientId: string) {
    return this.patientMerge.resolvePatientId(patientId);
  }
}

@Module({
  controllers: [PatientMergeController],
  providers: [PatientMergeService],
  exports: [PatientMergeService],
})
export class PatientMergeModule {}
