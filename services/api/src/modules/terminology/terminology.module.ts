import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  TerminologyService,
  type CreateCodingSystemInput,
  type CreateExternalMappingInput,
  type CreateTerminologyConceptInput,
  type PublishTerminologyConceptVersionInput,
  type TerminologySearchQuery,
} from "./terminology.service";

@Controller("terminology")
class TerminologyController {
  constructor(private readonly terminology: TerminologyService) {}

  @Get("search")
  @Header("Cache-Control", "private, max-age=60")
  search(@Query() query: TerminologySearchQuery) {
    return this.terminology.search(query);
  }

  @Get("map")
  @Header("Cache-Control", "private, max-age=60")
  map(
    @Query("sourceSystem") sourceSystem: string,
    @Query("code") code: string,
  ) {
    return this.terminology.map(sourceSystem, code);
  }
}

@Controller("admin/terminology")
class AdminTerminologyController {
  constructor(private readonly terminology: TerminologyService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get("systems")
  @Header("Cache-Control", "no-store")
  systems() {
    return this.terminology.listSystems();
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("systems")
  @Header("Cache-Control", "no-store")
  createSystem(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateCodingSystemInput,
  ) {
    return this.terminology.createSystem(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("concepts")
  @Header("Cache-Control", "no-store")
  createConcept(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateTerminologyConceptInput,
  ) {
    return this.terminology.createConcept(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("concepts/:conceptId/versions")
  @Header("Cache-Control", "no-store")
  publishConceptVersion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("conceptId") conceptId: string,
    @Body() body: PublishTerminologyConceptVersionInput,
  ) {
    return this.terminology.publishVersion(principal, conceptId, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("mappings")
  @Header("Cache-Control", "no-store")
  createMapping(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateExternalMappingInput,
  ) {
    return this.terminology.createMapping(principal, body);
  }
}

@Module({
  controllers: [TerminologyController, AdminTerminologyController],
  providers: [TerminologyService],
  exports: [TerminologyService],
})
export class TerminologyModule {}
