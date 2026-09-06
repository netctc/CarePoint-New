import { Module } from "@nestjs/common";
import { IdentityCoreModule } from "./core/identity-core.module";
import { AuditModule } from "./modules/audit/audit.module";
import { ConsentModule } from "./modules/consent/consent.module";
import { EmergencyModule } from "./modules/emergency/emergency.module";
import { HealthModule } from "./modules/health/health.module";
import { IamModule } from "./modules/iam/iam.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { ProvidersModule } from "./modules/providers/providers.module";

@Module({
  imports: [IdentityCoreModule, HealthModule, ProvidersModule, EmergencyModule, IamModule, OnboardingModule, ConsentModule, AuditModule],
})
export class AppModule {}
