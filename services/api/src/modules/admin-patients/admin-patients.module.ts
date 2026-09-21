import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { AccountStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const DIRECTORY_PAGE_SIZE = 25;
const MAX_DIRECTORY_PAGE_SIZE = 100;
const ADMIN_PATIENT_SECURITY_ACTIONS = [
  "LOGIN_FAILED",
  "ACCOUNT_SUSPENDED",
  "AUTHORIZATION_DENIED",
  "MFA_CHALLENGE_REPLAY_DENIED",
  "REFRESH_TOKEN_REPLAY_DENIED",
] as const;

type PatientDirectoryQuery = {
  q?: string;
  status?: string;
  page?: string;
  pageSize?: string;
};

@Injectable()
class AdminPatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async directory(principal: AuthPrincipal, query: PatientDirectoryQuery) {
    this.requireAdmin(principal);
    const search = this.search(query.q);
    const status = this.accountStatus(query.status);
    const page = this.positiveInteger(query.page, 1, 10_000, "page");
    const pageSize = this.positiveInteger(query.pageSize, DIRECTORY_PAGE_SIZE, MAX_DIRECTORY_PAGE_SIZE, "pageSize");

    const where: Prisma.UserWhereInput = {
      role: "PATIENT",
      patientProfile: { isNot: null },
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { patientProfile: { is: { firstName: { contains: search, mode: "insensitive" } } } },
              { patientProfile: { is: { lastName: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const [total, accounts] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          failedLoginCount: true,
          lockedUntil: true,
          createdAt: true,
          updatedAt: true,
          mfaEnrollment: { select: { enabledAt: true } },
          patientProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              createdAt: true,
              updatedAt: true,
              consents: {
                where: { state: "GRANTED" },
                take: 1,
                select: { id: true },
              },
              _count: { select: { appointments: true } },
            },
          },
        },
      }),
    ]);

    const items = accounts.flatMap((account) => {
      const profile = account.patientProfile;
      if (!profile) return [];
      const operationalFlags = this.operationalFlags(account.status, account.lockedUntil, account.failedLoginCount);
      return [{
        patientId: profile.id,
        patientRef: this.reference("PAT", profile.id),
        displayName: `${profile.firstName} ${profile.lastName}`.trim(),
        accountStatus: account.status,
        verification: {
          mfaEnabled: Boolean(account.mfaEnrollment?.enabledAt),
          accountActive: account.status === "ACTIVE",
        },
        operationalFlags,
        hasActiveConsent: profile.consents.length > 0,
        appointmentCount: profile._count.appointments,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      }];
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PATIENT_DIRECTORY_VIEWED",
      objectType: "PATIENT_DIRECTORY",
      purpose: "ADMINISTRATIVE_PATIENT_SUPPORT",
      result: "SUCCESS",
      metadata: {
        page,
        pageSize,
        returned: items.length,
        total,
        statusFilterApplied: Boolean(status),
        searchApplied: Boolean(search),
        phiMinimized: true,
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      privacy: {
        phiMinimized: true,
        clinicalHealthProfileExcluded: true,
        diagnosesExcluded: true,
        medicationsExcluded: true,
        rawEmailExcluded: true,
        rawPhoneExcluded: true,
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      items,
    };
  }

  async detail(principal: AuthPrincipal, patientIdRaw: string) {
    this.requireAdmin(principal);
    const patientId = this.identifier(patientIdRaw, "patientId");
    const account = await this.prisma.user.findFirst({
      where: { role: "PATIENT", patientProfile: { is: { id: patientId } } },
      select: {
        id: true,
        email: true,
        status: true,
        failedLoginCount: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true,
        mfaEnrollment: { select: { enabledAt: true } },
        patientProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!account?.patientProfile) throw new NotFoundException("Patient account was not found.");

    const profile = account.patientProfile;
    const [dependentRelations, consents, coverages, incidents] = await Promise.all([
      this.prisma.dependentRelation.findMany({
        where: {
          OR: [
            { guardianAccountId: account.id },
            { dependentPatientId: profile.id },
          ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          guardianAccountId: true,
          dependentPatientId: true,
          relationshipType: true,
          status: true,
          validFrom: true,
          validUntil: true,
          verifiedAt: true,
          revokedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.consent.findMany({
        where: { patientId: profile.id },
        orderBy: [{ grantedAt: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true,
          providerId: true,
          scope: true,
          version: true,
          purpose: true,
          state: true,
          grantedAt: true,
          revokedAt: true,
          expiresAt: true,
        },
      }),
      this.prisma.insuranceCoverage.findMany({
        where: { patientId: profile.id },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          id: true,
          payerCode: true,
          payerName: true,
          externalPolicyRef: true,
          displayLabel: true,
          status: true,
          effectiveFrom: true,
          effectiveUntil: true,
          updatedAt: true,
        },
      }),
      this.prisma.auditEvent.findMany({
        where: {
          action: { in: [...ADMIN_PATIENT_SECURITY_ACTIONS] },
          OR: [
            { actorId: account.id },
            { objectType: "ACCOUNT", objectId: account.id },
          ],
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 25,
        select: { id: true, action: true, result: true, occurredAt: true },
      }),
    ]);

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PATIENT_ADMIN_DETAIL_VIEWED",
      objectType: "PATIENT_PROFILE",
      objectId: profile.id,
      purpose: "ADMINISTRATIVE_PATIENT_SUPPORT",
      result: "SUCCESS",
      metadata: {
        phiMinimized: true,
        clinicalHealthProfileExcluded: true,
        dependentRelationCount: dependentRelations.length,
        consentCount: consents.length,
        coverageCount: coverages.length,
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      privacy: {
        administrativeViewOnly: true,
        clinicalHealthProfileExcluded: true,
        diagnosesExcluded: true,
        medicationsExcluded: true,
        questionnaireAnswersExcluded: true,
        observationsExcluded: true,
      },
      patient: {
        patientId: profile.id,
        patientRef: this.reference("PAT", profile.id),
        firstName: profile.firstName,
        lastName: profile.lastName,
        displayName: `${profile.firstName} ${profile.lastName}`.trim(),
        contact: {
          email: account.email,
          phone: profile.phone,
        },
        account: {
          status: account.status,
          mfaEnabled: Boolean(account.mfaEnrollment?.enabledAt),
          lockedUntil: account.lockedUntil?.toISOString() ?? null,
          failedLoginCount: account.failedLoginCount,
          operationalFlags: this.operationalFlags(account.status, account.lockedUntil, account.failedLoginCount),
          createdAt: account.createdAt.toISOString(),
          updatedAt: account.updatedAt.toISOString(),
        },
        profileCreatedAt: profile.createdAt.toISOString(),
        profileUpdatedAt: profile.updatedAt.toISOString(),
      },
      dependents: dependentRelations.map((relation) => ({
        relationRef: this.reference("REL", relation.id),
        perspective: relation.guardianAccountId === account.id ? "GUARDIAN" : "DEPENDENT",
        relatedPatientRef: relation.dependentPatientId === profile.id ? null : this.reference("PAT", relation.dependentPatientId),
        guardianAccountRef: relation.guardianAccountId === account.id ? this.reference("ACC", account.id) : this.reference("ACC", relation.guardianAccountId),
        relationshipType: relation.relationshipType,
        status: relation.status,
        validFrom: relation.validFrom.toISOString(),
        validUntil: relation.validUntil?.toISOString() ?? null,
        verifiedAt: relation.verifiedAt?.toISOString() ?? null,
        revokedAt: relation.revokedAt?.toISOString() ?? null,
        updatedAt: relation.updatedAt.toISOString(),
      })),
      consents: consents.map((consent) => ({
        consentRef: this.reference("CNS", consent.id),
        providerRef: consent.providerId ? this.reference("PRV", consent.providerId) : null,
        scope: consent.scope,
        purpose: consent.purpose,
        version: consent.version,
        state: consent.state,
        grantedAt: consent.grantedAt.toISOString(),
        revokedAt: consent.revokedAt?.toISOString() ?? null,
        expiresAt: consent.expiresAt?.toISOString() ?? null,
      })),
      insurance: coverages.map((coverage) => ({
        coverageRef: this.reference("COV", coverage.id),
        payerCode: coverage.payerCode,
        payerName: coverage.payerName,
        displayLabel: coverage.displayLabel,
        policyReference: this.maskPolicyReference(coverage.externalPolicyRef),
        status: coverage.status,
        effectiveFrom: coverage.effectiveFrom?.toISOString().slice(0, 10) ?? null,
        effectiveUntil: coverage.effectiveUntil?.toISOString().slice(0, 10) ?? null,
        updatedAt: coverage.updatedAt.toISOString(),
      })),
      incidents: incidents.map((event) => ({
        incidentRef: this.reference("EVT", event.id),
        action: event.action,
        result: event.result,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }

  private requireAdmin(principal: AuthPrincipal): void {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Admin patient administration requires the ADMIN role.");
  }

  private search(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new BadRequestException("q must be text.");
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (normalized.length > 120 || /\p{Cc}/u.test(normalized)) throw new BadRequestException("q contains invalid characters.");
    return normalized;
  }

  private accountStatus(value: unknown): AccountStatus | undefined {
    if (value === undefined || value === null || value === "" || value === "ALL") return undefined;
    if (typeof value !== "string") throw new BadRequestException("status must be text.");
    const normalized = value.trim().toUpperCase();
    if (!Object.values(AccountStatus).includes(normalized as AccountStatus)) {
      throw new BadRequestException("status must be ACTIVE, SUSPENDED, ARCHIVED or ALL.");
    }
    return normalized as AccountStatus;
  }

  private positiveInteger(value: unknown, fallback: number, max: number, field: string): number {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw new BadRequestException(`${field} must be a positive integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      throw new BadRequestException(`${field} must be between 1 and ${max}.`);
    }
    return parsed;
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > 160 || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private operationalFlags(status: AccountStatus, lockedUntil: Date | null, failedLoginCount: number): string[] {
    const flags: string[] = [];
    if (status !== "ACTIVE") flags.push(`ACCOUNT_${status}`);
    if (lockedUntil && lockedUntil > new Date()) flags.push("ACCOUNT_LOCKED");
    if (failedLoginCount >= 3) flags.push("RECENT_LOGIN_FAILURES");
    return flags;
  }

  private reference(prefix: string, value: string): string {
    const digest = createHash("sha256").update(`carepoint-admin-patient:${value}`).digest("hex");
    return `${prefix}-${digest.slice(0, 12).toUpperCase()}`;
  }

  private maskPolicyReference(value: string): string {
    const normalized = value.trim();
    if (normalized.length <= 4) return "••••";
    return `••••${normalized.slice(-4)}`;
  }
}

@RequirePermissions("IAM_MANAGE_ACCOUNTS")
@Controller("admin/patients")
class AdminPatientsController {
  constructor(private readonly patients: AdminPatientsService) {}

  @Get()
  directory(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: PatientDirectoryQuery) {
    return this.patients.directory(principal, query);
  }

  @Get(":patientId")
  detail(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.patients.detail(principal, patientId);
  }
}

@Module({
  controllers: [AdminPatientsController],
  providers: [AdminPatientsService],
})
export class AdminPatientsModule {}
