import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { CommunicationsModule } from "../communications/communications.module";
import { QuestionnaireTriggerService, type CreateQuestionnaireTriggerRuleInput, type CreateQuestionnaireTriggerVersionInput, type ManualQuestionnaireTriggerInput, type SimulateQuestionnaireTriggerInput } from "./questionnaire-trigger.service";

@Controller("admin/questionnaire-triggers")
class AdminQuestionnaireTriggerController {
  constructor(private readonly triggers: QuestionnaireTriggerService) {}
  @RequirePermissions("CATALOG_MANAGE") @Get() @Header("Cache-Control","no-store") list(){return this.triggers.adminList();}
  @RequirePermissions("CATALOG_MANAGE") @Post() @Header("Cache-Control","no-store") create(@CurrentPrincipal() p:AuthPrincipal,@Body() b:CreateQuestionnaireTriggerRuleInput){return this.triggers.createRule(p,b);}
  @RequirePermissions("CATALOG_MANAGE") @Post(":ruleId/versions") @Header("Cache-Control","no-store") version(@CurrentPrincipal() p:AuthPrincipal,@Param("ruleId") id:string,@Body() b:CreateQuestionnaireTriggerVersionInput){return this.triggers.createVersion(p,id,b);}
  @RequirePermissions("CATALOG_MANAGE") @Post(":ruleId/versions/:version/simulate") @Header("Cache-Control","no-store") simulate(@CurrentPrincipal() p:AuthPrincipal,@Param("ruleId") id:string,@Param("version") v:string,@Body() b:SimulateQuestionnaireTriggerInput){return this.triggers.simulate(p,id,v,b);}
  @RequirePermissions("CATALOG_MANAGE") @Post(":ruleId/versions/:version/activate") @Header("Cache-Control","no-store") activate(@CurrentPrincipal() p:AuthPrincipal,@Param("ruleId") id:string,@Param("version") v:string){return this.triggers.activate(p,id,v);}
  @RequirePermissions("CATALOG_MANAGE") @Post(":ruleId/versions/:version/manual-dispatch") @Header("Cache-Control","no-store") manual(@CurrentPrincipal() p:AuthPrincipal,@Param("ruleId") id:string,@Param("version") v:string,@Body() b:ManualQuestionnaireTriggerInput){return this.triggers.manualDispatch(p,id,v,b);}
}
@Module({imports:[CommunicationsModule],controllers:[AdminQuestionnaireTriggerController],providers:[QuestionnaireTriggerService],exports:[QuestionnaireTriggerService]})
export class QuestionnaireTriggersModule {}
