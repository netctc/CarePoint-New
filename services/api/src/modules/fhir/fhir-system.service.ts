import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppointmentStatus, Prisma } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import type { SmartAccessContext } from "../../security/smart-token.service";
import { FhirSearchSupportService, type FhirSearchQuery } from "./fhir-search-support.service";

type FhirResource = Record<string, unknown>;

const FHIR_APPOINTMENT_STATUSES = new Set(["pending", "booked", "cancelled", "fulfilled", "noshow", "entered-in-error"]);
const DB_STATUS_BY_FHIR: Record<string, AppointmentStatus | null> = {
  pending: AppointmentStatus.REQUESTED,
  booked: AppointmentStatus.CONFIRMED,
  cancelled: AppointmentStatus.CANCELLED,
  fulfilled: AppointmentStatus.COMPLETED,
  noshow: AppointmentStatus.NO_SHOW,
  "entered-in-error": null,
};

@Injectable()
export class FhirSystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: FhirSearchSupportService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async patient(context: SmartAccessContext, patientId: string): Promise<FhirResource> {
    this.assertSystem(context);
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      include: { user: { select: { email: true, status: true } } },
    });
    if (!patient) throw new NotFoundException("FHIR Patient not found.");
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_SYSTEM_PATIENT_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { clientId: context.clientId, tokenId: context.tokenId },
    });
    return this.toPatient(patient);
  }

  async patients(context: SmartAccessContext, query: FhirSearchQuery): Promise<FhirResource> {
    this.assertSystem(context);
    this.support.assertAllowed(query, ["_id", "_count", "_offset"]);
    const paging = this.support.paging(query);
    const id = this.support.optional(query, "_id");
    if (id && !this.validId(id)) throw new BadRequestException("FHIR Patient _id is invalid.");
    const where: Prisma.PatientProfileWhereInput = id ? { id } : {};
    const [total, patients] = await this.prisma.$transaction([
      this.prisma.patientProfile.count({ where }),
      this.prisma.patientProfile.findMany({
        where,
        include: { user: { select: { email: true, status: true } } },
        orderBy: { id: "asc" },
        skip: paging.offset,
        take: paging.count,
      }),
    ]);
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_SYSTEM_PATIENT_SEARCH",
      objectType: "SMART_CLIENT",
      objectId: context.clientId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { tokenId: context.tokenId, id: id ?? null, count: paging.count, offset: paging.offset, total },
    });
    return this.support.bundle({
      resources: patients.map((patient) => this.toPatient(patient)),
      total,
      route: "/api/v1/fhir/R4/Patient",
      query,
      paging,
    });
  }

  async appointment(context: SmartAccessContext, appointmentId: string): Promise<FhirResource> {
    this.assertSystem(context);
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: this.appointmentInclude(),
    });
    if (!appointment) throw new NotFoundException("FHIR Appointment not found.");
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_SYSTEM_APPOINTMENT_READ",
      objectType: "APPOINTMENT",
      objectId: appointment.id,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { clientId: context.clientId, tokenId: context.tokenId },
    });
    return this.toAppointment(appointment);
  }

  async appointments(context: SmartAccessContext, query: FhirSearchQuery): Promise<FhirResource> {
    this.assertSystem(context);
    this.support.assertAllowed(query, ["patient", "status", "_count", "_offset"]);
    const paging = this.support.paging(query);
    const patientReference = this.support.optional(query, "patient");
    const statuses = this.support.tokens(query, "status");
    this.assertStatuses(statuses);

    const where: Prisma.AppointmentWhereInput = {};
    let patientId: string | null = null;
    if (patientReference) {
      patientId = this.patientId(patientReference);
      const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
      if (!patient) throw new NotFoundException("FHIR Patient not found.");
      where.patientId = patientId;
    }
    if (statuses.length > 0) {
      const dbStatuses = statuses.map((status) => DB_STATUS_BY_FHIR[status]).filter((status): status is AppointmentStatus => Boolean(status));
      if (dbStatuses.length === 0) {
        where.id = "__carepoint_no_appointment_matches__";
      } else {
        where.status = { in: dbStatuses };
      }
    }

    const [total, appointments] = await this.prisma.$transaction([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        include: this.appointmentInclude(),
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        skip: paging.offset,
        take: paging.count,
      }),
    ]);
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "FHIR_SYSTEM_APPOINTMENT_SEARCH",
      objectType: "SMART_CLIENT",
      objectId: context.clientId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { tokenId: context.tokenId, patientId, statuses, count: paging.count, offset: paging.offset, total },
    });
    return this.support.bundle({
      resources: appointments.map((appointment) => this.toAppointment(appointment)),
      total,
      route: "/api/v1/fhir/R4/Appointment",
      query,
      paging,
    });
  }

  private appointmentInclude() {
    return {
      patient: { select: { id: true, firstName: true, lastName: true } },
      provider: { select: { id: true, displayName: true } },
      service: { select: { id: true, name: true } },
    } satisfies Prisma.AppointmentInclude;
  }

  private toPatient(patient: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    user: { email: string; status: string };
  }): FhirResource {
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
    status: AppointmentStatus;
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
          actor: {
            reference: `Patient/${appointment.patient.id}`,
            display: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
          },
          status: "accepted",
        },
        {
          actor: { reference: `Practitioner/${appointment.provider.id}`, display: appointment.provider.displayName },
          status: "accepted",
        },
      ],
    };
  }

  private fhirAppointmentStatus(status: AppointmentStatus): string {
    if (status === AppointmentStatus.REQUESTED) return "pending";
    if (status === AppointmentStatus.CONFIRMED) return "booked";
    if (status === AppointmentStatus.CANCELLED) return "cancelled";
    if (status === AppointmentStatus.COMPLETED) return "fulfilled";
    return "noshow";
  }

  private assertStatuses(statuses: string[]): void {
    for (const status of statuses) {
      if (status.includes("|") || !FHIR_APPOINTMENT_STATUSES.has(status)) {
        throw new BadRequestException(`Unsupported FHIR Appointment status '${status}'.`);
      }
    }
  }

  private patientId(reference: string): string {
    const id = reference.startsWith("Patient/") ? reference.slice("Patient/".length) : reference;
    if (!this.validId(id) || reference.includes("/") && !reference.startsWith("Patient/")) {
      throw new BadRequestException("FHIR patient reference is invalid.");
    }
    return id;
  }

  private validId(value: string): boolean {
    return /^[A-Za-z0-9.-]{1,128}$/.test(value);
  }

  private assertSystem(context: SmartAccessContext): void {
    if (context.authorizationType !== "system") throw new ForbiddenException("FHIR system access requires a SMART backend-services token.");
  }
}
