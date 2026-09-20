import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import {
  ProviderCategoryFormsService,
  type CreateProviderCategoryFormInput,
  type CreateProviderCategoryFormVersionInput,
  type SubmitProviderCategoryFormInput,
} from "./provider-category-forms.service";

@Controller("admin/provider-category-forms")
class AdminProviderCategoryFormsController {
  constructor(private readonly forms: ProviderCategoryFormsService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get()
  list(@Query("categoryId") categoryId?: string) {
    return this.forms.adminList(categoryId);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateProviderCategoryFormInput,
  ) {
    return this.forms.createDefinition(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":formId/versions")
  version(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("formId") formId: string,
    @Body() body: CreateProviderCategoryFormVersionInput,
  ) {
    return this.forms.createVersion(principal, formId, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":formId/versions/:version/activate")
  activate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("formId") formId: string,
    @Param("version") version: string,
  ) {
    return this.forms.activateVersion(principal, formId, Number(version));
  }
}

@Controller("provider/category-forms")
class ProviderCategoryFormsController {
  constructor(private readonly forms: ProviderCategoryFormsService) {}

  @RequirePermissions("OTHER_PROVIDER_CATEGORY_FORMS")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.forms.listForProvider(principal);
  }

  @RequirePermissions("OTHER_PROVIDER_CATEGORY_FORMS")
  @Post(":code/responses")
  @Header("Cache-Control", "no-store")
  submit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("code") code: string,
    @Body() body: SubmitProviderCategoryFormInput,
  ) {
    return this.forms.submit(principal, code, body);
  }
}

@Module({
  imports: [ClinicalModule, ProvidersModule],
  controllers: [AdminProviderCategoryFormsController, ProviderCategoryFormsController],
  providers: [ProviderCategoryFormsService],
  exports: [ProviderCategoryFormsService],
})
export class ProviderCategoryFormsModule {}
