import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import {
  LocalizationService,
  type CreateTranslationKeyInput,
  type LocalizationBundleQuery,
  type PublishTranslationVersionInput,
} from "./localization.service";

@Controller("localization")
class LocalizationController {
  constructor(private readonly localization: LocalizationService) {}

  @Public()
  @Get()
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  bundle(@Query() query: LocalizationBundleQuery) {
    return this.localization.bundle(query);
  }
}

@Controller("admin/localization")
@RequirePermissions("CATALOG_MANAGE")
class LocalizationAdminController {
  constructor(private readonly localization: LocalizationService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list() {
    return this.localization.listAdmin();
  }

  @Post("keys")
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateTranslationKeyInput) {
    return this.localization.create(principal, body);
  }

  @Post("keys/:translationKeyId/versions")
  @Header("Cache-Control", "no-store")
  publish(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("translationKeyId") translationKeyId: string,
    @Body() body: PublishTranslationVersionInput,
  ) {
    return this.localization.publish(principal, translationKeyId, body);
  }
}

@Module({
  controllers: [LocalizationController, LocalizationAdminController],
  providers: [LocalizationService],
  exports: [LocalizationService],
})
export class LocalizationModule {}
