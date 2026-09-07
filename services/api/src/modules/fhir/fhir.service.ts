import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

const FHIR_VERSION = "4.0.1";

type FhirResource = Record<string, unknown>;

@Injectable()
export class FhirService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  capabilityStatement(): FhirResource {
    return {
      resourceType: "CapabilityStatement",
      id: "carepoint-r4",
      status: "active",
      date: "2026-09-07",
      kind: "instance",
      software: { name: "CarePoint", version: "slice-10" },
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
            {
              type: "Patient",
              interaction: [{ code: "read" }],
            },
            {
              type: "Practitioner",
              interaction: [{ code: "read" }],
            },
            {
              type: "Appointment",
              interaction: [{ code: "read" }, { code: "search-type" }],
              searchParam: [{ name: "patient", type: "reference", documentation: "CarePoint Patient resource id" }],
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
      entry: appointments.map((item) => ({
        fullUrl: `urn:uuid:${item.id}`,
        resource: this.toAppointment(item),
        search: { mode: "match" },
      })),
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
      status: this.fhirAppointmentStatus(appointment.status),
      serviceType: [{ text: appointment.service.name }],
      appointmentType: {
        coding: [{ system: "urn:carepoint:appointment-modality", code: appointment.modality }],
        text: appointment.modality,
      },
      start: appointment.startsAt.toISOString(),
      end: appointment.endsAt.toISOString(),
      ...(appointment.cancellationReason ? { comment: appointment.cancellationReason } : {}),
      participant: [
        {
          actor: { reference: `Patient/${appointment.patient.id}`, display: `${appointment.patient.firstName} ${appointment.patient.lastName}` },
          status: "accepted",
        },
        {
          actor: { reference: `Practitioner/${appointment.provider.id}`, display: appointment.provider.displayName },
          status: "accepted",
        },
      ],
    };
  }

  private fhirAppointmentStatus(status: string): string {
    return switchStatus(status);
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

  private async denied(principal: AuthPrincipal, action: string, objectType: string, objectId: string): Promise<void> {
    await this.audit.write({ actorId: principal.accountId, action, objectType, objectId, result: "DENIED", metadata: { role: principal.role, fhirVersion: FHIR_VERSION } });
  }
}

function switchStatus(status: string): string {
  switch (status) {
    case "REQUESTED": return "pending";
    case "CONFIRMED": return "booked";
    case "CANCELLED": return "cancelled";
    case "COMPLETED": return "fulfilled";
    case "NO_SHOW": return "noshow";
    default: return "entered-in-error";
  }
}
