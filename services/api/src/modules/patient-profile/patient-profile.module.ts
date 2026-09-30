import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Patch,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { CurrentPrincipal } from "../../security/api-security.module";

interface PatientProfileUpdateBody {
  firstName: string;
  lastName: string;
  phone?: string | null;
  expectedUpdatedAt: string;
}

@Injectable()
class PatientProfileSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async get(principal: AuthPrincipal) {
    this.assertPatient(principal);
    const profile = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!profile) throw new NotFoundException("Patient profile not found.");
    return this.present(profile);
  }

  async update(principal: AuthPrincipal, input: PatientProfileUpdateBody) {
    this.assertPatient(principal);
    const firstName = this.name(input?.firstName, "firstName");
    const lastName = this.name(input?.lastName, "lastName");
    const phone = this.phone(input?.phone);
    const expectedUpdatedAt = this.expectedTimestamp(input?.expectedUpdatedAt);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.patientProfile.findUnique({ where: { userId: principal.accountId } });
      if (!current) throw new NotFoundException("Patient profile not found.");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("Patient profile changed. Reload before saving.");
      }

      const changedFields: string[] = [];
      if (current.firstName !== firstName) changedFields.push("firstName");
      if (current.lastName !== lastName) changedFields.push("lastName");
      if (current.phone !== phone) changedFields.push("phone");
      if (changedFields.length === 0) return this.present(current);

      const changed = await tx.patientProfile.updateMany({
        where: {
          id: current.id,
          userId: principal.accountId,
          updatedAt: expectedUpdatedAt,
        },
        data: { firstName, lastName, phone },
      });
      if (changed.count !== 1) {
        throw new ConflictException("Patient profile changed. Reload before saving.");
      }

      const updated = await tx.patientProfile.findUnique({ where: { id: current.id } });
      if (!updated) throw new NotFoundException("Patient profile not found.");
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_PROFILE_UPDATED",
        objectType: "PATIENT_PROFILE",
        objectId: current.id,
        purpose: "PATIENT_SELF_SERVICE",
        result: "SUCCESS",
        metadata: { changedFields },
      });
      return this.present(updated);
    });
  }

  private assertPatient(principal: AuthPrincipal): void {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient profile access requires PATIENT role.");
  }

  private name(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim();
    if (normalized.length < 1 || normalized.length > 100) {
      throw new BadRequestException(`${field} must contain between 1 and 100 characters.`);
    }
    if (/\p{Cc}/u.test(normalized)) throw new BadRequestException(`${field} contains invalid control characters.`);
    return normalized;
  }

  private phone(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new BadRequestException("phone must be text or null.");
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > 40 || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException("phone must contain at most 40 valid characters.");
    }
    return normalized;
  }

  private expectedTimestamp(value: unknown): Date {
    if (typeof value !== "string" || value.length < 20 || value.length > 40) {
      throw new BadRequestException("expectedUpdatedAt must be an ISO timestamp.");
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException("expectedUpdatedAt must be an ISO timestamp.");
    return parsed;
  }

  private present(profile: {
    firstName: string;
    lastName: string;
    phone: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}

@Controller("iam/patient-profile")
class PatientProfileController {
  constructor(private readonly profiles: PatientProfileSelfService) {}

  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.profiles.get(principal);
  }

  @Patch()
  update(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: PatientProfileUpdateBody) {
    return this.profiles.update(principal, body);
  }
}

@Module({
  controllers: [PatientProfileController],
  providers: [PatientProfileSelfService],
})
export class PatientProfileModule {}
