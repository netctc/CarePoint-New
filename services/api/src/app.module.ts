import { Module } from "@nestjs/common";
import { ApiSecurityModule } from "./security/api-security.module";
import { AuditModule } from "./modules/audit/audit.module";
import { BillingModule } from "./modules/billing/billing.module";
import { ClinicalModule } from "./modules/clinical/clinical.module";
import { ConsentModule } from "./modules/consent/consent.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { EmergencyModule } from "./modules/emergency/emergency.module";
import { HealthModule } from "./modules/health/health.module";
import { IamModule } from "./modules/iam/iam.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { SchedulingModule } from "./modules/scheduling/scheduling.module";
import { TelehealthModule } from "./modules/telehealth/telehealth.module";

@Module({
  imports: [
    ApiSecurityModule,
    HealthModule,
    ProvidersModule,
    EmergencyModule,
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
  ],
})
export class AppModule {}
