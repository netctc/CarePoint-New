import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

@Injectable()
export class InsurancePresentationService {
  constructor(private readonly prisma: PrismaService) {}

  async listPatientCoverages(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("A patient account is required.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    const items = await this.prisma.insuranceCoverage.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "desc" }, take: 100 });
    return items.map(({ externalPolicyRef: _internal, ...coverage }) => ({ ...coverage, policyReferenceStoredExternally: true }));
  }
}
