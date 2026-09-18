import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreatePaymentIntentInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { BillingService } from "./billing.service";

@Injectable()
export class BillingIdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async createPaymentIntent(principal: AuthPrincipal, invoiceId: string, input: CreatePaymentIntentInput) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("A patient account is required.");
    const key = input.idempotencyKey?.trim();
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException("idempotencyKey must contain between 8 and 128 characters.");
    const duplicate = await this.prisma.paymentIntent.findUnique({ where: { idempotencyKey: key } });
    if (!duplicate) return this.billing.createPaymentIntent(principal, invoiceId, input);

    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    if (duplicate.patientId !== patient.id || duplicate.invoiceId !== invoiceId) throw new ConflictException("idempotencyKey is already in use.");
    const receipt = await this.prisma.paymentReceipt.findUnique({ where: { paymentIntentId: duplicate.id } });
    return {
      id: duplicate.id,
      invoiceId: duplicate.invoiceId,
      amountMinor: duplicate.amountMinor,
      currency: duplicate.currency,
      gateway: duplicate.gateway,
      gatewayIntentRef: duplicate.gatewayIntentRef,
      status: duplicate.status,
      failureCode: duplicate.failureCode,
      createdAt: duplicate.createdAt,
      updatedAt: duplicate.updatedAt,
      succeededAt: duplicate.succeededAt,
      ...(receipt ? { receipt } : {}),
    };
  }
}
