import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  PatientMergeService,
  type ExecutePatientMergeInput,
  type PreviewPatientMergeInput,
} from "./patient-merge.service";

@Controller("admin/patients")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class PatientMergeController {
  constructor(private readonly patientMerge: PatientMergeService) {}

  @Post("merge/preview")
  @Header("Cache-Control", "no-store")
  preview(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: PreviewPatientMergeInput) {
    return this.patientMerge.preview(principal, body);
  }

  @Get("merge/:jobId")
  @Header("Cache-Control", "no-store")
  getJob(@Param("jobId") jobId: string) {
    return this.patientMerge.getJob(jobId);
  }

  @Post("merge/:jobId/execute")
  @Header("Cache-Control", "no-store")
  execute(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
    @Body() body: ExecutePatientMergeInput,
  ) {
    return this.patientMerge.execute(principal, jobId, body);
  }

  @Get("resolve/:patientId")
  @Header("Cache-Control", "no-store")
  resolve(@Param("patientId") patientId: string) {
    return this.patientMerge.resolve(patientId);
  }
}

@Module({
  controllers: [PatientMergeController],
  providers: [PatientMergeService],
  exports: [PatientMergeService],
})
export class PatientMergeModule {}
