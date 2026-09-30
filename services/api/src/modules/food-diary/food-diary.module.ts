import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import { FoodDiaryService } from "./food-diary.service";

@Controller("patient/food-diary")
@RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
class PatientFoodDiaryController {
  constructor(private readonly diary: FoodDiaryService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.diary.patientList(principal);
  }

  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.diary.patientCreate(principal, body);
  }

  @Post(":entryId/share")
  @Header("Cache-Control", "no-store")
  share(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("entryId") entryId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.diary.patientSetSharing(principal, entryId, body);
  }
}

@Controller("provider/patients")
class ProviderFoodDiaryController {
  constructor(private readonly diary: FoodDiaryService) {}

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Get(":patientId/food-diary")
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("appointmentId") appointmentId: string,
  ) {
    return this.diary.providerList(principal, patientId, appointmentId);
  }
}

@Controller("provider/food-diary")
class ProviderFoodDiaryCommentController {
  constructor(private readonly diary: FoodDiaryService) {}

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post(":entryId/comments")
  @Header("Cache-Control", "no-store")
  comment(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("entryId") entryId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.diary.providerComment(principal, entryId, body);
  }
}

@Module({
  imports: [ClinicalModule, ProvidersModule],
  controllers: [PatientFoodDiaryController, ProviderFoodDiaryController, ProviderFoodDiaryCommentController],
  providers: [FoodDiaryService],
})
export class FoodDiaryModule {}
