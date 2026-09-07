import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalService } from "../clinical/clinical.service";
import { OrdersService } from "../orders/orders.service";

const FHIR_VERSION = "4.0.1";

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
export class FhirService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly clinical: ClinicalService,
    private readonly orders: OrdersService,
  ) {}

  capabilityStatement(): FhirResource {
    return {
      resourceType: "CapabilityStatement",
      id: "carepoint-r4",
      status: "active",
      date: "2026-09-07",
      kind: "instance",
      software: { name: "CarePoint", version: "slice-10.2" },
      implementation: { description: "CarePoint FHIR R4 read-only interoperability facade" },
      fhirVersion: FHIR_VERSION,
      format: ["json"],
      rest: [
        {
          mode: "server",
          security: {
            cors: true,
            description: "CarePoint bearer-session authorization applies to protected FHIR resources.",
          },
          resource: [
            { type: "Patient", interaction: [{ code: "read" }] },
            { type: "Practitioner", interaction: [{ code: "read" }] },
            {
              type: "Appointment",
              interaction: [{ code: "read" }, { code: "search-type" }],
              searchParam: [{ name: "patient", type: "reference", documentation: "CarePoint Patient resource id" }],
            },
            { type: "Encounter", interaction: [{ code: "read" }] },
            {
              type: "Observation",
              interaction: [{ code: "search-type" }],
              searchParam: [
                { name: "encounter", type: "reference", documentation: "FHIR Encounter reference backed by a CarePoint appointment encounter" },
                { name: "based-on", type: "reference", documentation: "FHIR ServiceRequest reference backed by a CarePoint laboratory order" },
              ],
            },
            { type: "MedicationRequest", interaction: [{ code: "read" }] },
            { type: "ServiceRequest", interaction: [{ code: "read" }] },
          ],
        },
      ],
    };
  }

  async patient(principal: AuthPrincipal, patientId: string): Promise<FhirResource> {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      include: { user: { select: { id: true, email: true, status: true } } },
    });
    if (!patient) throw new NotFoundException("FHIR Patient not found.");
    if (patient.userId !== principal.accountId && !roleHasPermission(principal.role, "IAM_MANAGE_ACCOUNTS")) {
      await this.denied(principal, "FHIR_PATIENT_READ_DENIED", "PATIENT", patient.id);
      throw new ForbiddenException("FHIR Patient access denied.");
    }
    await this.audit.write({ actorId: principal.accountId, action: "FHIR_PATIENT_READ", objectType: "PATIENT", objectId: patient.id, result: "SUCCESS" });
    return this.toPatient(patient);
  }

  async practitioner(providerId: string): Promise<FhirResource> {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider || provider.status !== "ACTIVE") throw new NotFoundException("FHIR Practitioner not found.");
    return {
      resourceType: "Practitioner",
      id: provider.id,
      meta: { profile: ["http://hl7.org/fhir/StructureDefinition/Practitioner"] },
      active: true,
      name: [{ text: provider.displayName }],
    };
  }

  async appointment(principal: AuthPrincipal, appointmentId: string): Promise<FhirResource> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { id: true, userId: true, firstName: true, lastName: true } },
        provider: { select: { id: true, userId: true, displayName: true } },
        service: { select: { id: true, name: true } },
      },
    });
    if (!appointment) throw new NotFoundException("FHIR Appointment not found.");
    if (!this.canReadAppointment(principal, appointment.patient.userId, appointment.provider.userId)) {
      await this.denied(principal, "FHIR_APPOINTMENT_READ_DENIED", "APPOINTMENT", appointment.id);
      throw new ForbiddenException("FHIR Appointment access denied.");
    }
    await this.audit.write({ actorId: principal.accountId, action: "FHIR_APPOINTMENT_READ", objectType: "APPOINTMENT", objectId: appointment.id, result: "SUCCESS" });
    return this.toAppointment(appointment);
  }

  async appointmentsForPatient(principal: AuthPrincipal, patientReference: string): Promise<FhirResource> {
    const patientId = this.parsePatientReference(patientReference);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true, userId: true } });
    if (!patient) throw new NotFoundException("FHIR Patient not found.");
    if (patient.userId !== principal.accountId && !roleHasPermission(principal.role, "IAM_MANAGE_ACCOUNTS")) {
      await this.denied(principal, "FHIR_APPOINTMENT_SEARCH_DENIED", "PATIENT", patient.id);
      throw new ForbiddenException("FHIR Appointment search access denied.");
    }
    const appointments = await this.prisma.appointment.findMany({
      where: { patientId: patient.id },
      include: {
        patient: { select: { id: true, userId: true, firstName: true, lastName: true } },
        provider: { select: { id: true, userId: true, displayName: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: "desc" },
      take: 200,
    });
    await this.audit.write({ actorId: principal.accountId, action: "FHIR_APPOINTMENT_SEARCH", objectType: "PATIENT", objectId: patient.id, result: "SUCCESS", metadata: { count: appointments.length } });
    return this.searchBundle(appointments.map((item) => this.toAppointment(item)));
  }

  async encounter(principal: AuthPrincipal, appointmentId: string): Promise<FhirResource> {
    const view = await this.clinical.getEncounter(principal, appointmentId);
    if (!view.latestRecord) throw new NotFoundException("FHIR Encounter is not available until clinical documentation exists.");
    const patientId = await this.patientIdForAppointment(appointmentId);
    const resource = this.toEncounter(view, patientId);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_ENCOUNTER_READ",
      objectType: "APPOINTMENT",
      objectId: appointmentId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { basis: view.accessBasis, fhirVersion: FHIR_VERSION },
    });
    return resource;
  }

  async observations(principal: AuthPrincipal, encounterReference?: string, basedOnReference?: string): Promise<FhirResource> {
    const encounter = encounterReference?.trim();
    const basedOn = basedOnReference?.trim();
    if ((!encounter && !basedOn) || (encounter && basedOn)) {
      throw new BadRequestException("FHIR Observation search requires exactly one of encounter or based-on.");
    }
    return encounter
      ? this.observationsForEncounter(principal, encounter)
      : this.labObservationsForServiceRequest(principal, basedOn as string);
  }

  async observationsForEncounter(principal: AuthPrincipal, encounterReference: string): Promise<FhirResource> {
    const appointmentId = this.parseEncounterReference(encounterReference);
    const view = await this.clinical.getEncounter(principal, appointmentId);
    if (!view.latestRecord) throw new NotFoundException("FHIR Encounter is not available until clinical documentation exists.");
    const patientId = await this.patientIdForAppointment(appointmentId);
    const vitals = this.vitalObservations(view, patientId);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_OBSERVATION_SEARCH",
      objectType: "APPOINTMENT",
      objectId: appointmentId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { basis: view.accessBasis, category: "vital-signs", count: vitals.length, fhirVersion: FHIR_VERSION },
    });
    return this.searchBundle(vitals);
  }

  async medicationRequest(principal: AuthPrincipal, orderId: string): Promise<FhirResource> {
    const order = await this.orders.getOrder(principal, orderId);
    if (order.type !== "PRESCRIPTION") throw new NotFoundException("FHIR MedicationRequest not found.");
    const resource = this.toMedicationRequest(order);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_MEDICATION_REQUEST_READ",
      objectType: "CLINICAL_ORDER",
      objectId: order.id,
      purpose: this.orderPurpose(order.accessBasis),
      result: "SUCCESS",
      metadata: { basis: order.accessBasis, fhirVersion: FHIR_VERSION },
    });
    return resource;
  }

  async serviceRequest(principal: AuthPrincipal, orderId: string): Promise<FhirResource> {
    const order = await this.orders.getOrder(principal, orderId);
    if (order.type !== "LABORATORY") throw new NotFoundException("FHIR ServiceRequest not found.");
    const resource = this.toServiceRequest(order);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_SERVICE_REQUEST_READ",
      objectType: "CLINICAL_ORDER",
      objectId: order.id,
      purpose: this.orderPurpose(order.accessBasis),
      result: "SUCCESS",
      metadata: { basis: order.accessBasis, fhirVersion: FHIR_VERSION },
    });
    return resource;
  }

  async labObservationsForServiceRequest(principal: AuthPrincipal, basedOnReference: string): Promise<FhirResource> {
    const orderId = this.parseServiceRequestReference(basedOnReference);
    const order = await this.orders.getOrder(principal, orderId);
    if (order.type !== "LABORATORY") throw new NotFoundException("FHIR ServiceRequest not found.");

    const released = order.labResult && order.labResult.status === "RELEASED" && order.labResult.released === true;
    const resources = released ? this.labObservations(order) : [];
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_LAB_OBSERVATION_SEARCH",
      objectType: "CLINICAL_ORDER",
      objectId: order.id,
      purpose: this.orderPurpose(order.accessBasis),
      result: "SUCCESS",
      metadata: { basis: order.accessBasis, released: Boolean(released), count: resources.length, fhirVersion: FHIR_VERSION },
    });
    return this.searchBundle(resources);
  }

  private toPatient(patient: { id: string; firstName: string; lastName: string; phone: string | null; user: { email: string; status: string } }): FhirResource {
    return {
      resourceType: "Patient",
      id: patient.id,
      meta: { profile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
      active: patient.user.status === "ACTIVE",
      name: [{ use: "official", family: patient.lastName, given: [patient.firstName], text: `${patient.firstName} ${patient.lastName}` }],
      telecom: [
        { system: "email", value: patient.user.email, use: "home" },
        ...(patient.phone ? [{ system: "phone", value: patient.phone, use: "mobile" }] : []),
      ],
    };
  }

  private toAppointment(appointment: {
    id: string;
    status: string;
    modality: string;
    startsAt: Date;
    endsAt: Date;
    cancellationReason: string | null;
    patient: { id: string; firstName: string; lastName: string };
    provider: { id: string; displayName: string };
    service: { id: string; name: string };
  }): FhirResource {
    return {
      resourceType: "Appointment",
      id: appointment.id,
      status: switchAppointmentStatus(appointment.status),
      serviceType: [{ text: appointment.service.name }],
      appointmentType: {
        coding: [{ system: "urn:carepoint:appointment-modality", code: appointment.modality }],
        text: appointment.modality,
      },
      start: appointment.startsAt.toISOString(),
      end: appointment.endsAt.toISOString(),
      ...(appointment.cancellationReason ? { comment: appointment.cancellationReason } : {}),
      participant: [
        { actor: { reference: `Patient/${appointment.patient.id}`, display: `${appointment.patient.firstName} ${appointment.patient.lastName}` }, status: "accepted" },
        { actor: { reference: `Practitioner/${appointment.provider.id}`, display: appointment.provider.displayName }, status: "accepted" },
      ],
    };
  }

  private toEncounter(view: any, patientId: string): FhirResource {
    const appointment = view.appointment;
    return {
      resourceType: "Encounter",
      id: appointment.id,
      status: view.finalized ? "finished" : "in-progress",
      class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
      type: [{
        coding: [{ system: "urn:carepoint:appointment-modality", code: appointment.modality }],
        text: appointment.service?.name ?? appointment.modality,
      }],
      subject: { reference: `Patient/${patientId}` },
      participant: [{ individual: { reference: `Practitioner/${appointment.provider.id}`, display: appointment.provider.displayName } }],
      appointment: [{ reference: `Appointment/${appointment.id}` }],
      period: { start: new Date(appointment.startsAt).toISOString(), end: new Date(appointment.endsAt).toISOString() },
      serviceType: { text: appointment.service.name },
    };
  }

  private vitalObservations(view: any, patientId: string): FhirResource[] {
    const record = view.latestRecord;
    const vitals = record?.data?.vitals;
    if (!vitals || typeof vitals !== "object" || Array.isArray(vitals)) return [];
    const effective = typeof record.data.authoredAt === "string" ? record.data.authoredAt : new Date(record.createdAt).toISOString();
    const observations: FhirResource[] = [];
    for (const [key, rawValue] of Object.entries(vitals as Record<string, unknown>)) {
      const definition = VITALS[key];
      if (!definition || rawValue === null || rawValue === undefined || rawValue === "") continue;
      const numeric = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" && rawValue.trim() !== "" ? Number(rawValue) : Number.NaN;
      const id = `${record.id}-${definition.id}`.slice(0, 64);
      observations.push({
        resourceType: "Observation",
        id,
        status: view.finalized ? "final" : "preliminary",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }] }],
        code: { coding: [{ system: "urn:carepoint:vital-sign", code: key, display: definition.display }], text: definition.display },
        subject: { reference: `Patient/${patientId}` },
        encounter: { reference: `Encounter/${view.appointment.id}` },
        effectiveDateTime: effective,
        ...(Number.isFinite(numeric)
          ? { valueQuantity: { value: numeric, unit: definition.unit, system: "http://unitsofmeasure.org", code: definition.ucumCode } }
          : { valueString: String(rawValue) }),
      });
    }
    return observations;
  }

  private toMedicationRequest(order: any): FhirResource {
    const data = this.jsonObject(order.data);
    const medication = this.jsonObject(data.medication);
    const dosageInstruction = this.stringValue(data.dosageInstruction) ?? "See CarePoint prescription";
    const resource: FhirResource = {
      resourceType: "MedicationRequest",
      id: order.id,
      status: switchMedicationRequestStatus(order.status),
      intent: "order",
      medicationCodeableConcept: this.codeableConcept(medication, "name"),
      subject: { reference: `Patient/${order.patientId}` },
      encounter: { reference: `Encounter/${order.encounterRef}` },
      authoredOn: this.isoDate(order.signedAt),
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

  private toServiceRequest(order: any): FhirResource {
    const data = this.jsonObject(order.data);
    const tests = Array.isArray(data.tests) ? data.tests.map((item) => this.jsonObject(item)) : [];
    const testConcepts = tests.map((test) => this.codeableConcept(test, "display"));
    const display = tests.map((test) => this.stringValue(test.display)).filter((value): value is string => Boolean(value)).join(", ") || "Laboratory order";
    const priority = this.stringValue(data.priority)?.toLowerCase();
    const resource: FhirResource = {
      resourceType: "ServiceRequest",
      id: order.id,
      status: switchServiceRequestStatus(order.status),
      intent: "order",
      ...(priority === "urgent" || priority === "routine" ? { priority } : {}),
      code: { text: display },
      ...(testConcepts.length ? { orderDetail: testConcepts } : {}),
      subject: { reference: `Patient/${order.patientId}` },
      encounter: { reference: `Encounter/${order.encounterRef}` },
      authoredOn: this.isoDate(order.signedAt),
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

  private labObservations(order: any): FhirResource[] {
    const result = order.labResult;
    const data = this.jsonObject(result?.data);
    const entries = Array.isArray(data.observations) ? data.observations : [];
    const effective = this.isoDate(result?.releasedAt ?? result?.validatedAt ?? order.signedAt);
    return entries.flatMap((raw: unknown, index: number) => {
      const item = this.jsonObject(raw);
      const display = this.stringValue(item.display);
      const value = item.value;
      if (!display || (typeof value !== "string" && typeof value !== "number")) return [];
      const resource: FhirResource = {
        resourceType: "Observation",
        id: `${result.id}-lab-${index + 1}`.slice(0, 64),
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

  private searchBundle(resources: FhirResource[]): FhirResource {
    return {
      resourceType: "Bundle",
      type: "searchset",
      total: resources.length,
      entry: resources.map((resource) => ({ fullUrl: `urn:uuid:${String(resource.id ?? "resource")}`, resource, search: { mode: "match" } })),
    };
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

  private isoDate(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new NotFoundException("FHIR resource date is unavailable.");
    return date.toISOString();
  }

  private orderPurpose(accessBasis: unknown): "PATIENT_ACCESS" | "TREATMENT" {
    return accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT";
  }

  private async patientIdForAppointment(appointmentId: string): Promise<string> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { patientId: true },
    });
    if (!appointment) throw new NotFoundException("FHIR Encounter not found.");
    return appointment.patientId;
  }

  private canReadAppointment(principal: AuthPrincipal, patientUserId: string, providerUserId: string | null): boolean {
    return principal.accountId === patientUserId || principal.accountId === providerUserId || roleHasPermission(principal.role, "APPOINTMENT_OPERATE");
  }

  private parsePatientReference(value: string): string {
    const input = value?.trim();
    if (!input) throw new BadRequestException("FHIR Appointment search requires patient.");
    if (input.startsWith("Patient/")) return input.slice("Patient/".length);
    return input;
  }

  private parseEncounterReference(value: string): string {
    const input = value?.trim();
    if (!input) throw new BadRequestException("FHIR Observation search requires encounter.");
    if (input.startsWith("Encounter/")) return input.slice("Encounter/".length);
    return input;
  }

  private parseServiceRequestReference(value: string): string {
    const input = value?.trim();
    if (!input) throw new BadRequestException("FHIR Observation search requires based-on.");
    if (input.startsWith("ServiceRequest/")) return input.slice("ServiceRequest/".length);
    return input;
  }

  private async denied(principal: AuthPrincipal, action: string, objectType: string, objectId: string): Promise<void> {
    await this.audit.write({ actorId: principal.accountId, action, objectType, objectId, result: "DENIED", metadata: { role: principal.role, fhirVersion: FHIR_VERSION } });
  }
}

function switchAppointmentStatus(status: string): string {
  switch (status) {
    case "REQUESTED": return "pending";
    case "CONFIRMED": return "booked";
    case "CANCELLED": return "cancelled";
    case "COMPLETED": return "fulfilled";
    case "NO_SHOW": return "noshow";
    default: return "entered-in-error";
  }
}

function switchMedicationRequestStatus(status: string): string {
  switch (status) {
    case "SIGNED": return "active";
    case "CANCELLED": return "cancelled";
    case "FULFILLED": return "completed";
    default: return "unknown";
  }
}

function switchServiceRequestStatus(status: string): string {
  switch (status) {
    case "SIGNED": return "active";
    case "CANCELLED": return "revoked";
    case "FULFILLED": return "completed";
    default: return "unknown";
  }
}
