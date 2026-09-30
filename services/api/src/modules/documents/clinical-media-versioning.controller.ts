import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalMediaVersioningService } from "./clinical-media-versioning.service";

@Controller("clinical-media")
export class ClinicalMediaVersioningController {
  constructor(private readonly versioning: ClinicalMediaVersioningService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_MEDIA", "CLINICAL_MEDIA_READ")
  @Get(":mediaId/versions")
  @Header("Cache-Control", "no-store")
  listVersions(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("mediaId") mediaId: string,
  ) {
    return this.versioning.listVersions(principal, mediaId);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_MEDIA", "CLINICAL_MEDIA_WRITE")
  @Post(":mediaId/versions")
  @Header("Cache-Control", "no-store")
  createVersion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("mediaId") mediaId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.versioning.createVersion(principal, mediaId, body ?? {});
  }
}
