import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  InternalServerErrorException,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";

interface CreateEmergencyContactInput {
  displayName: string;
  relationship: string;
  phone: string;
  priority: number;
}

interface UpdateEmergencyContactInput extends Partial<CreateEmergencyContactInput> {
  expectedUpdatedAt: string;
}

type EmergencyContactPayload = {
  schemaVersion: 1;
  displayName: string;
  relationship: string;
  phone: string;
};

type EmergencyContactRow = {
  id: string;
  patientId: string;
  displayName: string;
  relationship: string;
  phone: string;
  algorithm: string | null;
  keyId: string | null;
  wrappedKey: string | null;
  iv: string | null;
  ciphertext: string | null;
  priority: number;
  status: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const ENCRYPTED_SENTINEL = "__ENCRYPTED__";

@Injectable()
class EmergencyContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async list(principal: AuthPrincipal) {
    const patientId = await this.patientId(principal);
    const rows = await this.prisma.emergencyContact.findMany({
      where: { patientId, status: "ACTIVE" },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: 10,
    });

    const items: Array<{
      id: string;
      displayName: string;
      relationship: string;
      phone: string;
      priority: number;
      status: string;
      revokedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }> = [];
    for (const row of rows) {
      const upgraded = await this.upgradeLegacyRow(row as EmergencyContactRow, principal.accountId);
      items.push(this.present(upgraded.row, upgraded.payload));
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_EMERGENCY_CONTACTS_VIEWED",
      objectType: "PATIENT_PROFILE",
      objectId: patientId,
      purpose: "PATIENT_SELF_SERVICE",
      result: "SUCCESS",
      metadata: { activeCount: items.length },
    });
    return items;
  }

  async create(principal: AuthPrincipal, input: CreateEmergencyContactInput) {
    const patientId = await this.patientId(principal);
    const normalized = this.normalize(input);
    const protectedFields = await this.encryptPayload(normalized);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.emergencyContact.count({ where: { patientId, status: "ACTIVE" } });
      if (count >= 10) throw new ConflictException("A patient can have at most 10 active emergency contacts.");
      const priorityOwner = await tx.emergencyContact.findFirst({
        where: { patientId, status: "ACTIVE", priority: normalized.priority },
        select: { id: true },
      });
      if (priorityOwner) throw new ConflictException("That emergency-contact priority is already in use.");
      const created = await tx.emergencyContact.create({
        data: {
          patientId,
          displayName: ENCRYPTED_SENTINEL,
          relationship: ENCRYPTED_SENTINEL,
          phone: ENCRYPTED_SENTINEL,
          priority: normalized.priority,
          ...protectedFields,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_EMERGENCY_CONTACT_CREATED",
        objectType: "EMERGENCY_CONTACT",
        objectId: created.id,
        purpose: "PATIENT_SELF_SERVICE",
        result: "SUCCESS",
        metadata: { priority: created.priority, protectedAtRest: true },
      });
      return this.present(created as EmergencyContactRow, normalized);
    });
  }

  async update(principal: AuthPrincipal, contactId: string, input: UpdateEmergencyContactInput) {
    const patientId = await this.patientId(principal);
    const id = this.identifier(contactId);
    const expectedUpdatedAt = this.timestamp(input?.expectedUpdatedAt);
    const current = await this.prisma.emergencyContact.findFirst({ where: { id, patientId, status: "ACTIVE" } });
    if (!current) throw new NotFoundException("Emergency contact not found.");
    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new ConflictException("Emergency contact changed. Reload before saving.");
    }

    const currentPayload = await this.readPayload(current as EmergencyContactRow);
    const normalized = this.normalize({
      displayName: input.displayName ?? currentPayload.displayName,
      relationship: input.relationship ?? currentPayload.relationship,
      phone: input.phone ?? currentPayload.phone,
      priority: input.priority ?? current.priority,
    });
    const changedFields = (["displayName", "relationship", "phone", "priority"] as const)
      .filter((key) => key === "priority"
        ? current.priority !== normalized.priority
        : currentPayload[key] !== normalized[key]);

    if (normalized.priority !== current.priority) {
      const priorityOwner = await this.prisma.emergencyContact.findFirst({
        where: { patientId, status: "ACTIVE", priority: normalized.priority, NOT: { id } },
        select: { id: true },
      });
      if (priorityOwner) throw new ConflictException("That emergency-contact priority is already in use.");
    }

    const requiresProtection = !this.isEncrypted(current as EmergencyContactRow);
    if (changedFields.length === 0 && !requiresProtection) {
      return this.present(current as EmergencyContactRow, currentPayload);
    }

    const protectedFields = await this.encryptPayload(normalized);
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.emergencyContact.findFirst({ where: { id, patientId, status: "ACTIVE" } });
      if (!fresh) throw new NotFoundException("Emergency contact not found.");
      if (fresh.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("Emergency contact changed. Reload before saving.");
      }
      const updated = await tx.emergencyContact.update({
        where: { id },
        data: {
          displayName: ENCRYPTED_SENTINEL,
          relationship: ENCRYPTED_SENTINEL,
          phone: ENCRYPTED_SENTINEL,
          priority: normalized.priority,
          ...protectedFields,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: changedFields.length > 0 ? "PATIENT_EMERGENCY_CONTACT_UPDATED" : "PATIENT_EMERGENCY_CONTACT_ENCRYPTED",
        objectType: "EMERGENCY_CONTACT",
        objectId: id,
        purpose: "PATIENT_SELF_SERVICE",
        result: "SUCCESS",
        metadata: {
          changedFields,
          priority: updated.priority,
          protectedAtRest: true,
        },
      });
      return this.present(updated as EmergencyContactRow, normalized);
    });
  }

  async revoke(principal: AuthPrincipal, contactId: string) {
    const patientId = await this.patientId(principal);
    const id = this.identifier(contactId);
    const current = await this.prisma.emergencyContact.findFirst({ where: { id, patientId, status: "ACTIVE" } });
    if (!current) throw new NotFoundException("Emergency contact not found.");
    const payload = await this.readPayload(current as EmergencyContactRow);
    const protection = this.isEncrypted(current as EmergencyContactRow)
      ? {}
      : await this.encryptPayload(payload);

    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.emergencyContact.findFirst({ where: { id, patientId, status: "ACTIVE" } });
      if (!fresh) throw new NotFoundException("Emergency contact not found.");
      const revoked = await tx.emergencyContact.update({
        where: { id },
        data: {
          status: "REVOKED",
          revokedAt: new Date(),
          ...(this.isEncrypted(fresh as EmergencyContactRow) ? {} : {
            displayName: ENCRYPTED_SENTINEL,
            relationship: ENCRYPTED_SENTINEL,
            phone: ENCRYPTED_SENTINEL,
            ...protection,
          }),
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_EMERGENCY_CONTACT_REVOKED",
        objectType: "EMERGENCY_CONTACT",
        objectId: id,
        purpose: "PATIENT_SELF_SERVICE",
        result: "SUCCESS",
        metadata: { formerPriority: current.priority, protectedAtRest: true },
      });
      return this.present(revoked as EmergencyContactRow, payload);
    });
  }

  private async upgradeLegacyRow(row: EmergencyContactRow, actorId: string) {
    if (this.isEncrypted(row)) {
      return { row, payload: await this.readPayload(row) };
    }
    const normalized = this.normalize({
      displayName: row.displayName,
      relationship: row.relationship,
      phone: row.phone,
      priority: row.priority,
    });
    const protectedFields = await this.encryptPayload(normalized);
    const migrated = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.emergencyContact.findUnique({ where: { id: row.id } });
      if (!fresh) throw new NotFoundException("Emergency contact not found.");
      if (this.isEncrypted(fresh as EmergencyContactRow)) return fresh;
      const updated = await tx.emergencyContact.update({
        where: { id: row.id },
        data: {
          displayName: ENCRYPTED_SENTINEL,
          relationship: ENCRYPTED_SENTINEL,
          phone: ENCRYPTED_SENTINEL,
          ...protectedFields,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId,
        action: "PATIENT_EMERGENCY_CONTACT_ENCRYPTED",
        objectType: "EMERGENCY_CONTACT",
        objectId: row.id,
        purpose: "PRIVACY_MIGRATION",
        result: "SUCCESS",
        metadata: { protectedAtRest: true },
      });
      return updated;
    });
    return { row: migrated as EmergencyContactRow, payload: normalized };
  }

  private async encryptPayload(value: { displayName: string; relationship: string; phone: string }) {
    const envelope = await this.envelope.encryptRecord({
      schemaVersion: 1,
      displayName: value.displayName,
      relationship: value.relationship,
      phone: value.phone,
    });
    return this.envelopeFields(envelope);
  }

  private envelopeFields(envelope: EncryptedEnvelope) {
    return {
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      wrappedKey: envelope.wrappedKey,
      iv: envelope.iv,
      ciphertext: envelope.ciphertext,
    };
  }

  private isEncrypted(row: EmergencyContactRow): boolean {
    return Boolean(row.algorithm && row.keyId && row.wrappedKey && row.iv && row.ciphertext);
  }

  private async readPayload(row: EmergencyContactRow): Promise<EmergencyContactPayload> {
    if (!this.isEncrypted(row)) {
      const normalized = this.normalize({
        displayName: row.displayName,
        relationship: row.relationship,
        phone: row.phone,
        priority: row.priority,
      });
      return {
        schemaVersion: 1,
        displayName: normalized.displayName,
        relationship: normalized.relationship,
        phone: normalized.phone,
      };
    }
    const payload = await this.envelope.decryptRecord<EmergencyContactPayload>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId!,
      wrappedKey: row.wrappedKey!,
      iv: row.iv!,
      ciphertext: row.ciphertext!,
    });
    if (payload?.schemaVersion !== 1) {
      throw new InternalServerErrorException("Emergency contact protected payload is invalid.");
    }
    const normalized = this.normalize({
      displayName: payload.displayName,
      relationship: payload.relationship,
      phone: payload.phone,
      priority: row.priority,
    });
    return {
      schemaVersion: 1,
      displayName: normalized.displayName,
      relationship: normalized.relationship,
      phone: normalized.phone,
    };
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

  private present(row: EmergencyContactRow, payload: { displayName: string; relationship: string; phone: string }) {
    return {
      id: row.id,
      displayName: payload.displayName,
      relationship: payload.relationship,
      phone: payload.phone,
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
  imports: [ClinicalModule],
  controllers: [EmergencyContactsController],
  providers: [EmergencyContactsService],
})
export class EmergencyContactsModule {}
