import { Module } from "@nestjs/common";
import { ObservabilityModule } from "./infrastructure/observability/observability.module";
import { PilotStructuredObservabilityModule } from "./infrastructure/observability/pilot-structured-observability.module";
import { RedisSecurityModule } from "./infrastructure/redis/redis-security.module";
import { ExternalSecretsModule } from "./infrastructure/secrets/external-secrets.module";
import { SiemExportModule } from "./infrastructure/siem/siem-export.module";
import { ApiSecurityModule } from "./security/api-security.module";
import { AccessNeedsModule } from "./modules/access-needs/access-needs.module";
import { AdminAnalyticsModule } from "./modules/admin-analytics/admin-analytics.module";
import { AdminB6OperationsModule } from "./modules/admin-b6-operations/admin-b6-operations.module";
import { AdminQuestionnaireComplianceModule } from "./modules/admin-questionnaire-compliance/admin-questionnaire-compliance.module";
import { AdminFinanceModule } from "./modules/admin-finance/admin-finance.module";
import { AdminOperationsModule } from "./modules/admin-operations/admin-operations.module";
import { AdminPatientsModule } from "./modules/admin-patients/admin-patients.module";
import { AdminReschedulingModule } from "./modules/admin-rescheduling/admin-rescheduling.module";
import { AdminSecurityModule } from "./modules/admin-security/admin-security.module";
import { AdminTelehealthModule } from "./modules/admin-telehealth/admin-telehealth.module";
import { AppointmentContinuityModule } from "./modules/appointment-continuity/appointment-continuity.module";
import { AuditModule } from "./modules/audit/audit.module";
import { BillingModule } from "./modules/billing/billing.module";
import { ClaimsModule } from "./modules/claims/claims.module";
import { ClinicalHistoryModule } from "./modules/clinical-history/clinical-history.module";
import { ClinicalModule } from "./modules/clinical/clinical.module";
import { ClinicalProfileModule } from "./modules/clinical-profile/clinical-profile.module";
import { CommunicationsModule } from "./modules/communications/communications.module";
import { ConsentModule } from "./modules/consent/consent.module";
import { ClinicalGovernanceModule } from "./modules/clinical-governance/clinical-governance.module";
import { DataGovernanceModule } from "./modules/data-governance/data-governance.module";
import { DataQualityModule } from "./modules/data-quality/data-quality.module";
import { DependentsModule } from "./modules/dependents/dependents.module";
import { EmergencyAccessModule } from "./modules/emergency-access/emergency-access.module";
import { EmergencyContactsModule } from "./modules/emergency-contacts/emergency-contacts.module";
import { EncounterTemplatesModule } from "./modules/encounter-templates/encounter-templates.module";
import { CredentialExpiryModule } from "./modules/credential-expiry/credential-expiry.module";
import { MedicationReminderModule } from "./modules/medication-reminders/medication-reminders.module";
import { MedicalDeviceModule } from "./modules/medical-devices/medical-device.module";
import { PatientEducationModule } from "./modules/patient-education/patient-education.module";
import { AdverseEventReportModule } from "./modules/adverse-events/adverse-events.module";
import { RefillModule } from "./modules/refill/refill.module";
import { ReferralsModule } from "./modules/referrals/referrals.module";
import { SecondOpinionsModule } from "./modules/second-opinions/second-opinions.module";
import { RetentionModule } from "./modules/retention/retention.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { DictationModule } from "./modules/dictation/dictation.module";
import { DocumentVersioningModule } from "./modules/documents/document-versioning.module";
import { ClinicalMediaModule } from "./modules/documents/clinical-media.module";
import { DoctorSnapshotModule } from "./modules/doctor-snapshot/doctor-snapshot.module";
import { DoctorWorkQueueModule } from "./modules/doctor-work-queue/doctor-work-queue.module";
import { emergencyAmbulanceModuleEnabled } from "./modules/emergency/emergency-launch-policy";
import { EmergencyModule } from "./modules/emergency/emergency.module";
import { FeatureFlagsModule } from "./modules/feature-flags/feature-flags.module";
import { FoodDiaryModule } from "./modules/food-diary/food-diary.module";
import { FhirModule } from "./modules/fhir/fhir.module";
import { HealthModule } from "./modules/health/health.module";
import { HealthProfileModule } from "./modules/health-profile/health-profile.module";
import { IamModule } from "./modules/iam/iam.module";
import { LocalizationModule } from "./modules/localization/localization.module";
import { NutritionModule } from "./modules/nutrition/nutrition.module";
import { NutritionPlanModule } from "./modules/nutrition/nutrition-plan.module";
import { ProviderNursingWorkflowsModule } from "./modules/nursing/provider-nursing-workflows.module";
import { PatientClinicalExportModule } from "./modules/patient-clinical-export/patient-clinical-export.module";
import { PatientHealthSummaryModule } from "./modules/patient-health-summary/patient-health-summary.module";
import { PatientEmergencyCardModule } from "./modules/patient-emergency-card/patient-emergency-card.module";
import { PatientMergeModule } from "./modules/patient-merge/patient-merge.module";
import { PatientProfileModule } from "./modules/patient-profile/patient-profile.module";
import { PreventiveCareModule } from "./modules/preventive-care/preventive-care.module";
import { PhysiotherapyModule } from "./modules/physiotherapy/physiotherapy.module";
import { ProviderFieldMediaModule } from "./modules/provider-field-media/provider-field-media.module";
import { QuestionnaireModule } from "./modules/questionnaire/questionnaire.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { ObservationModule } from "./modules/observation/observation.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { OtherProviderWorkspaceModule } from "./modules/other-provider-workspace/other-provider-workspace.module";
import { ProviderFieldJobsModule } from "./modules/other-provider-workspace/provider-field-jobs.module";
import { ProviderFieldRouteModule } from "./modules/other-provider-workspace/provider-field-route.module";
import { ProviderWorkQueueModule } from "./modules/other-provider-workspace/provider-work-queue.module";
import { ProviderSuppliesModule } from "./modules/provider-supplies/provider-supplies.module";
import { ProviderFollowUpModule } from "./modules/provider-follow-up/provider-follow-up.module";
import { ProviderOfflineSyncModule } from "./modules/provider-offline-sync/provider-offline-sync.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { ProviderCategoryFormsModule } from "./modules/provider-category-forms/provider-category-forms.module";
import { ProviderWorkflowModule } from "./modules/provider-workflow/provider-workflow.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { RpmAlertModule } from "./modules/rpm/rpm-alert.module";
import { SchedulingModule } from "./modules/scheduling/scheduling.module";
import { AvailabilityRequestsModule } from "./modules/scheduling/availability-requests.module";
import { SmartModule } from "./modules/smart/smart.module";
import { SymptomReportModule } from "./modules/symptom-reports/symptom-report.module";
import { TelehealthModule } from "./modules/telehealth/telehealth.module";
import { TerminologyModule } from "./modules/terminology/terminology.module";
import { TransportModule } from "./modules/transport/transport.module";
import { TransportResourcesModule } from "./modules/transport/transport-resources.module";
import { TransportHandoffModule } from "./modules/transport/transport-handoff.module";
import { TransportIncidentsModule } from "./modules/transport/transport-incidents.module";
import { TransportAdvancedLifecycleModule } from "./modules/transport/transport-advanced-lifecycle.module";
import { isolatedSyntheticPrivatePilotActive } from "./infrastructure/release/private-pilot-infrastructure-profile";
import { carePointRuntimeFeatures } from "./infrastructure/release/private-pilot-policy";

const runtimeFeatures = carePointRuntimeFeatures(process.env);
const isolatedSyntheticPilot = isolatedSyntheticPrivatePilotActive(process.env);

@Module({
  imports: [
    ...(isolatedSyntheticPilot ? [PilotStructuredObservabilityModule] : [ObservabilityModule]),
    RedisSecurityModule,
    ExternalSecretsModule,
    SiemExportModule,
    ApiSecurityModule,
    FeatureFlagsModule,
    FoodDiaryModule,
    HealthModule,
    AccessNeedsModule,
    AdminAnalyticsModule,
    AdminB6OperationsModule,
    AdminQuestionnaireComplianceModule,
    ...(runtimeFeatures.payments ? [AdminFinanceModule] : []),
    AdminOperationsModule,
    AdminPatientsModule,
    AdminReschedulingModule,
    AdminSecurityModule,
    ...(runtimeFeatures.telehealth ? [AdminTelehealthModule] : []),
    AppointmentContinuityModule,
    RefillModule,
    ReferralsModule,
    SecondOpinionsModule,
    DataGovernanceModule,
    DataQualityModule,
    RetentionModule,
    EmergencyAccessModule,
    DependentsModule,
    EmergencyContactsModule,
    EncounterTemplatesModule,
    CredentialExpiryModule,
    MedicationReminderModule,
    MedicalDeviceModule,
    PatientEducationModule,
    AdverseEventReportModule,
    ProvidersModule,
    ProviderCategoryFormsModule,
    ProviderWorkflowModule,
    ProviderFollowUpModule,
    ProviderOfflineSyncModule,
    ProviderFieldMediaModule,
    OtherProviderWorkspaceModule,
    ProviderFieldJobsModule,
    ProviderFieldRouteModule,
    ProviderWorkQueueModule,
    ProviderSuppliesModule,
    ProviderNursingWorkflowsModule,
    PhysiotherapyModule,
    NutritionModule,
    NutritionPlanModule,
    ...(emergencyAmbulanceModuleEnabled(process.env) ? [EmergencyModule] : []),
    TransportModule,
    TransportResourcesModule,
    TransportHandoffModule,
    TransportIncidentsModule,
    TransportAdvancedLifecycleModule,
    IamModule,
    LocalizationModule,
    PatientProfileModule,
    PreventiveCareModule,
    PatientMergeModule,
    HealthProfileModule,
    PatientHealthSummaryModule,
    PatientEmergencyCardModule,
    PatientClinicalExportModule,
    QuestionnaireModule,
    ObservationModule,
    OnboardingModule,
    ConsentModule,
    ClinicalGovernanceModule,
    AuditModule,
    SchedulingModule,
    AvailabilityRequestsModule,
    ...(runtimeFeatures.telehealth ? [TelehealthModule] : []),
    ClinicalModule,
    ClinicalHistoryModule,
    RpmAlertModule,
    RealtimeModule,
    ClinicalProfileModule,
    SymptomReportModule,
    TerminologyModule,
    DoctorSnapshotModule,
    DoctorWorkQueueModule,
    OrdersModule,
    DocumentsModule,
    DictationModule,
    DocumentVersioningModule,
    ClinicalMediaModule,
    ...(runtimeFeatures.payments ? [BillingModule, ClaimsModule] : []),
    CommunicationsModule,
    ...(!isolatedSyntheticPilot ? [SmartModule, FhirModule] : []),
  ],
})
export class AppModule {}
