import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const AccessNeedCodes = [
  "WHEELCHAIR",
  "MOBILITY_ASSISTANCE",
  "STEP_FREE_ACCESS",
  "ACCESSIBLE_TRANSPORT",
  "HEARING_SUPPORT",
  "VISUAL_SUPPORT",
  "SIGN_LANGUAGE",
  "COMMUNICATION_SUPPORT",
  "CAREGIVER_SUPPORT",
  "HOME_VISIT_SUPPORT",
] as const;

type AccessNeedCode = (typeof AccessNeedCodes)[number];

interface UpdateAccessNeedsInput {
  needs: string[];
  note?: string | null;
  expectedVersion: number;
}

@Injectable()
export class AccessNeedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async getMine(principal: AuthPrincipal) {
    const patientId = await this.patientId(principal);
    const row = await this.prisma.patientAccessNeed.findUnique({ where: { patientId } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_ACCESS_NEEDS_VIEWED",
      objectType: "PATIENT_ACCESS_NEED",
      objectId: row?.id ?? patientId,
      purpose: "PATIENT_SELF_SERVICE",
      result: "SUCCESS",
      metadata: { configured: Boolean(row), version: row?.version ?? 0 },
    });
    return row ? this.present(row) : this.empty();
  }

  async updateMine(principal: AuthPrincipal, input: UpdateAccessNeedsInput) {
    const patientId = await this.patientId(principal);
    const needs = this.needs(input?.needs);
    const note = this.note(input?.note);
    const expectedVersion = this.expectedVersion(input?.expectedVersion);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.patientAccessNeed.findUnique({ where: { patientId } });
      if (!current) {
        if (expectedVersion !== 0) throw new ConflictException("Access needs changed. Reload before saving.");
        const created = await tx.patientAccessNeed.create({
          data: {
            patientId,
            needs,
            note,
            version: 1,
            updatedByActorId: principal.accountId,
          },
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "PATIENT_ACCESS_NEEDS_UPDATED",
          objectType: "PATIENT_ACCESS_NEED",
          objectId: created.id,
          purpose: "PATIENT_SELF_SERVICE",
          result: "SUCCESS",
          metadata: { version: 1, needCount: needs.length, hasNote: note !== null },
        });
        return this.present(created);
      }

      if (current.version !== expectedVersion) throw new ConflictException("Access needs changed. Reload before saving.");
      const currentNeeds = Array.isArray(current.needs) ? current.needs.map(String) : [];
      const sameNeeds = currentNeeds.length === needs.length && currentNeeds.every((value, index) => value === needs[index]);
      if (sameNeeds && current.note === note) return this.present(current);

      const nextVersion = current.version + 1;
      const changed = await tx.patientAccessNeed.updateMany({
        where: { id: current.id, patientId, version: expectedVersion },
        data: { needs, note, version: nextVersion, updatedByActorId: principal.accountId },
      });
      if (changed.count !== 1) throw new ConflictException("Access needs changed. Reload before saving.");
      const updated = await tx.patientAccessNeed.findUniqueOrThrow({ where: { id: current.id } });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_ACCESS_NEEDS_UPDATED",
        objectType: "PATIENT_ACCESS_NEED",
        objectId: current.id,
        purpose: "PATIENT_SELF_SERVICE",
        result: "SUCCESS",
        metadata: { version: nextVersion, needCount: needs.length, hasNote: note !== null },
      });
      return this.present(updated);
    });
  }

  async appointmentSnapshot(principal: AuthPrincipal, appointmentId: string) {
    const id = this.identifier(appointmentId, "appointmentId");
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: { id: true, patientId: true, providerId: true, modality: true },
    });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    await this.assertProviderOwns(principal, appointment.providerId);
    return this.snapshot(principal, "APPOINTMENT", appointment.id, appointment.patientId, appointment.modality);
  }

  async transportSnapshot(principal: AuthPrincipal, transportRequestId: string) {
    const id = this.identifier(transportRequestId, "transportRequestId");
    const request = await this.prisma.medicalTransportRequest.findUnique({
      where: { id },
      select: { id: true, patientId: true, assignedProviderId: true, assistance: true },
    });
    if (!request) throw new NotFoundException("Medical transport request not found.");
    if (principal.role !== "ADMIN") {
      if (!request.assignedProviderId) throw new ForbiddenException("Transport access needs are available after assignment.");
      await this.assertProviderOwns(principal, request.assignedProviderId);
    }
    return this.snapshot(principal, "MEDICAL_TRANSPORT", request.id, request.patientId, request.assistance);
  }

  private async snapshot(
    principal: AuthPrincipal,
    contextType: "APPOINTMENT" | "MEDICAL_TRANSPORT",
    contextId: string,
    patientId: string,
    operationalMode: string,
  ) {
    const row = await this.prisma.operationalAccessNeedSnapshot.findUnique({
      where: { contextType_contextId: { contextType, contextId } },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "OPERATIONAL_ACCESS_NEEDS_VIEWED",
      objectType: contextType,
      objectId: contextId,
      purpose: "CARE_DELIVERY",
      result: "SUCCESS",
      metadata: { contextType, sourceVersion: row?.sourceVersion ?? 0, operationalMode },
    });
    return {
      contextType,
      contextId,
      operationalMode,
      needs: row && Array.isArray(row.needs) ? row.needs.map(String) : [],
      sourceVersion: row?.sourceVersion ?? 0,
      capturedAt: row?.createdAt.toISOString() ?? null,
    };
  }

  private async patientId(principal: AuthPrincipal): Promise<string> {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Access needs require PATIENT role.");
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException("Patient profile not found.");
    return profile.id;
  }

  private async assertProviderOwns(principal: AuthPrincipal, providerId: string): Promise<void> {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Provider access is required.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!provider || provider.id !== providerId) throw new ForbiddenException("This operational context belongs to another provider.");
  }

  private needs(value: unknown): AccessNeedCode[] {
    if (!Array.isArray(value)) throw new BadRequestException("needs must be an array.");
    if (value.length > 16) throw new BadRequestException("Too many access needs were supplied.");
    const normalized: AccessNeedCode[] = [];
    for (const raw of value) {
      if (typeof raw !== "string") throw new BadRequestException("Each access need must be text.");
      const code = raw.trim().toUpperCase();
      if (!(AccessNeedCodes as readonly string[]).includes(code)) throw new BadRequestException(`Unsupported access need: ${code}.`);
      if (!normalized.includes(code as AccessNeedCode)) normalized.push(code as AccessNeedCode);
    }
    return normalized.sort((a, b) => AccessNeedCodes.indexOf(a) - AccessNeedCodes.indexOf(b));
  }

  private note(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new BadRequestException("note must be text or null.");
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized) return null;
    if (normalized.length > 500 || /\p{Cc}/u.test(normalized)) throw new BadRequestException("note is invalid.");
    return normalized;
  }

  private expectedVersion(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1_000_000) {
      throw new BadRequestException("expectedVersion must be a non-negative integer.");
    }
    return Number(value);
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length < 8 || value.length > 80 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value;
  }

  private empty() {
    return { needs: [] as string[], note: null as string | null, version: 0, updatedAt: null as string | null };
  }

  private present(row: { needs: unknown; note: string | null; version: number; updatedAt: Date }) {
    return {
      needs: Array.isArray(row.needs) ? row.needs.map(String) : [],
      note: row.note,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

@RequirePermissions("PATIENT_MANAGE_ACCESS_NEEDS")
@Controller("patient/access-needs")
class PatientAccessNeedsController {
  constructor(private readonly service: AccessNeedsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.getMine(principal);
  }

  @Patch()
  @Header("Cache-Control", "no-store")
  update(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: UpdateAccessNeedsInput) {
    return this.service.updateMine(principal, body);
  }
}

@Controller("provider/operational-access-needs")
class ProviderOperationalAccessNeedsController {
  constructor(private readonly service: AccessNeedsService) {}

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Get("appointments/:appointmentId")
  @Header("Cache-Control", "no-store")
  appointment(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.service.appointmentSnapshot(principal, appointmentId);
  }

  @RequirePermissions("TRANSPORT_RESPOND", "TRANSPORT_OPERATE")
  @Get("transport/:transportRequestId")
  @Header("Cache-Control", "no-store")
  transport(@CurrentPrincipal() principal: AuthPrincipal, @Param("transportRequestId") transportRequestId: string) {
    return this.service.transportSnapshot(principal, transportRequestId);
  }
}

@Module({
  controllers: [PatientAccessNeedsController, ProviderOperationalAccessNeedsController],
  providers: [AccessNeedsService],
  exports: [AccessNeedsService],
})
export class AccessNeedsModule {}
