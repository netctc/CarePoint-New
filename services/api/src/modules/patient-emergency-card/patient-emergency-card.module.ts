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
  Patch,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ClinicalModule } from "../clinical/clinical.module";

type StoredClinicalProfileEntry = {
  schemaVersion: 1;
  payload: Record<string, unknown>;
};

interface UpdateEmergencyCardSettingsInput {
  expectedVersion: number;
  includeSevereAllergies: boolean;
  includeActiveMedications: boolean;
  includeActiveConditions: boolean;
  emergencyContactId?: string | null;
}

@Injectable()
class PatientEmergencyCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async settings(principal: AuthPrincipal) {
    const patientId = await this.patientId(principal);
    const [preference, contacts] = await Promise.all([
      this.prisma.emergencyHealthCardPreference.findUnique({ where: { patientId } }),
      this.prisma.emergencyContact.findMany({
        where: { patientId, status: "ACTIVE" },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        take: 10,
      }),
    ]);
    return {
      patientId,
      preference: this.presentPreference(preference),
      contacts: contacts.map((contact) => ({
        id: contact.id,
        displayName: contact.displayName,
        relationship: contact.relationship,
        phone: contact.phone,
        priority: contact.priority,
        updatedAt: contact.updatedAt,
      })),
      privacyByDefault: true,
    };
  }

  async updateSettings(principal: AuthPrincipal, input: UpdateEmergencyCardSettingsInput) {
    const patientId = await this.patientId(principal);
    const expectedVersion = this.nonNegativeInteger(input?.expectedVersion, "expectedVersion");
    const next = {
      includeSevereAllergies: this.boolean(input?.includeSevereAllergies, "includeSevereAllergies"),
      includeActiveMedications: this.boolean(input?.includeActiveMedications, "includeActiveMedications"),
      includeActiveConditions: this.boolean(input?.includeActiveConditions, "includeActiveConditions"),
      emergencyContactId: this.optionalId(input?.emergencyContactId, "emergencyContactId"),
    };

    if (next.emergencyContactId) {
      const contact = await this.prisma.emergencyContact.findFirst({
        where: { id: next.emergencyContactId, patientId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!contact) throw new BadRequestException("Selected emergency contact is not active for this patient.");
    }

    const observed = await this.prisma.emergencyHealthCardPreference.findUnique({ where: { patientId } });
    if ((observed?.version ?? 0) !== expectedVersion) {
      throw new ConflictException({
        message: "Emergency card preferences changed. Reload before saving.",
        currentVersion: observed?.version ?? 0,
      });
    }
    const version = expectedVersion + 1;
    const row = observed
      ? await this.prisma.emergencyHealthCardPreference.update({
          where: { patientId },
          data: { ...next, version },
        })
      : await this.prisma.emergencyHealthCardPreference.create({
          data: { patientId, ...next, version },
        });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_EMERGENCY_CARD_SETTINGS_UPDATED",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "EMERGENCY_HEALTH_CARD",
        patientId,
        resourceVersion: row.version,
        enabledSections: [
          ...(row.includeSevereAllergies ? ["SEVERE_ALLERGIES"] : []),
          ...(row.includeActiveMedications ? ["ACTIVE_MEDICATIONS"] : []),
          ...(row.includeActiveConditions ? ["ACTIVE_CONDITIONS"] : []),
          ...(row.emergencyContactId ? ["EMERGENCY_CONTACT"] : []),
        ],
        decision: "ALLOW",
      },
    });
    return this.settings(principal);
  }

  async card(principal: AuthPrincipal) {
    const patientId = await this.patientId(principal);
    const preference = await this.prisma.emergencyHealthCardPreference.findUnique({ where: { patientId } });
    if (!preference) {
      await this.auditRead(principal, patientId, 0, 0, 0, false);
      return this.emptyCard(patientId);
    }

    const kinds = [
      ...(preference.includeSevereAllergies ? ["ALLERGY"] : []),
      ...(preference.includeActiveMedications ? ["MEDICATION"] : []),
      ...(preference.includeActiveConditions ? ["CONDITION"] : []),
    ];
    const [entries, contact] = await Promise.all([
      kinds.length === 0
        ? Promise.resolve([])
        : this.prisma.clinicalProfileEntry.findMany({
            where: { patientId, status: "ACTIVE", kind: { in: kinds } },
            orderBy: { updatedAt: "desc" },
            take: 100,
          }),
      preference.emergencyContactId
        ? this.prisma.emergencyContact.findFirst({
            where: { id: preference.emergencyContactId, patientId, status: "ACTIVE" },
          })
        : Promise.resolve(null),
    ]);

    const allergies: Array<Record<string, unknown>> = [];
    const medications: Array<Record<string, unknown>> = [];
    const conditions: Array<Record<string, unknown>> = [];
    const sourceDates: Date[] = [preference.updatedAt];
    for (const row of entries) {
      const stored = await this.decrypt(row);
      const payload = stored.payload ?? {};
      if (
        row.kind === "ALLERGY" &&
        preference.includeSevereAllergies &&
        payload.severity === "SEVERE"
      ) {
        allergies.push({
          id: row.id,
          substance: this.textOrNull(payload.substance),
          reaction: this.textOrNull(payload.reaction),
          severity: "SEVERE",
          sourceType: row.sourceType,
          verificationStatus: row.verificationStatus,
          recordedAt: row.updatedAt,
        });
        sourceDates.push(row.updatedAt);
      } else if (
        row.kind === "MEDICATION" &&
        preference.includeActiveMedications &&
        payload.medicationStatus === "ACTIVE"
      ) {
        medications.push({
          id: row.id,
          name: this.textOrNull(payload.name),
          dose: this.textOrNull(payload.dose),
          route: this.textOrNull(payload.route),
          frequency: this.textOrNull(payload.frequency),
          sourceType: row.sourceType,
          verificationStatus: row.verificationStatus,
          recordedAt: row.updatedAt,
        });
        sourceDates.push(row.updatedAt);
      } else if (
        row.kind === "CONDITION" &&
        preference.includeActiveConditions &&
        payload.clinicalStatus === "ACTIVE"
      ) {
        conditions.push({
          id: row.id,
          display: this.textOrNull(payload.display),
          sourceType: row.sourceType,
          verificationStatus: row.verificationStatus,
          recordedAt: row.updatedAt,
        });
        sourceDates.push(row.updatedAt);
      }
    }

    if (contact) sourceDates.push(contact.updatedAt);
    const updatedAt = new Date(Math.max(...sourceDates.map((value) => value.getTime())));
    await this.auditRead(
      principal,
      patientId,
      allergies.length,
      medications.length,
      conditions.length,
      Boolean(contact),
    );

    return {
      patientId,
      generatedAt: new Date(),
      updatedAt,
      patientControlled: true,
      privacyByDefault: true,
      documentsIncluded: false,
      preferencesVersion: preference.version,
      sections: {
        severeAllergies: preference.includeSevereAllergies ? allergies : [],
        activeMedications: preference.includeActiveMedications ? medications : [],
        activeConditions: preference.includeActiveConditions ? conditions : [],
        emergencyContact: contact
          ? {
              id: contact.id,
              displayName: contact.displayName,
              relationship: contact.relationship,
              phone: contact.phone,
              priority: contact.priority,
            }
          : null,
      },
    };
  }

  private emptyCard(patientId: string) {
    return {
      patientId,
      generatedAt: new Date(),
      updatedAt: null,
      patientControlled: true,
      privacyByDefault: true,
      documentsIncluded: false,
      preferencesVersion: 0,
      sections: {
        severeAllergies: [],
        activeMedications: [],
        activeConditions: [],
        emergencyContact: null,
      },
    };
  }

  private async auditRead(
    principal: AuthPrincipal,
    patientId: string,
    allergyCount: number,
    medicationCount: number,
    conditionCount: number,
    contactIncluded: boolean,
  ) {
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_EMERGENCY_CARD_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "EMERGENCY_HEALTH_CARD",
        patientId,
        allergyCount,
        medicationCount,
        conditionCount,
        contactIncluded,
        documentsIncluded: false,
        decision: "ALLOW",
      },
    });
  }

  private async patientId(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Emergency health card requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient.id;
  }

  private presentPreference(row: {
    version: number;
    includeSevereAllergies: boolean;
    includeActiveMedications: boolean;
    includeActiveConditions: boolean;
    emergencyContactId: string | null;
    updatedAt: Date;
  } | null) {
    return row
      ? {
          version: row.version,
          includeSevereAllergies: row.includeSevereAllergies,
          includeActiveMedications: row.includeActiveMedications,
          includeActiveConditions: row.includeActiveConditions,
          emergencyContactId: row.emergencyContactId,
          updatedAt: row.updatedAt,
        }
      : {
          version: 0,
          includeSevereAllergies: false,
          includeActiveMedications: false,
          includeActiveConditions: false,
          emergencyContactId: null,
          updatedAt: null,
        };
  }

  private decrypt(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    return this.envelope.decryptRecord<StoredClinicalProfileEntry>(this.asEnvelope(row));
  }

  private asEnvelope(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") {
      throw new ConflictException("Unsupported clinical profile encryption.");
    }
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    };
  }

  private boolean(value: unknown, field: string) {
    if (typeof value !== "boolean") throw new BadRequestException(`${field} must be boolean.`);
    return value;
  }

  private optionalId(value: unknown, field: string) {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private nonNegativeInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer.`);
    }
    return Number(value);
  }

  private textOrNull(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}

@Controller("patient/emergency-card")
class PatientEmergencyCardController {
  constructor(private readonly cards: PatientEmergencyCardService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get()
  @Header("Cache-Control", "no-store")
  card(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.cards.card(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get("settings")
  @Header("Cache-Control", "no-store")
  settings(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.cards.settings(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Patch("settings")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: UpdateEmergencyCardSettingsInput,
  ) {
    return this.cards.updateSettings(principal, body);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [PatientEmergencyCardController],
  providers: [PatientEmergencyCardService],
})
export class PatientEmergencyCardModule {}
