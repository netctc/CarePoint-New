import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { CommunicationsModule } from "../communications/communications.module";
import {
  QuestionnaireRequestsService,
  type CreateQuestionnaireRequestInput,
  type SubmitRequestedQuestionnaireInput,
} from "./questionnaire-requests.service";

@Controller("doctor/patients")
class DoctorQuestionnaireRequestsController {
  constructor(private readonly requests: QuestionnaireRequestsService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get(":patientId/questionnaire-requests/available")
  @Header("Cache-Control", "no-store")
  available(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("appointmentId") appointmentId: string,
  ) {
    return this.requests.available(principal, patientId, appointmentId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get(":patientId/questionnaire-requests")
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.requests.doctorList(principal, patientId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post(":patientId/questionnaire-requests")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateQuestionnaireRequestInput,
  ) {
    return this.requests.create(principal, patientId, body);
  }
}

@Controller("patient/questionnaire-requests")
class PatientQuestionnaireRequestsController {
  constructor(private readonly requests: QuestionnaireRequestsService) {}

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Get()
  @Header("Cache-Control", "no-store")
  due(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.requests.patientDue(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Post(":requestId/responses")
  @Header("Cache-Control", "no-store")
  submit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: SubmitRequestedQuestionnaireInput,
  ) {
    return this.requests.submit(principal, requestId, body);
  }
}

@Module({
  imports: [ClinicalModule, CommunicationsModule],
  controllers: [DoctorQuestionnaireRequestsController, PatientQuestionnaireRequestsController],
  providers: [QuestionnaireRequestsService],
})
export class QuestionnaireRequestsModule {}
