import { ConflictException, Injectable } from "@nestjs/common";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import type { SmartAccessContext } from "../../security/smart-token.service";
import { ClinicalSystemExportService, type ClinicalSystemEncounterView } from "../clinical/clinical-system-export.service";
import { DocumentsSystemExportService, type DiagnosticSystemExportView } from "../documents/documents-system-export.service";
import { OrdersSystemExportService, type OrdersSystemExportView } from "../orders/orders-system-export.service";

export type FhirClinicalBulkResourceType = "Encounter" | "Observation" | "MedicationRequest" | "ServiceRequest" | "DiagnosticReport";
type FhirResource = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

interface VitalDefinition {
  id: string;
  display: string;
  unit: string;
  ucumCode: string;
}

const VITALS: Record<string, VitalDefinition> = {
  temperatureC: { id: "temperature", display: "Body temperature", unit: "°C", ucumCode: "Cel" },
  heartRateBpm: { id: "heart-rate", display: "Heart rate", unit: "beats/min", ucumCode: "/min" },
  systolicMmHg: { id: "systolic-bp", display: "Systolic blood pressure", unit: "mmHg", ucumCode: "mm[Hg]" },
  diastolicMmHg: { id: "diastolic-bp", display: "Diastolic blood pressure", unit: "mmHg", ucumCode: "mm[Hg]" },
  respiratoryRate: { id: "respiratory-rate", display: "Respiratory rate", unit: "breaths/min", ucumCode: "/min" },
  oxygenSaturationPct: { id: "oxygen-saturation", display: "Oxygen saturation", unit: "%", ucumCode: "%" },
  weightKg: { id: "body-weight", display: "Body weight", unit: "kg", ucumCode: "kg" },
  heightCm: { id: "body-height", display: "Body height", unit: "cm", ucumCode: "cm" },
};

@Injectable()
export class FhirClinicalBulkService {
  constructor(
    private readonly clinical: ClinicalSystemExportService,
    private readonly orders: OrdersSystemExportService,
    private readonly documents: DocumentsSystemExportService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async snapshot(
    context: SmartAccessContext,
    resourceTypes: FhirClinicalBulkResourceType[],
    since: Date | null,
    transactionTime: Date,
    maxResourcesPerType: number,
  ): Promise<Partial<Record<FhirClinicalBulkResourceType, FhirResource[]>>> {
    const resources: Partial<Record<FhirClinicalBulkResourceType, FhirResource[]>> = {};
    let encounters: ClinicalSystemEncounterView[] | null = null;
    const encounterSource = async () => encounters ??= await this.clinical.documentedEncounters({
      transactionTime,
      maxResources: maxResourcesPerType,
      actorId: context.principal.accountId,
      clientId: context.clientId,
    });

    if (resourceTypes.includes("Encounter")) {
      const source = await encounterSource();
      resources.Encounter = source.map((item) => this.toEncounter(item));
      this.assertLimit("Encounter", resources.Encounter.length, maxResourcesPerType);
    }

    if (resourceTypes.includes("Observation")) {
      const source = await encounterSource();
      const vitalObservations = source.flatMap((item) => this.vitalObservations(item));
      const labOrders = await this.orders.releasedLaboratoryOrders({
        since,
        transactionTime,
        maxResources: maxResourcesPerType,
        actorId: context.principal.accountId,
        clientId: context.clientId,
      });
      const laboratoryObservations = labOrders.flatMap((order) => this.labObservations(order));
      resources.Observation = [...vitalObservations, ...laboratoryObservations]
        .sort((left, right) => String(left.id ?? "").localeCompare(String(right.id ?? "")));
      this.assertLimit("Observation", resources.Observation.length, maxResourcesPerType);
    }

    if (resourceTypes.includes("MedicationRequest")) {
      const source = await this.orders.orders({
        type: "PRESCRIPTION",
        since,
        transactionTime,
        maxResources: maxResourcesPerType,
        actorId: context.principal.accountId,
        clientId: context.clientId,
      });
      resources.MedicationRequest = source.map((order) => this.toMedicationRequest(order));
    }

    if (resourceTypes.includes("ServiceRequest")) {
      const source = await this.orders.orders({
        type: "LABORATORY",
        since,
        transactionTime,
        maxResources: maxResourcesPerType,
        actorId: context.principal.accountId,
        clientId: context.clientId,
      });
      resources.ServiceRequest = source.map((order) => this.toServiceRequest(order));
    }

    if (resourceTypes.includes("DiagnosticReport")) {
      const source = await this.documents.releasedDiagnosticReports({
        since,
        transactionTime,
        maxResources: maxResourcesPerType,
        actorId: context.principal.accountId,
        clientId: context.clientId,
      });
      resources.DiagnosticReport = source.map((report) => this.toDiagnosticReport(report));
    }

    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_BULK_CLINICAL_DOMAIN_SNAPSHOT",
      objectType: "SMART_CLIENT",
      objectId: context.clientId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: {
        tokenId: context.tokenId,
        resourceTypes,
        since: since?.toISOString() ?? null,
        transactionTime: transactionTime.toISOString(),
        counts: Object.fromEntries(Object.entries(resources).map(([type, items]) => [type, Array.isArray(items) ? items.length : 0])),
        encryptedDomainServices: true,
        releaseGatesPreserved: true,
      },
    });
    return resources;
  }

  private toEncounter(view: ClinicalSystemEncounterView): FhirResource {
    const appointment = view.appointment;
    return {
      resourceType: "Encounter",
      id: appointment.id,
      status: view.finalized ? "finished" : "in-progress",
      class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
      type: [{
        coding: [{ system: "urn:carepoint:appointment-modality", code: appointment.modality }],
        text: appointment.service.name || appointment.modality,
      }],
      subject: { reference: `Patient/${view.patientId}` },
      participant: [{ individual: { reference: `Practitioner/${appointment.provider.id}`, display: appointment.provider.displayName } }],
      appointment: [{ reference: `Appointment/${appointment.id}` }],
      period: { start: appointment.startsAt.toISOString(), end: appointment.endsAt.toISOString() },
      serviceType: { text: appointment.service.name },
    };
  }

  private vitalObservations(view: ClinicalSystemEncounterView): FhirResource[] {
    const record = view.latestRecord;
    const vitals = record.data.vitals;
    if (!vitals || typeof vitals !== "object" || Array.isArray(vitals)) return [];
    const effective = typeof record.data.authoredAt === "string" ? record.data.authoredAt : record.createdAt.toISOString();
    const observations: FhirResource[] = [];
    for (const [key, rawValue] of Object.entries(vitals as Record<string, unknown>)) {
      const definition = VITALS[key];
      if (!definition || rawValue === null || rawValue === undefined || rawValue === "") continue;
      const numeric = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" && rawValue.trim() !== "" ? Number(rawValue) : Number.NaN;
      observations.push({
        resourceType: "Observation",
        id: `${record.id}-${definition.id}`.slice(0, 64),
        status: view.finalized ? "final" : "preliminary",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }] }],
        code: { coding: [{ system: "urn:carepoint:vital-sign", code: key, display: definition.display }], text: definition.display },
        subject: { reference: `Patient/${view.patientId}` },
        encounter: { reference: `Encounter/${view.appointment.id}` },
        effectiveDateTime: effective,
        ...(Number.isFinite(numeric)
          ? { valueQuantity: { value: numeric, unit: definition.unit, system: "http://unitsofmeasure.org", code: definition.ucumCode } }
          : { valueString: String(rawValue) }),
      });
    }
    return observations;
  }

  private toMedicationRequest(order: OrdersSystemExportView): FhirResource {
    const data = this.jsonObject(order.data);
    const medication = this.jsonObject(data.medication);
    const dosageInstruction = this.stringValue(data.dosageInstruction) ?? "See CarePoint prescription";
    const resource: FhirResource = {
      resourceType: "MedicationRequest",
      id: order.id,
      meta: { lastUpdated: order.updatedAt.toISOString() },
      status: switchMedicationRequestStatus(order.status),
      intent: "order",
      medicationCodeableConcept: this.codeableConcept(medication, "name"),
      subject: { reference: `Patient/${order.patientId}` },
      encounter: { reference: `Encounter/${order.encounterRef}` },
      authoredOn: order.signedAt.toISOString(),
      requester: { reference: `Practitioner/${order.providerId}` },
      dosageInstruction: [{ text: dosageInstruction }],
    };
    const refills = this.numberValue(data.refills);
    const quantity = this.numberValue(data.quantity);
    if (refills !== null || quantity !== null) {
      resource.dispenseRequest = {
        ...(refills !== null ? { numberOfRepeatsAllowed: refills } : {}),
        ...(quantity !== null ? { quantity: { value: quantity } } : {}),
      };
    }
    const notes = ["route", "frequency", "duration", "reason", "instructions"]
      .map((key) => this.stringValue(data[key]))
      .filter((value): value is string => Boolean(value));
    if (notes.length) resource.note = notes.map((text) => ({ text }));
    return resource;
  }

  private toServiceRequest(order: OrdersSystemExportView): FhirResource {
    const data = this.jsonObject(order.data);
    const tests = Array.isArray(data.tests) ? data.tests.map((item) => this.jsonObject(item)) : [];
    const testConcepts = tests.map((test) => this.codeableConcept(test, "display"));
    const display = tests.map((test) => this.stringValue(test.display)).filter((value): value is string => Boolean(value)).join(", ") || "Laboratory order";
    const priority = this.stringValue(data.priority)?.toLowerCase();
    const resource: FhirResource = {
      resourceType: "ServiceRequest",
      id: order.id,
      meta: { lastUpdated: order.updatedAt.toISOString() },
      status: switchServiceRequestStatus(order.status),
      intent: "order",
      ...(priority === "urgent" || priority === "routine" ? { priority } : {}),
      code: { text: display },
      ...(testConcepts.length ? { orderDetail: testConcepts } : {}),
      subject: { reference: `Patient/${order.patientId}` },
      encounter: { reference: `Encounter/${order.encounterRef}` },
      authoredOn: order.signedAt.toISOString(),
      requester: { reference: `Practitioner/${order.providerId}` },
    };
    const reason = this.stringValue(data.reason);
    if (reason) resource.reasonCode = [{ text: reason }];
    const instructions = this.stringValue(data.instructions);
    const specimen = this.stringValue(data.specimen);
    const fasting = typeof data.fasting === "boolean" ? data.fasting : null;
    const patientInstructions = [
      instructions,
      specimen ? `Specimen: ${specimen}` : null,
      fasting === true ? "Fasting required" : fasting === false ? "Fasting not required" : null,
    ].filter((value): value is string => Boolean(value));
    if (patientInstructions.length) resource.patientInstruction = patientInstructions.join(". ");
    return resource;
  }

  private labObservations(order: OrdersSystemExportView): FhirResource[] {
    const result = order.labResult;
    if (!result || result.status !== "RELEASED" || result.released !== true) return [];
    const data = this.jsonObject(result.data);
    const entries = Array.isArray(data.observations) ? data.observations : [];
    const effective = (result.releasedAt ?? result.validatedAt ?? order.signedAt).toISOString();
    const lastUpdated = result.updatedAt > order.updatedAt ? result.updatedAt : order.updatedAt;
    return entries.flatMap((raw: unknown, index: number) => {
      const item = this.jsonObject(raw);
      const display = this.stringValue(item.display);
      const value = item.value;
      if (!display || (typeof value !== "string" && typeof value !== "number")) return [];
      const resource: FhirResource = {
        resourceType: "Observation",
        id: `${result.id}-lab-${index + 1}`.slice(0, 64),
        meta: { lastUpdated: lastUpdated.toISOString() },
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory", display: "Laboratory" }] }],
        code: this.codeableConcept(item, "display"),
        subject: { reference: `Patient/${order.patientId}` },
        encounter: { reference: `Encounter/${order.encounterRef}` },
        basedOn: [{ reference: `ServiceRequest/${order.id}` }],
        effectiveDateTime: effective,
      };
      if (typeof value === "number") {
        const unit = this.stringValue(item.unit);
        resource.valueQuantity = { value, ...(unit ? { unit } : {}) };
      } else {
        resource.valueString = value;
      }
      const referenceRange = this.stringValue(item.referenceRange);
      if (referenceRange) resource.referenceRange = [{ text: referenceRange }];
      const flag = this.stringValue(item.flag);
      if (flag) resource.interpretation = [{ text: flag }];
      return [resource];
    });
  }

  private toDiagnosticReport(report: DiagnosticSystemExportView): FhirResource {
    const conclusion = this.diagnosticConclusion(report.data);
    const conclusionCode = this.diagnosticCodes(report.data.codes);
    return {
      resourceType: "DiagnosticReport",
      id: report.id,
      meta: { lastUpdated: report.updatedAt.toISOString() },
      status: "final",
      code: {
        coding: [{ system: "urn:carepoint:diagnostic-report-type", code: report.type, display: diagnosticTypeDisplay(report.type) }],
        text: diagnosticTypeDisplay(report.type),
      },
      subject: { reference: `Patient/${report.patientId}` },
      encounter: { reference: `Encounter/${report.encounterRef}` },
      effectiveDateTime: report.createdAt.toISOString(),
      issued: (report.releasedAt ?? report.finalizedAt ?? report.createdAt).toISOString(),
      performer: [{ reference: `Practitioner/${report.providerId}` }],
      resultsInterpreter: [{ reference: `Practitioner/${report.providerId}` }],
      ...(conclusion ? { conclusion } : {}),
      ...(conclusionCode.length > 0 ? { conclusionCode } : {}),
      ...(report.documentId
        ? { presentedForm: [{ url: `DocumentReference/${report.documentId}`, title: "Associated clinical document" }] }
        : {}),
    };
  }

  private diagnosticConclusion(data: JsonObject): string | null {
    const findings = this.stringValue(data.findings);
    const impression = this.stringValue(data.impression);
    const recommendation = this.stringValue(data.recommendation);
    const sections = [
      findings ? `Findings: ${findings}` : null,
      impression ? `Impression: ${impression}` : null,
      recommendation ? `Recommendation: ${recommendation}` : null,
    ].filter((value): value is string => Boolean(value));
    return sections.length > 0 ? sections.join("\n\n") : null;
  }

  private diagnosticCodes(value: unknown): JsonObject[] {
    if (!Array.isArray(value)) return [];
    const concepts: JsonObject[] = [];
    for (const item of value) {
      const source = this.jsonObject(item);
      const code = this.stringValue(source.code);
      if (!code) continue;
      const coding: JsonObject = { code };
      const system = this.stringValue(source.system);
      const display = this.stringValue(source.display);
      if (system) coding.system = system;
      if (display) coding.display = display;
      concepts.push({ coding: [coding], ...(display ? { text: display } : {}) });
    }
    return concepts;
  }

  private codeableConcept(input: JsonObject, displayField: string): FhirResource {
    const display = this.stringValue(input[displayField]);
    const code = this.stringValue(input.code);
    const rawSystem = this.stringValue(input.codeSystem);
    const coding = code
      ? [{ ...(rawSystem ? { system: this.codeSystemUri(rawSystem) } : {}), code, ...(display ? { display } : {}) }]
      : [];
    return { ...(coding.length ? { coding } : {}), ...(display ? { text: display } : {}) };
  }

  private codeSystemUri(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (normalized === "loinc") return "http://loinc.org";
    if (normalized === "rxnorm") return "http://www.nlm.nih.gov/research/umls/rxnorm";
    if (normalized === "snomed" || normalized === "snomed-ct" || normalized === "snomed ct") return "http://snomed.info/sct";
    if (normalized === "icd-10" || normalized === "icd10") return "http://hl7.org/fhir/sid/icd-10";
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
    return `urn:carepoint:code-system:${encodeURIComponent(value.trim())}`;
  }

  private jsonObject(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
  }

  private stringValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private numberValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private assertLimit(resourceType: string, count: number, maxResources: number): void {
    if (count > maxResources) {
      throw new ConflictException(`FHIR bulk export for ${resourceType} exceeded the current safety limit of ${maxResources} resources.`);
    }
  }
}

function switchMedicationRequestStatus(status: string): string {
  if (status === "CANCELLED") return "cancelled";
  if (status === "FULFILLED") return "completed";
  return "active";
}

function switchServiceRequestStatus(status: string): string {
  if (status === "CANCELLED") return "revoked";
  if (status === "FULFILLED") return "completed";
  return "active";
}

function diagnosticTypeDisplay(type: string): string {
  if (type === "IMAGING") return "Imaging diagnostic report";
  if (type === "PATHOLOGY") return "Pathology diagnostic report";
  return "Diagnostic report";
}
