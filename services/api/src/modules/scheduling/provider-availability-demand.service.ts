import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { availabilityPage } from "./availability-requests.policy";

/** Read-only F3 demand. Never accepts an owner/patient filter from a client. */
@Injectable()
export class ProviderAvailabilityDemandService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: AuthPrincipal, query: Record<string, unknown> = {}) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Provider access is required.");
    }
    if (Object.keys(query).some((key) => key !== "page")) {
      throw new BadRequestException("Only the page query parameter is supported.");
    }
    const page = availabilityPage(query.page);
    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.provider.findUnique({
        where: { userId: principal.accountId },
        select: { id: true, status: true, class: true },
      });
      if (!provider || provider.status !== "ACTIVE" || provider.class !== principal.role) {
        throw new ForbiddenException("Active provider access is required.");
      }
      const checkedAt = new Date();
      const rows = await tx.patientAvailabilityRequest.groupBy({
        by: ["serviceId", "modality"],
        where: { providerId: provider.id, status: "WAITING", toAt: { gt: checkedAt } },
        _count: { _all: true }, _min: { fromAt: true }, _max: { toAt: true },
        orderBy: [{ serviceId: "asc" }, { modality: "asc" }],
        skip: (page - 1) * 50, take: 51,
      });
      const services = await tx.service.findMany({
        where: { providerId: provider.id, id: { in: rows.slice(0, 50).map((row) => row.serviceId) } },
        select: { id: true, name: true, active: true, modalities: { select: { modality: true, active: true } } },
      });
      const byId = new Map(services.map((service) => [service.id, service]));
      return {
        items: rows.slice(0, 50).map((row) => {
          const service = byId.get(row.serviceId);
          return {
            serviceId: row.serviceId, serviceName: service?.name ?? "",
            modality: row.modality, requestCount: row._count._all,
            earliestRequestedAt: row._min.fromAt, latestRequestedAt: row._max.toAt,
            serviceActive: service?.active === true,
            modalityActive: service?.modalities.some((item) => item.modality === row.modality && item.active) === true,
          };
        }),
        page, nextPage: rows.length > 50 && page < 1000 ? page + 1 : null,
        truncated: rows.length > 50 && page === 1000,
        checkedAt, source: "UNBOOKED_AVAILABILITY_REQUESTS",
        containsPatientIdentities: false, reservesSlots: false,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
