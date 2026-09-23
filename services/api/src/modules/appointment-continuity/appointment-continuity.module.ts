import { Body, Controller, Get, Header, Module, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { CommunicationsModule } from "../communications/communications.module";
import { DependentsModule } from "../dependents/dependents.module";
import {
  AppointmentContinuityService,
  type ConfigurePrepInput,
  type FollowUpInput,
  type DoctorQuestionnaireRequestInput,
  type QuestionnaireRequestInput,
  type SubmitRequestedQuestionnaireInput,
  type UpdatePrepTaskInput,
} from "./appointment-continuity.service";

@Controller("patient/appointments")
class PatientAppointmentPrepController {
  constructor(private readonly continuity: AppointmentContinuityService) {}

  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT")
  @Get(":appointmentId/prep")
  @Header("Cache-Control", "no-store")
  prep(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) { return this.continuity.patientPrep(principal, appointmentId); }

  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT")
  @Patch(":appointmentId/prep/:taskCode")
  @Header("Cache-Control", "no-store")
  update(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Param("taskCode") taskCode: string, @Body() body: UpdatePrepTaskInput) { return this.continuity.updatePatientPrep(principal, appointmentId, taskCode, body); }
}

@Controller("provider/appointments")
class ProviderAppointmentPrepController {
  constructor(private readonly continuity: AppointmentContinuityService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post(":appointmentId/prep/tasks")
  configure(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: ConfigurePrepInput) { return this.continuity.configurePrep(principal, appointmentId, body); }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get(":appointmentId/previsit-readiness")
  @Header("Cache-Control", "no-store")
  readiness(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) { return this.continuity.providerReadiness(principal, appointmentId); }
}

@Controller("provider/patients")
class ProviderQuestionnaireRequestController {
  constructor(private readonly continuity: AppointmentContinuityService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post(":patientId/questionnaire-requests")
  request(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string, @Body() body: QuestionnaireRequestInput) { return this.continuity.requestQuestionnaire(principal, patientId, body); }
}


@Controller("doctor/patients")
class DoctorRequestedQuestionnaireController {
  constructor(private readonly continuity: AppointmentContinuityService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get(":patientId/questionnaire-requests/available")
  @Header("Cache-Control", "no-store")
  available(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("appointmentId") appointmentId: string,
  ) {
    return this.continuity.availableQuestionnaires(principal, patientId, appointmentId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get(":patientId/questionnaire-requests")
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.continuity.doctorQuestionnaireRequests(principal, patientId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post(":patientId/questionnaire-requests")
  @Header("Cache-Control", "no-store")
  request(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: DoctorQuestionnaireRequestInput,
  ) {
    return this.continuity.requestQuestionnaireForVisit(principal, patientId, body);
  }
}

@Controller("patient/questionnaire-requests")
class PatientRequestedQuestionnaireController {
  constructor(private readonly continuity: AppointmentContinuityService) {}

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.continuity.patientQuestionnaireRequests(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Post(":requestId/responses")
  @Header("Cache-Control", "no-store")
  submit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: SubmitRequestedQuestionnaireInput,
  ) {
    return this.continuity.submitRequestedQuestionnaire(principal, requestId, body);
  }
}

@Controller("provider/encounters")
class ProviderFollowUpController {
  constructor(private readonly continuity: AppointmentContinuityService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post(":appointmentId/follow-up")
  @Header("Cache-Control", "no-store")
  followUp(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: FollowUpInput) { return this.continuity.createOrReviseFollowUp(principal, appointmentId, body); }
}

@Controller("patient/encounters")
class PatientFollowUpController {
  constructor(private readonly continuity: AppointmentContinuityService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get(":appointmentId/follow-up")
  @Header("Cache-Control", "no-store")
  followUp(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) { return this.continuity.patientFollowUp(principal, appointmentId); }
}

@Module({
  imports: [ClinicalModule, CommunicationsModule, DependentsModule],
  controllers: [
    PatientAppointmentPrepController,
    ProviderAppointmentPrepController,
    ProviderQuestionnaireRequestController,
    DoctorRequestedQuestionnaireController,
    PatientRequestedQuestionnaireController,
    ProviderFollowUpController,
    PatientFollowUpController,
  ],
  providers: [AppointmentContinuityService],
  exports: [AppointmentContinuityService],
})
export class AppointmentContinuityModule {}
