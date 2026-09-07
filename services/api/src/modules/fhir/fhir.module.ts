import {
  ArgumentsHost,
  Catch,
  Controller,
  Get,
  Header,
  HttpException,
  Module,
  Param,
  Query,
  UseFilters,
  type ExceptionFilter,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, Public } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { DocumentsModule } from "../documents/documents.module";
import { OrdersModule } from "../orders/orders.module";
import { FhirDocumentsService } from "./fhir-documents.service";
import { FhirService } from "./fhir.service";

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  setHeader(name: string, value: string): void;
  json(value: unknown): void;
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
    response.status(status).json({
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: outcomeCode(status), diagnostics }],
    });
  }
}

@Controller("fhir/R4")
@UseFilters(FhirHttpExceptionFilter)
class FhirController {
  constructor(
    private readonly fhir: FhirService,
    private readonly fhirDocuments: FhirDocumentsService,
  ) {}

  @Public()
  @Get("metadata")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  metadata() {
    return this.fhirDocuments.augmentCapability(this.fhir.capabilityStatement());
  }

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

  @Get("Appointment")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  appointments(@CurrentPrincipal() principal: AuthPrincipal, @Query("patient") patient: string) {
    return this.fhir.appointmentsForPatient(principal, patient);
  }

  @Get("Appointment/:appointmentId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  appointment(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.fhir.appointment(principal, appointmentId);
  }

  @Get("Encounter/:appointmentId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  encounter(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.fhir.encounter(principal, appointmentId);
  }

  @Get("Observation")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  observations(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("encounter") encounter?: string,
    @Query("based-on") basedOn?: string,
  ) {
    return this.fhir.observations(principal, encounter, basedOn);
  }

  @Get("MedicationRequest/:orderId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  medicationRequest(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId") orderId: string) {
    return this.fhir.medicationRequest(principal, orderId);
  }

  @Get("ServiceRequest/:orderId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  serviceRequest(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId") orderId: string) {
    return this.fhir.serviceRequest(principal, orderId);
  }

  @Get("DiagnosticReport/:reportId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  diagnosticReport(@CurrentPrincipal() principal: AuthPrincipal, @Param("reportId") reportId: string) {
    return this.fhirDocuments.diagnosticReport(principal, reportId);
  }

  @Get("DocumentReference/:documentId")
  @Header("Content-Type", "application/fhir+json; charset=utf-8")
  documentReference(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    return this.fhirDocuments.documentReference(principal, documentId);
  }
}

@Module({
  imports: [ClinicalModule, OrdersModule, DocumentsModule],
  controllers: [FhirController],
  providers: [FhirService, FhirDocumentsService],
})
export class FhirModule {}

function outcomeCode(status: number): string {
  if (status === 400) return "invalid";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  return "processing";
}
