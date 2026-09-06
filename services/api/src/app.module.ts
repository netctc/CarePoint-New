import { Module } from "@nestjs/common";
import { EmergencyModule } from "./modules/emergency/emergency.module";
import { HealthModule } from "./modules/health/health.module";
import { ProvidersModule } from "./modules/providers/providers.module";

@Module({
  imports: [HealthModule, ProvidersModule, EmergencyModule],
})
export class AppModule {}
