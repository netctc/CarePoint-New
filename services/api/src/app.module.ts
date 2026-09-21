import { Module } from "@nestjs/common";
import { ObservabilityModule } from "./infrastructure/observability/observability.module";
import { PilotStructuredObservabilityModule } from "./infrastructure/observability/pilot-structured-observability.module";
import { RedisSecurityModule } from "./infrastructure/redis/redis-security.module";
import { ExternalSecretsModule } from "./infrastructure/secrets/external-secrets.module";
import { SiemExportModule } from "./infrastructure/siem/siem-export.module";
import { ApiSecurityModule } from "./security/api-security.module";
import { AdminAnalyticsModule } from "./modules/admin-analytics/admin-analytics.module";
import { AdminFinanceModule } from "./modules/admin-finance/admin-finance.module";
import { AdminOperationsModule } from "./modules/admin-operations/admin-operations.module";
import { AdminReschedulingModule } from "./modules/admin-rescheduling/admin-rescheduling.module";
import { AdminSecurityModule } from "./modules/admin-security/admin-security.module";
import { AdminTelehealthModule } from "./modules/admin-telehealth/admin-telehealth.module";
import { AppointmentContinuityModule } from "./modules/appointment-continuity/appointment-continuity.module";
import { AuditModule } from "./modules/audit/audit.module";
import { BillingModule } from "./modules/billing/billing.module";
import { ClaimsModule } from "./modules/claims/claims.module";
import { ClinicalModule } from "./modules/clinical/clinical.module";
import { ClinicalProfileModule } from "./modules/clinical-profile/clinical-profile.module";
import { CommunicationsModule } from "./modules/communications/communications.module";
import { ConsentModule } from "./modules/consent/consent.module";
import { ClinicalGovernanceModule } from "./modules/clinical-governance/clinical-governance.module";
import { DataGovernanceModule } from "./modules/data-governance/data-governance.module";
import { DependentsModule } from "./modules/dependents/dependents.module";
import { EmergencyContactsModule } from "./modules/emergency-contacts/emergency-contacts.module";
import { RefillModule } from "./modules/refill/refill.module";
import { ReferralsModule } from "./modules/referrals/referrals.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { DoctorSnapshotModule } from "./modules/doctor-snapshot/doctor-snapshot.module";
import { emergencyAmbulanceModuleEnabled } from "./modules/emergency/emergency-launch-policy";
import { EmergencyModule } from "./modules/emergency/emergency.module";
import { FhirModule } from "./modules/fhir/fhir.module";
import { HealthModule } from "./modules/health/health.module";
import { HealthProfileModule } from "./modules/health-profile/health-profile.module";
import { IamModule } from "./modules/iam/iam.module";
import { PatientHealthSummaryModule } from "./modules/patient-health-summary/patient-health-summary.module";
import { PatientProfileModule } from "./modules/patient-profile/patient-profile.module";
import { QuestionnaireModule } from "./modules/questionnaire/questionnaire.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { ObservationModule } from "./modules/observation/observation.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { OtherProviderWorkspaceModule } from "./modules/other-provider-workspace/other-provider-workspace.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { ProviderCategoryFormsModule } from "./modules/provider-category-forms/provider-category-forms.module";
import { ProviderWorkflowModule } from "./modules/provider-workflow/provider-workflow.module";
import { RpmAlertModule } from "./modules/rpm/rpm-alert.module";
import { SchedulingModule } from "./modules/scheduling/scheduling.module";
import { AvailabilityRequestsModule } from "./modules/scheduling/availability-requests.module";
import { SmartModule } from "./modules/smart/smart.module";
import { TelehealthModule } from "./modules/telehealth/telehealth.module";
import { TransportModule } from "./modules/transport/transport.module";
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
    HealthModule,
    AdminAnalyticsModule,
    ...(runtimeFeatures.payments ? [AdminFinanceModule] : []),
    AdminOperationsModule,
    AdminReschedulingModule,
    AdminSecurityModule,
    ...(runtimeFeatures.telehealth ? [AdminTelehealthModule] : []),
    AppointmentContinuityModule,
    RefillModule,
    ReferralsModule,
    DataGovernanceModule,
    DependentsModule,
    EmergencyContactsModule,
    ProvidersModule,
    ProviderCategoryFormsModule,
    ProviderWorkflowModule,
    OtherProviderWorkspaceModule,
    ...(emergencyAmbulanceModuleEnabled(process.env) ? [EmergencyModule] : []),
    TransportModule,
    IamModule,
    PatientProfileModule,
    HealthProfileModule,
    PatientHealthSummaryModule,
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
    RpmAlertModule,
    ClinicalProfileModule,
    DoctorSnapshotModule,
    OrdersModule,
    DocumentsModule,
    ...(runtimeFeatures.payments ? [BillingModule, ClaimsModule] : []),
    CommunicationsModule,
    ...(!isolatedSyntheticPilot ? [SmartModule, FhirModule] : []),
  ],
})
export class AppModule {}
