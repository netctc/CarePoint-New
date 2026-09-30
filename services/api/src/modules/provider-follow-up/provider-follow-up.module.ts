import { Module } from "@nestjs/common";
import { ClinicalModule } from "../clinical/clinical.module";
import { CommunicationsModule } from "../communications/communications.module";
import { ProvidersModule } from "../providers/providers.module";
import { PatientFollowUpController, ProviderFollowUpController } from "./provider-follow-up.controller";
import { ProviderFollowUpService } from "./provider-follow-up.service";

@Module({
  imports: [ProvidersModule, ClinicalModule, CommunicationsModule],
  controllers: [ProviderFollowUpController, PatientFollowUpController],
  providers: [ProviderFollowUpService],
})
export class ProviderFollowUpModule {}
