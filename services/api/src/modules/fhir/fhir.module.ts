import {
  ArgumentsHost,
  CallHandler,
  Catch,
  Controller,
  ExecutionContext,
  Get,
  Header,
  HttpException,
  Injectable,
  Module,
  NestInterceptor,
  Param,
  Query,
  UseFilters,
  UseInterceptors,
  type ExceptionFilter,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, Public, RequireSmartFhirAccess } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { DocumentsModule } from "../documents/documents.module";
import { OrdersModule } from "../orders/orders.module";
import { FhirDocumentsService } from "./fhir-documents.service";
import { FhirSearchService } from "./fhir-search.service";
import { FhirSearchSupportService, type FhirSearchQuery } from "./fhir-search-support.service";
import { FhirSmartCapabilityService } from "./fhir-smart-capability.service";
import { FhirService } from "./fhir.service";

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  setHeader(name: string, value: string): void;
  json(value: unknown): void;
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
  ) {}

  @Public()
  @Get("metadata")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  metadata() {
    return this.fhirSmart.augment(this.fhirDocuments.augmentCapability(this.fhir.capabilityStatement()));
  }

  @RequireSmartFhirAccess("Patient", "r")
  @Get("Patient/:patientId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  patient(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.fhir.patient(principal, patientId);
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
  appointments(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: FhirSearchQuery) {
    return this.fhirSearch.appointments(principal, query);
  }

  @RequireSmartFhirAccess("Appointment", "r")
  @Get("Appointment/:appointmentId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  appointment(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.fhir.appointment(principal, appointmentId);
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
  providers: [FhirService, FhirDocumentsService, FhirSearchService, FhirSearchSupportService, FhirSmartCapabilityService, FhirNoStoreInterceptor],
})
export class FhirModule {}

function hardenHeaders(response: HttpResponseLike): void {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Vary", "Authorization");
}

function outcomeCode(status: number): string {
  if (status === 400) return "invalid";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  return "processing";
}
