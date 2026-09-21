import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

@Injectable()
export class PhysioSourceEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async eligibleForAppointment(principal: AuthPrincipal, appointmentId: string) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.clinicalOrderCapabilities.has("PHYSIOTHERAPY")) {
      throw new ForbiddenException("Other Provider category is not authorized for PHYSIOTHERAPY.");
    }
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId: context.providerId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true, patientId: true },
    });
    if (!appointment) throw new ForbiddenException("Authorized physiotherapy appointment context is required.");

    const [responses, used] = await Promise.all([
      this.prisma.providerCategoryFormResponse.findMany({
        where: {
          providerId: context.providerId,
          patientId: appointment.patientId,
          contextType: "APPOINTMENT",
          contextId: appointment.id,
        },
        include: {
          form: { select: { id: true, code: true, purpose: true, labels: true } },
          formVersion: { select: { version: true } },
        },
        orderBy: [{ submittedAt: "desc" }, { sequence: "desc" }],
        take: 50,
      }),
      this.prisma.physioAssessment.findMany({
        where: { providerId: context.providerId, appointmentId: appointment.id },
        select: { sourceFormResponseId: true },
      }),
    ]);
    const usedIds = new Set(used.map((item) => item.sourceFormResponseId));
    return {
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      sourceResponsesEncryptedAtRest: true,
      rawAnswersReturned: false,
      items: responses
        .filter((item) => !usedIds.has(item.id))
        .map((item) => ({
          responseId: item.id,
          formId: item.form.id,
          formCode: item.form.code,
          formPurpose: item.form.purpose,
          labels: item.form.labels,
          formVersion: item.formVersion.version,
          responseSequence: item.sequence,
          submittedAt: item.submittedAt,
        })),
    };
  }
}
