import { Module } from "@nestjs/common";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import { NutritionPlanController } from "./nutrition-plan.controller";
import { NutritionPlanService } from "./nutrition-plan.service";

@Module({
  imports: [ProvidersModule, ClinicalModule],
  controllers: [NutritionPlanController],
  providers: [NutritionPlanService],
})
export class NutritionPlanModule {}
