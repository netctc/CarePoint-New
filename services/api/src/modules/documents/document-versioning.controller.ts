import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { DocumentVersioningService } from "./document-versioning.service";

@Controller("clinical-documents")
export class DocumentVersioningController {
  constructor(private readonly versioning: DocumentVersioningService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS", "CLINICAL_DOCUMENT_READ")
  @Get(":documentId/versions")
  @Header("Cache-Control", "private, no-store, max-age=0")
  history(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    return this.versioning.listVersions(principal, documentId);
  }

  @RequirePermissions("PATIENT_WRITE_CLINICAL_DOCUMENTS", "CLINICAL_DOCUMENT_WRITE")
  @Post(":documentId/versions")
  @Header("Cache-Control", "private, no-store, max-age=0")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("documentId") documentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.versioning.createVersion(principal, documentId, body ?? {});
  }
}
