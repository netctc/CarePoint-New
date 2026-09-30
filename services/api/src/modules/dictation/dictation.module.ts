import { Body, Controller, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { DictationService, type CreateDictationJobInput } from "./dictation.service";

@Controller("provider/dictation/jobs")
class DictationController {
  constructor(private readonly dictation: DictationService) {}

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateDictationJobInput,
  ) {
    return this.dictation.create(principal, body);
  }

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post(":jobId/confirm")
  @Header("Cache-Control", "no-store")
  confirm(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
  ) {
    return this.dictation.confirm(principal, jobId);
  }

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post(":jobId/discard")
  @Header("Cache-Control", "no-store")
  discard(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
  ) {
    return this.dictation.discard(principal, jobId);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [DictationController],
  providers: [DictationService],
})
export class DictationModule {}
