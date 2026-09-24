import { Body, Controller, Get, Header, Module, Param, Patch, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { QuestionnaireTriggersModule } from "../questionnaire-triggers/questionnaire-triggers.module";
import { QuestionnaireReviewService } from "./questionnaire-review.service";
import {
  QuestionnaireService,
  type ConfirmQuestionnaireNoChangesInput,
  type CreateQuestionnaireInput,
  type CreateQuestionnaireVersionInput,
  type SubmitQuestionnaireInput,
} from "./questionnaire.service";

@Controller("admin/questionnaires")
class AdminQuestionnaireController {
  constructor(private readonly questionnaires: QuestionnaireService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get()
  list() {
    return this.questionnaires.adminList();
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateQuestionnaireInput,
  ) {
    return this.questionnaires.createDefinition(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":questionnaireId/versions")
  createVersion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("questionnaireId") questionnaireId: string,
    @Body() body: CreateQuestionnaireVersionInput,
  ) {
    return this.questionnaires.createVersion(principal, questionnaireId, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":questionnaireId/versions/:version/activate")
  activate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("questionnaireId") questionnaireId: string,
    @Param("version") version: string,
  ) {
    return this.questionnaires.activateVersion(principal, questionnaireId, Number(version));
  }
}

@Controller("patient/questionnaires")
class PatientQuestionnaireController {
  constructor(private readonly questionnaires: QuestionnaireService) {}

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Get("due")
  @Header("Cache-Control", "no-store")
  due(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.questionnaires.dueMine(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Get("status")
  @Header("Cache-Control", "no-store")
  status(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.questionnaires.statusMine(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Post(":code/confirm-no-changes")
  @Header("Cache-Control", "no-store")
  confirmNoChanges(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("code") code: string,
    @Body() body: ConfirmQuestionnaireNoChangesInput,
  ) {
    return this.questionnaires.confirmNoChangesMine(principal, code, body);
  }

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Post(":code/responses")
  @Header("Cache-Control", "no-store")
  submit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("code") code: string,
    @Body() body: SubmitQuestionnaireInput,
  ) {
    return this.questionnaires.submitMine(principal, code, body);
  }

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Get(":code/latest")
  @Header("Cache-Control", "no-store")
  latest(@CurrentPrincipal() principal: AuthPrincipal, @Param("code") code: string) {
    return this.questionnaires.latestMine(principal, code);
  }

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Get(":code/diff")
  @Header("Cache-Control", "no-store")
  diff(@CurrentPrincipal() principal: AuthPrincipal, @Param("code") code: string) {
    return this.questionnaires.diffMine(principal, code);
  }
}


@Controller("patient/social-history")
class PatientSocialHistoryController {
  constructor(private readonly questionnaires: QuestionnaireService) {}

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Get()
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.questionnaires.socialHistoryMine(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_QUESTIONNAIRE")
  @Patch()
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: SubmitQuestionnaireInput,
  ) {
    return this.questionnaires.updateSocialHistoryMine(principal, body);
  }
}

@Controller("doctor/patients")
class DoctorQuestionnaireController {
  constructor(
    private readonly questionnaires: QuestionnaireService,
    private readonly reviews: QuestionnaireReviewService,
  ) {}

  @RequirePermissions("CLINICAL_QUESTIONNAIRE_READ")
  @Get(":patientId/questionnaires/:code/latest")
  @Header("Cache-Control", "no-store")
  latest(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("code") code: string,
  ) {
    return this.questionnaires.latestForDoctor(principal, patientId, code);
  }

  @RequirePermissions("CLINICAL_QUESTIONNAIRE_READ")
  @Get(":patientId/questionnaires/:code/diff")
  @Header("Cache-Control", "no-store")
  diff(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("code") code: string,
  ) {
    return this.questionnaires.diffForDoctor(principal, patientId, code);
  }

  @RequirePermissions("CLINICAL_QUESTIONNAIRE_READ")
  @Get(":patientId/questionnaires/:code/responses/:responseId/review")
  @Header("Cache-Control", "no-store")
  reviewStatus(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("code") code: string,
    @Param("responseId") responseId: string,
  ) {
    return this.reviews.statusForDoctor(principal, patientId, code, responseId);
  }

  @RequirePermissions("CLINICAL_QUESTIONNAIRE_READ")
  @Post(":patientId/questionnaires/:code/responses/:responseId/review")
  @Header("Cache-Control", "no-store")
  markReviewed(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("code") code: string,
    @Param("responseId") responseId: string,
  ) {
    return this.reviews.markReviewedForDoctor(principal, patientId, code, responseId);
  }
}

@Module({
  imports: [ClinicalModule, QuestionnaireTriggersModule],
  controllers: [
    AdminQuestionnaireController,
    PatientQuestionnaireController,
    PatientSocialHistoryController,
    DoctorQuestionnaireController,
  ],
  providers: [QuestionnaireService, QuestionnaireReviewService],
  exports: [QuestionnaireService, QuestionnaireReviewService],
})
export class QuestionnaireModule {}
