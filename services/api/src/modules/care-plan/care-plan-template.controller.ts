import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  CarePlanTemplateService,
  type CreateCarePlanTemplateInput,
  type CreateCarePlanTemplateVersionInput,
} from "./care-plan-template.service";

@Controller("admin/care-plan-templates")
export class AdminCarePlanTemplateController {
  constructor(private readonly templates: CarePlanTemplateService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get()
  list() {
    return this.templates.adminList();
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateCarePlanTemplateInput) {
    return this.templates.create(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":templateId/versions")
  version(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("templateId") templateId: string,
    @Body() body: CreateCarePlanTemplateVersionInput,
  ) {
    return this.templates.createVersion(principal, templateId, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":templateId/versions/:version/activate")
  activate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("templateId") templateId: string,
    @Param("version") version: string,
  ) {
    return this.templates.activate(principal, templateId, Number(version));
  }
}

@Controller("provider/care-plan-templates")
export class ProviderCarePlanTemplateController {
  constructor(private readonly templates: CarePlanTemplateService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get()
  list() {
    return this.templates.activeForClinician();
  }
}
