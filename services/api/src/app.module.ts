import { Module } from "@nestjs/common";
import { ObservabilityModule } from "./infrastructure/observability/observability.module";
import { RedisSecurityModule } from "./infrastructure/redis/redis-security.module";
import { ApiSecurityModule } from "./security/api-security.module";
import { AuditModule } from "./modules/audit/audit.module";
import { BillingModule } from "./modules/billing/billing.module";
import { ClaimsModule } from "./modules/claims/claims.module";
import { ClinicalModule } from "./modules/clinical/clinical.module";
import { CommunicationsModule } from "./modules/communications/communications.module";
import { ConsentModule } from "./modules/consent/consent.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { EmergencyModule } from "./modules/emergency/emergency.module";
import { FhirModule } from "./modules/fhir/fhir.module";
import { HealthModule } from "./modules/health/health.module";
import { IamModule } from "./modules/iam/iam.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { SchedulingModule } from "./modules/scheduling/scheduling.module";
import { SmartModule } from "./modules/smart/smart.module";
import { TelehealthModule } from "./modules/telehealth/telehealth.module";
import { TransportModule } from "./modules/transport/transport.module";

@Module({
  imports: [
    ObservabilityModule,
    RedisSecurityModule,
    ApiSecurityModule,
    HealthModule,
    ProvidersModule,
    EmergencyModule,
    TransportModule,
    IamModule,
    OnboardingModule,
    ConsentModule,
    AuditModule,
    SchedulingModule,
    TelehealthModule,
    ClinicalModule,
    OrdersModule,
    DocumentsModule,
    BillingModule,
    ClaimsModule,
    CommunicationsModule,
    SmartModule,
    FhirModule,
  ],
})
export class AppModule {}
