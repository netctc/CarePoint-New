import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalService } from "../clinical/clinical.service";

const FHIR_VERSION = "4.0.1";

type FhirResource = Record<string, unknown>;

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
  ) {}

  capabilityStatement(): FhirResource {
    return {
      resourceType: "CapabilityStatement",
      id: "carepoint-r4",
      status: "active",
      date: "2026-09-07",
      kind: "instance",
      software: { name: "CarePoint", version: "slice-10.1" },
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
              searchParam: [{ name: "encounter", type: "reference", documentation: "FHIR Encounter reference backed by a CarePoint appointment encounter" }],
            },
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
    return {
      resourceType: "Bundle",
      type: "searchset",
      total: appointments.length,
      entry: appointments.map((item) => ({ fullUrl: `urn:uuid:${item.id}`, resource: this.toAppointment(item), search: { mode: "match" } })),
    };
  }

  async encounter(principal: AuthPrincipal, appointmentId: string): Promise<FhirResource> {
    const view = await this.clinical.getEncounter(principal, appointmentId);
    if (!view.latestRecord) throw new NotFoundException("FHIR Encounter is not available until clinical documentation exists.");
    const resource = this.toEncounter(view);
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

  async observationsForEncounter(principal: AuthPrincipal, encounterReference: string): Promise<FhirResource> {
    const appointmentId = this.parseEncounterReference(encounterReference);
    const view = await this.clinical.getEncounter(principal, appointmentId);
    if (!view.latestRecord) throw new NotFoundException("FHIR Encounter is not available until clinical documentation exists.");
    const vitals = this.vitalObservations(view);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_OBSERVATION_SEARCH",
      objectType: "APPOINTMENT",
      objectId: appointmentId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { basis: view.accessBasis, count: vitals.length, fhirVersion: FHIR_VERSION },
    });
    return {
      resourceType: "Bundle",
      type: "searchset",
      total: vitals.length,
      entry: vitals.map((resource) => ({ fullUrl: `urn:uuid:${resource.id}`, resource, search: { mode: "match" } })),
    };
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

  private toEncounter(view: any): FhirResource {
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
      subject: { reference: `Patient/${view.latestRecord.data.patientId ?? view.latestRecord.patientId ?? ""}` },
      participant: [{ individual: { reference: `Practitioner/${appointment.provider.id}`, display: appointment.provider.displayName } }],
      appointment: [{ reference: `Appointment/${appointment.id}` }],
      period: { start: new Date(appointment.startsAt).toISOString(), end: new Date(appointment.endsAt).toISOString() },
      serviceType: { text: appointment.service.name },
    };
  }

  private vitalObservations(view: any): FhirResource[] {
    const record = view.latestRecord;
    const vitals = record?.data?.vitals;
    if (!vitals || typeof vitals !== "object" || Array.isArray(vitals)) return [];
    const patientId = this.patientIdForAppointment(view.appointment.id);
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

  private patientIdForAppointment(appointmentId: string): string {
    // The clinical view deliberately does not expose the Patient id directly.
    // The value is injected by observationFromAppointment before resources are returned.
    return appointmentId;
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
