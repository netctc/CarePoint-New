import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppointmentStatus, Prisma } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import type { SmartAccessContext } from "../../security/smart-token.service";
import { FhirClinicalBulkService, type FhirClinicalBulkResourceType } from "./fhir-clinical-bulk.service";
import { FhirSearchSupportService, type FhirSearchQuery } from "./fhir-search-support.service";

type FhirResource = Record<string, unknown>;
export type FhirBulkResourceType = "Patient" | "Appointment" | FhirClinicalBulkResourceType;

const CLINICAL_BULK_TYPES = new Set<FhirClinicalBulkResourceType>([
  "Encounter",
  "Observation",
  "MedicationRequest",
  "ServiceRequest",
  "DiagnosticReport",
]);
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
    private readonly clinicalBulk: FhirClinicalBulkService,
  ) {}

  async patient(context: SmartAccessContext, patientId: string): Promise<FhirResource> {
    this.assertSystem(context);
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      include: { user: { select: { email: true, status: true, updatedAt: true } } },
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
        include: { user: { select: { email: true, status: true, updatedAt: true } } },
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

  async bulkExportSnapshot(
    context: SmartAccessContext,
    resourceTypes: FhirBulkResourceType[],
    since: Date | null,
    maxResourcesPerType: number,
  ): Promise<{ transactionTime: string; resources: Partial<Record<FhirBulkResourceType, FhirResource[]>> }> {
    this.assertSystem(context);
    if (!Number.isInteger(maxResourcesPerType) || maxResourcesPerType < 1) throw new BadRequestException("FHIR bulk export resource limit is invalid.");
    const transactionTime = new Date();
    const resources: Partial<Record<FhirBulkResourceType, FhirResource[]>> = {};

    await this.prisma.$transaction(async (tx) => {
      for (const resourceType of resourceTypes) {
        if (resourceType === "Patient") {
          const where: Prisma.PatientProfileWhereInput = since
            ? { OR: [{ updatedAt: { gt: since } }, { user: { updatedAt: { gt: since } } }] }
            : {};
          const total = await tx.patientProfile.count({ where });
          this.assertBulkLimit(resourceType, total, maxResourcesPerType);
          const patients = await tx.patientProfile.findMany({
            where,
            include: { user: { select: { email: true, status: true, updatedAt: true } } },
            orderBy: { id: "asc" },
          });
          resources.Patient = patients.map((patient) => this.toPatient(patient));
          continue;
        }

        if (resourceType === "Appointment") {
          const where: Prisma.AppointmentWhereInput = since ? { updatedAt: { gt: since } } : {};
          const total = await tx.appointment.count({ where });
          this.assertBulkLimit(resourceType, total, maxResourcesPerType);
          const appointments = await tx.appointment.findMany({
            where,
            include: this.appointmentInclude(),
            orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          });
          resources.Appointment = appointments.map((appointment) => this.toAppointment(appointment));
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const clinicalTypes = resourceTypes.filter(
      (resourceType): resourceType is FhirClinicalBulkResourceType => CLINICAL_BULK_TYPES.has(resourceType as FhirClinicalBulkResourceType),
    );
    if (clinicalTypes.length > 0) {
      Object.assign(
        resources,
        await this.clinicalBulk.snapshot(context, clinicalTypes, since, transactionTime, maxResourcesPerType),
      );
    }
    return { transactionTime: transactionTime.toISOString(), resources };
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
    updatedAt: Date;
    user: { email: string; status: string; updatedAt: Date };
  }): FhirResource {
    const lastUpdated = patient.updatedAt > patient.user.updatedAt ? patient.updatedAt : patient.user.updatedAt;
    return {
      resourceType: "Patient",
      id: patient.id,
      meta: {
        profile: ["http://hl7.org/fhir/StructureDefinition/Patient"],
        lastUpdated: lastUpdated.toISOString(),
      },
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
    updatedAt: Date;
    cancellationReason: string | null;
    patient: { id: string; firstName: string; lastName: string };
    provider: { id: string; displayName: string };
    service: { id: string; name: string };
  }): FhirResource {
    return {
      resourceType: "Appointment",
      id: appointment.id,
      meta: { lastUpdated: appointment.updatedAt.toISOString() },
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

  private assertBulkLimit(resourceType: FhirBulkResourceType, total: number, maxResourcesPerType: number): void {
    if (total > maxResourcesPerType) {
      throw new ConflictException(`FHIR bulk export for ${resourceType} exceeded the current safety limit of ${maxResourcesPerType} resources.`);
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
