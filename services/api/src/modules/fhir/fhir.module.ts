import {
  ArgumentsHost,
  CallHandler,
  Catch,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  HttpException,
  Injectable,
  Module,
  NestInterceptor,
  Param,
  Query,
  Req,
  Res,
  UseFilters,
  UseInterceptors,
  type ExceptionFilter,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DistributedRateLimitService } from "../../infrastructure/redis/redis-security.module";
import {
  CurrentPrincipal,
  CurrentSmartContext,
  Public,
  RequireSmartFhirAccess,
  RequireSmartSystemFhirOperation,
} from "../../security/api-security.module";
import type { SmartAccessContext } from "../../security/smart-token.service";
import { ClinicalModule } from "../clinical/clinical.module";
import { DocumentsModule } from "../documents/documents.module";
import { OrdersModule } from "../orders/orders.module";
import { FhirBulkExportService } from "./fhir-bulk-export.service";
import { FhirBulkExportStorageService } from "./fhir-bulk-export-storage.service";
import { FhirDocumentsService } from "./fhir-documents.service";
import { FhirSearchService } from "./fhir-search.service";
import { FhirSearchSupportService, type FhirSearchQuery } from "./fhir-search-support.service";
import { FhirSmartCapabilityService } from "./fhir-smart-capability.service";
import { FhirSystemService } from "./fhir-system.service";
import { FhirService } from "./fhir.service";

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  setHeader(name: string, value: string): void;
  json(value: unknown): void;
  send(value?: unknown): void;
}

interface FhirRequestLike {
  headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
class FhirNoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const response = context.switchToHttp().getResponse<HttpResponseLike>();
    hardenHeaders(response);
    return next.handle();
  }
}

@Catch(HttpException)
class FhirHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponseLike>();
    const status = exception.getStatus();
    const body = exception.getResponse();
    const diagnostics = typeof body === "string"
      ? body
      : typeof body === "object" && body !== null && "message" in body
        ? String((body as { message?: unknown }).message ?? exception.message)
        : exception.message;
    response.setHeader("content-type", "application/fhir+json; charset=utf-8");
    hardenHeaders(response);
    response.status(status).json({
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: outcomeCode(status), diagnostics }],
    });
  }
}

@Controller("fhir/R4")
@UseFilters(FhirHttpExceptionFilter)
@UseInterceptors(FhirNoStoreInterceptor)
class FhirController {
  constructor(
    private readonly fhir: FhirService,
    private readonly fhirDocuments: FhirDocumentsService,
    private readonly fhirSearch: FhirSearchService,
    private readonly fhirSmart: FhirSmartCapabilityService,
    private readonly fhirSystem: FhirSystemService,
    private readonly bulkExport: FhirBulkExportService,
    private readonly rateLimits: DistributedRateLimitService,
  ) {}

  @Public()
  @Get("metadata")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  metadata() {
    return this.fhirSmart.augment(this.fhirDocuments.augmentCapability(this.fhir.capabilityStatement()));
  }

  @RequireSmartSystemFhirOperation("$export")
  @Get("$export")
  async export(
    @CurrentSmartContext() smart: SmartAccessContext | null,
    @Query() query: FhirSearchQuery,
    @Req() request: FhirRequestLike,
    @Res() response: HttpResponseLike,
  ): Promise<void> {
    if (!smart) throw new ForbiddenException("FHIR bulk export requires SMART backend-services authentication.");
    await this.rateLimits.assertAllowed({ namespace: "fhir:bulk:kickoff", identity: smart.clientId, limit: 10, windowSeconds: 300 });
    const result = await this.bulkExport.kickoff(
      smart,
      query,
      headerValue(request.headers?.prefer),
      headerValue(request.headers?.accept),
    );
    response.setHeader("Content-Location", result.contentLocation);
    response.status(202).send();
  }

  @RequireSmartSystemFhirOperation("$export-status")
  @Get("$export-status/:jobId")
  async exportStatus(
    @CurrentSmartContext() smart: SmartAccessContext | null,
    @Param("jobId") jobId: string,
    @Res() response: HttpResponseLike,
  ): Promise<void> {
    if (!smart) throw new ForbiddenException("FHIR bulk export status requires SMART backend-services authentication.");
    await this.rateLimits.assertAllowed({ namespace: "fhir:bulk:status", identity: `${smart.clientId}:${jobId}`, limit: 60, windowSeconds: 60 });
    const result = await this.bulkExport.poll(smart, jobId);
    if (result.state === "in-progress") {
      response.setHeader("Retry-After", String(result.retryAfterSeconds));
      response.setHeader("X-Progress", result.progress);
      response.status(202).send();
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Expires", new Date(result.expiresAt).toUTCString());
    response.status(200).json(result.manifest);
  }

  @RequireSmartSystemFhirOperation("$export-status")
  @Delete("$export-status/:jobId")
  async cancelExport(
    @CurrentSmartContext() smart: SmartAccessContext | null,
    @Param("jobId") jobId: string,
    @Res() response: HttpResponseLike,
  ): Promise<void> {
    if (!smart) throw new ForbiddenException("FHIR bulk export cancellation requires SMART backend-services authentication.");
    await this.rateLimits.assertAllowed({ namespace: "fhir:bulk:cancel", identity: `${smart.clientId}:${jobId}`, limit: 20, windowSeconds: 60 });
    await this.bulkExport.cancel(smart, jobId);
    response.status(202).send();
  }

  @RequireSmartSystemFhirOperation("$export-file")
  @Get("$export-file/:jobId/:fileName")
  async exportFile(
    @CurrentSmartContext() smart: SmartAccessContext | null,
    @Param("jobId") jobId: string,
    @Param("fileName") fileName: string,
    @Res() response: HttpResponseLike,
  ): Promise<void> {
    if (!smart) throw new ForbiddenException("FHIR bulk export download requires SMART backend-services authentication.");
    await this.rateLimits.assertAllowed({ namespace: "fhir:bulk:download", identity: `${smart.clientId}:${jobId}`, limit: 30, windowSeconds: 60 });
    const result = await this.bulkExport.download(smart, jobId, fileName);
    response.setHeader("Content-Type", "application/fhir+ndjson; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    response.setHeader("Expires", new Date(result.expiresAt).toUTCString());
    response.status(200).send(result.content);
  }

  @RequireSmartFhirAccess("Patient", "s")
  @Get("Patient")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  patients(@CurrentSmartContext() smart: SmartAccessContext | null, @Query() query: FhirSearchQuery) {
    if (!smart || smart.authorizationType !== "system") {
      throw new ForbiddenException("FHIR Patient search is available only to authorized SMART backend-services clients.");
    }
    return this.fhirSystem.patients(smart, query);
  }

  @RequireSmartFhirAccess("Patient", "r")
  @Get("Patient/:patientId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  patient(
    @CurrentPrincipal() principal: AuthPrincipal,
    @CurrentSmartContext() smart: SmartAccessContext | null,
    @Param("patientId") patientId: string,
  ) {
    return smart?.authorizationType === "system"
      ? this.fhirSystem.patient(smart, patientId)
      : this.fhir.patient(principal, patientId);
  }

  @Public()
  @Get("Practitioner/:providerId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  practitioner(@Param("providerId") providerId: string) {
    return this.fhir.practitioner(providerId);
  }

  @RequireSmartFhirAccess("Appointment", "s")
  @Get("Appointment")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  appointments(
    @CurrentPrincipal() principal: AuthPrincipal,
    @CurrentSmartContext() smart: SmartAccessContext | null,
    @Query() query: FhirSearchQuery,
  ) {
    return smart?.authorizationType === "system"
      ? this.fhirSystem.appointments(smart, query)
      : this.fhirSearch.appointments(principal, query);
  }

  @RequireSmartFhirAccess("Appointment", "r")
  @Get("Appointment/:appointmentId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  appointment(
    @CurrentPrincipal() principal: AuthPrincipal,
    @CurrentSmartContext() smart: SmartAccessContext | null,
    @Param("appointmentId") appointmentId: string,
  ) {
    return smart?.authorizationType === "system"
      ? this.fhirSystem.appointment(smart, appointmentId)
      : this.fhir.appointment(principal, appointmentId);
  }

  @RequireSmartFhirAccess("Encounter", "r")
  @Get("Encounter/:appointmentId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  encounter(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.fhir.encounter(principal, appointmentId);
  }

  @RequireSmartFhirAccess("Observation", "s")
  @Get("Observation")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  observations(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("encounter") encounter?: string,
    @Query("based-on") basedOn?: string,
  ) {
    return this.fhir.observations(principal, encounter, basedOn);
  }

  @RequireSmartFhirAccess("MedicationRequest", "r")
  @Get("MedicationRequest/:orderId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  medicationRequest(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId") orderId: string) {
    return this.fhir.medicationRequest(principal, orderId);
  }

  @RequireSmartFhirAccess("ServiceRequest", "r")
  @Get("ServiceRequest/:orderId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  serviceRequest(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId") orderId: string) {
    return this.fhir.serviceRequest(principal, orderId);
  }

  @RequireSmartFhirAccess("DiagnosticReport", "s")
  @Get("DiagnosticReport")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  diagnosticReports(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: FhirSearchQuery) {
    return this.fhirDocuments.diagnosticReports(principal, query);
  }

  @RequireSmartFhirAccess("DiagnosticReport", "r")
  @Get("DiagnosticReport/:reportId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  diagnosticReport(@CurrentPrincipal() principal: AuthPrincipal, @Param("reportId") reportId: string) {
    return this.fhirDocuments.diagnosticReport(principal, reportId);
  }

  @RequireSmartFhirAccess("DocumentReference", "s")
  @Get("DocumentReference")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  documentReferences(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: FhirSearchQuery) {
    return this.fhirDocuments.documentReferences(principal, query);
  }

  @RequireSmartFhirAccess("DocumentReference", "r")
  @Get("DocumentReference/:documentId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  documentReference(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    return this.fhirDocuments.documentReference(principal, documentId);
  }

  @RequireSmartFhirAccess("ImagingStudy", "r")
  @Get("ImagingStudy/:documentId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  imagingStudy(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    return this.fhirDocuments.imagingStudy(principal, documentId);
  }
}

@Module({
  imports: [ClinicalModule, OrdersModule, DocumentsModule],
  controllers: [FhirController],
  providers: [
    FhirService,
    FhirDocumentsService,
    FhirSearchService,
    FhirSearchSupportService,
    FhirSmartCapabilityService,
    FhirSystemService,
    FhirBulkExportService,
    FhirBulkExportStorageService,
    FhirNoStoreInterceptor,
  ],
})
export class FhirModule {}

function hardenHeaders(response: HttpResponseLike): void {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Vary", "Authorization");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

function outcomeCode(status: number): string {
  if (status === 400) return "invalid";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 429) return "throttled";
  if (status >= 500) return "exception";
  return "processing";
}
