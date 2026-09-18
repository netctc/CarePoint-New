import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { FhirSearchSupportService, type FhirSearchQuery } from "./fhir-search-support.service";
import { FhirService } from "./fhir.service";

type FhirResource = Record<string, unknown>;
type BundleEntry = { resource?: FhirResource };

const APPOINTMENT_SOURCE_WINDOW = 200;
const APPOINTMENT_STATUSES = new Set(["pending", "booked", "cancelled", "fulfilled", "noshow", "entered-in-error"]);

@Injectable()
export class FhirSearchService {
  constructor(
    private readonly fhir: FhirService,
    private readonly support: FhirSearchSupportService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async appointments(principal: AuthPrincipal, query: FhirSearchQuery): Promise<FhirResource> {
    this.support.assertAllowed(query, ["patient", "status", "_count", "_offset"]);
    const patient = this.support.required(query, "patient");
    const paging = this.support.paging(query);
    const status = this.support.tokens(query, "status");
    this.assertStatuses(status);

    const source = await this.fhir.appointmentsForPatient(principal, patient);
    const sourceTotal = typeof source.total === "number" ? source.total : 0;
    if (sourceTotal >= APPOINTMENT_SOURCE_WINDOW) {
      throw new ConflictException("FHIR Appointment search exceeded the current CarePoint safety window; a narrower server-side search is required before pagination can remain exact.");
    }

    const resources = this.resources(source);
    const filtered = status.length === 0
      ? resources
      : resources.filter((resource) => typeof resource.status === "string" && status.includes(resource.status));
    const page = filtered.slice(paging.offset, paging.offset + paging.count);
    const patientId = patient.startsWith("Patient/") ? patient.slice("Patient/".length) : patient;

    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_APPOINTMENT_PAGED_SEARCH",
      objectType: "PATIENT",
      objectId: patientId,
      result: "SUCCESS",
      metadata: { count: paging.count, offset: paging.offset, total: filtered.length, status },
    });

    return this.support.bundle({
      resources: page,
      total: filtered.length,
      route: "/api/v1/fhir/R4/Appointment",
      query,
      paging,
    });
  }

  private resources(bundle: FhirResource): FhirResource[] {
    if (!Array.isArray(bundle.entry)) return [];
    return bundle.entry
      .map((entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as BundleEntry).resource : undefined)
      .filter((resource): resource is FhirResource => Boolean(resource));
  }

  private assertStatuses(statuses: string[]): void {
    for (const status of statuses) {
      if (status.includes("|") || !APPOINTMENT_STATUSES.has(status)) {
        throw new BadRequestException(`Unsupported FHIR Appointment status '${status}'.`);
      }
    }
  }
}
