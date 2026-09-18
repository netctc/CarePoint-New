import { BadRequestException, Controller, ForbiddenException, Get, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

/** Owner-only inventory includes blocked slots, unlike public availability.
 * No patient, appointment, clinical, or credential data is projected.
 */
@Controller("provider/availability/inventory")
export class ProviderSlotInventoryController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY")
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("from") fromRaw?: string,
    @Query("to") toRaw?: string,
    @Query("page") pageRaw?: string,
  ) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("A provider account is required.");
    const from = this.date(fromRaw), to = this.date(toRaw);
    // Allows 31 local calendar days across a daylight-saving transition.
    if (to <= from || to.getTime() - from.getTime() > 32 * 86_400_000) throw new BadRequestException("Inventory range must be positive and bounded to 31 local calendar days.");
    const page = pageRaw === undefined ? 1 : Number(pageRaw);
    if ((pageRaw !== undefined && !/^[1-9]\d{0,3}$/.test(pageRaw)) || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new BadRequestException("Invalid inventory page.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, status: true } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active provider is required.");
    const limit = 50;
    const rows = await this.prisma.availabilitySlot.findMany({
      where: { providerId: provider.id, startsAt: { gte: from, lt: to } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit, take: limit + 1,
      select: { id: true, serviceId: true, modality: true, startsAt: true, endsAt: true, capacity: true, bookedCount: true, status: true, version: true, service: { select: { name: true } } },
    });
    return { page, limit, nextPage: rows.length > limit && page < 1000 ? page + 1 : null, items: rows.slice(0, limit) };
  }

  private date(value?: string): Date {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new BadRequestException("An ISO date-time with timezone is required.");
    const calendar = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16)), second = Number(value.slice(17, 19));
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10) || hour > 23 || minute > 59 || second > 59) throw new BadRequestException("Invalid inventory calendar date or time.");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException("Invalid inventory date-time.");
    return date;
  }
}
