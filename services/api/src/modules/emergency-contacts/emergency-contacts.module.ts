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
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

interface CreateEmergencyContactInput {
  displayName: string;
  relationship: string;
  phone: string;
  priority: number;
}

interface UpdateEmergencyContactInput extends Partial<CreateEmergencyContactInput> {
  expectedUpdatedAt: string;
}

@Injectable()
class EmergencyContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async list(principal: AuthPrincipal) {
    const patientId = await this.patientId(principal);
    const rows = await this.prisma.emergencyContact.findMany({
      where: { patientId, status: "ACTIVE" },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: 10,
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_EMERGENCY_CONTACTS_VIEWED",
      objectType: "PATIENT_PROFILE",
      objectId: patientId,
      purpose: "PATIENT_SELF_SERVICE",
      result: "SUCCESS",
      metadata: { activeCount: rows.length },
    });
    return rows.map((row) => this.present(row));
  }

  async create(principal: AuthPrincipal, input: CreateEmergencyContactInput) {
    const patientId = await this.patientId(principal);
    const normalized = this.normalize(input);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.emergencyContact.count({ where: { patientId, status: "ACTIVE" } });
      if (count >= 10) throw new ConflictException("A patient can have at most 10 active emergency contacts.");
      const priorityOwner = await tx.emergencyContact.findFirst({
        where: { patientId, status: "ACTIVE", priority: normalized.priority },
        select: { id: true },
      });
      if (priorityOwner) throw new ConflictException("That emergency-contact priority is already in use.");
      const created = await tx.emergencyContact.create({
        data: { patientId, ...normalized },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_EMERGENCY_CONTACT_CREATED",
        objectType: "EMERGENCY_CONTACT",
        objectId: created.id,
        purpose: "PATIENT_SELF_SERVICE",
        result: "SUCCESS",
        metadata: { priority: created.priority },
      });
      return this.present(created);
    });
  }

  async update(principal: AuthPrincipal, contactId: string, input: UpdateEmergencyContactInput) {
    const patientId = await this.patientId(principal);
    const id = this.identifier(contactId);
    const expectedUpdatedAt = this.timestamp(input?.expectedUpdatedAt);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.emergencyContact.findFirst({ where: { id, patientId, status: "ACTIVE" } });
      if (!current) throw new NotFoundException("Emergency contact not found.");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("Emergency contact changed. Reload before saving.");
      }
      const normalized = this.normalize({
        displayName: input.displayName ?? current.displayName,
        relationship: input.relationship ?? current.relationship,
        phone: input.phone ?? current.phone,
        priority: input.priority ?? current.priority,
      });
      if (normalized.priority !== current.priority) {
        const priorityOwner = await tx.emergencyContact.findFirst({
          where: { patientId, status: "ACTIVE", priority: normalized.priority, NOT: { id } },
          select: { id: true },
        });
        if (priorityOwner) throw new ConflictException("That emergency-contact priority is already in use.");
      }
      const changedFields = (Object.keys(normalized) as (keyof typeof normalized)[])
        .filter((key) => current[key] !== normalized[key]);
      if (changedFields.length === 0) return this.present(current);
      const updated = await tx.emergencyContact.update({
        where: { id },
        data: normalized,
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_EMERGENCY_CONTACT_UPDATED",
        objectType: "EMERGENCY_CONTACT",
        objectId: id,
        purpose: "PATIENT_SELF_SERVICE",
        result: "SUCCESS",
        metadata: { changedFields, priority: updated.priority },
      });
      return this.present(updated);
    });
  }

  async revoke(principal: AuthPrincipal, contactId: string) {
    const patientId = await this.patientId(principal);
    const id = this.identifier(contactId);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.emergencyContact.findFirst({ where: { id, patientId, status: "ACTIVE" } });
      if (!current) throw new NotFoundException("Emergency contact not found.");
      const revoked = await tx.emergencyContact.update({
        where: { id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_EMERGENCY_CONTACT_REVOKED",
        objectType: "EMERGENCY_CONTACT",
        objectId: id,
        purpose: "PATIENT_SELF_SERVICE",
        result: "SUCCESS",
        metadata: { formerPriority: current.priority },
      });
      return this.present(revoked);
    });
  }

  private async patientId(principal: AuthPrincipal): Promise<string> {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Emergency contacts require PATIENT role.");
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException("Patient profile not found.");
    return profile.id;
  }

  private normalize(input: CreateEmergencyContactInput) {
    return {
      displayName: this.text(input?.displayName, "displayName", 120),
      relationship: this.text(input?.relationship, "relationship", 80),
      phone: this.phone(input?.phone),
      priority: this.priority(input?.priority),
    };
  }

  private text(value: unknown, field: string, max: number): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private phone(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("phone must be text.");
    const normalized = value.trim().replace(/\s+/g, " ");
    const digitCount = normalized.replace(/\D/g, "").length;
    if (!normalized || normalized.length > 40 || digitCount < 7 || digitCount > 18 || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException("phone is invalid.");
    }
    if (!/^[+0-9() .\-xX#]+$/.test(normalized)) throw new BadRequestException("phone is invalid.");
    return normalized;
  }

  private priority(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10) {
      throw new BadRequestException("priority must be an integer between 1 and 10.");
    }
    return Number(value);
  }

  private timestamp(value: unknown): Date {
    if (typeof value !== "string" || value.length < 20 || value.length > 40) {
      throw new BadRequestException("expectedUpdatedAt must be an ISO timestamp.");
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException("expectedUpdatedAt must be an ISO timestamp.");
    return parsed;
  }

  private identifier(value: unknown): string {
    if (typeof value !== "string" || value.length < 8 || value.length > 80 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new BadRequestException("Invalid emergency contact identifier.");
    }
    return value;
  }

  private present(row: {
    id: string;
    displayName: string;
    relationship: string;
    phone: string;
    priority: number;
    status: string;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      displayName: row.displayName,
      relationship: row.relationship,
      phone: row.phone,
      priority: row.priority,
      status: row.status,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

@RequirePermissions("PATIENT_MANAGE_EMERGENCY_CONTACTS")
@Controller("patient/emergency-contacts")
class EmergencyContactsController {
  constructor(private readonly contacts: EmergencyContactsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.contacts.list(principal);
  }

  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateEmergencyContactInput) {
    return this.contacts.create(principal, body);
  }

  @Patch(":contactId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("contactId") contactId: string,
    @Body() body: UpdateEmergencyContactInput,
  ) {
    return this.contacts.update(principal, contactId, body);
  }

  @Post(":contactId/revoke")
  @Header("Cache-Control", "no-store")
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("contactId") contactId: string) {
    return this.contacts.revoke(principal, contactId);
  }
}

@Module({
  controllers: [EmergencyContactsController],
  providers: [EmergencyContactsService],
})
export class EmergencyContactsModule {}
