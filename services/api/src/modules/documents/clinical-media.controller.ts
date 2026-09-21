import { Body, Controller, Get, Header, Param, Post, StreamableFile } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalMediaService } from "./clinical-media.service";

@Controller("clinical-media")
export class ClinicalMediaController {
  constructor(private readonly media: ClinicalMediaService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_MEDIA")
  @Post("me")
  @Header("Cache-Control", "no-store")
  createMine(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.media.patientCreate(principal, body ?? {});
  }

  @RequirePermissions("CLINICAL_MEDIA_WRITE")
  @Post("patients/:patientId")
  @Header("Cache-Control", "no-store")
  createForPatient(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.media.providerCreate(principal, patientId, body ?? {});
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_MEDIA")
  @Get("me")
  @Header("Cache-Control", "no-store")
  listMine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.media.listMine(principal);
  }

  @RequirePermissions("CLINICAL_MEDIA_READ")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  listForPatient(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.media.listForProvider(principal, patientId);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_MEDIA", "CLINICAL_MEDIA_READ")
  @Post(":mediaId/access-grant")
  @Header("Cache-Control", "no-store")
  issueAccessGrant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("mediaId") mediaId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.media.issueAccessGrant(principal, mediaId, body ?? {});
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_MEDIA", "CLINICAL_MEDIA_READ")
  @Post(":mediaId/access")
  @Header("Cache-Control", "private, no-store, max-age=0")
  @Header("Pragma", "no-cache")
  @Header("X-Content-Type-Options", "nosniff")
  async access(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("mediaId") mediaId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const content = await this.media.consumeAccessGrant(principal, mediaId, body ?? {});
    return new StreamableFile(content.bytes, {
      type: content.mediaType,
      disposition: `inline; filename="${this.safeFileName(content.fileName)}"`,
    });
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_MEDIA", "CLINICAL_MEDIA_WRITE")
  @Post(":mediaId/remove")
  @Header("Cache-Control", "no-store")
  remove(@CurrentPrincipal() principal: AuthPrincipal, @Param("mediaId") mediaId: string) {
    return this.media.remove(principal, mediaId);
  }

  private safeFileName(value: string): string {
    const cleaned = value.replace(/[\r\n"\\/<>:*?\u0000-\u001F]/g, "_").trim();
    return (cleaned || "carepoint-media").slice(0, 180);
  }
}
