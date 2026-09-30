import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { CommunicationsModule } from "../communications/communications.module";
import { DoctorSnapshotModule } from "../doctor-snapshot/doctor-snapshot.module";
import { ReferralsModule } from "../referrals/referrals.module";
import {
  SecondOpinionsService,
  type CreateSecondOpinionInput,
  type RespondSecondOpinionInput,
} from "./second-opinions.service";

@Controller("provider")
class ProviderSecondOpinionsController {
  constructor(private readonly secondOpinions: SecondOpinionsService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("patients/:patientId/second-opinions")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateSecondOpinionInput,
  ) {
    return this.secondOpinions.create(principal, patientId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("patients/:patientId/second-opinions")
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.secondOpinions.listForPatient(principal, patientId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("second-opinions/inbox")
  @Header("Cache-Control", "no-store")
  inbox(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.secondOpinions.inbox(principal);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("second-opinions/:requestId/respond")
  @Header("Cache-Control", "no-store")
  respond(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: RespondSecondOpinionInput,
  ) {
    return this.secondOpinions.respond(principal, requestId, body);
  }
}

@Module({
  imports: [ClinicalModule, DoctorSnapshotModule, ReferralsModule, CommunicationsModule],
  controllers: [ProviderSecondOpinionsController],
  providers: [SecondOpinionsService],
})
export class SecondOpinionsModule {}
