import { Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post } from "@nestjs/common";
import { assertValidEmergencyLocation, type CreateEmergencyAmbulanceRequestInput, type EmergencyAmbulanceRequest } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

type EmergencyRequestBody = Omit<CreateEmergencyAmbulanceRequestInput, "patientId">;

class EmergencyAmbulanceService {
  private readonly requests = new Map<string, EmergencyAmbulanceRequest>();

  create(input: CreateEmergencyAmbulanceRequestInput): EmergencyAmbulanceRequest {
    assertValidEmergencyLocation(input.latitude, input.longitude);
    const now = new Date().toISOString();
    const request: EmergencyAmbulanceRequest = {
      id: randomUUID(), patientId: input.patientId, status: "REQUESTED", latitude: input.latitude, longitude: input.longitude,
      pickupAddress: input.pickupAddress?.trim() || null, callbackPhone: input.callbackPhone?.trim() || null, note: input.note?.trim() || null,
      assignedProviderId: null, etaMinutes: null, requestedAt: now, updatedAt: now,
    };
    this.requests.set(request.id, request);
    return request;
  }

  get(id: string): EmergencyAmbulanceRequest {
    const request = this.requests.get(id);
    if (!request) throw new NotFoundException("Emergency ambulance request not found");
    return request;
  }
}

@RequirePermissions("EMERGENCY_REQUEST")
@Controller("emergency/ambulance")
class EmergencyAmbulanceController {
  constructor(private readonly service: EmergencyAmbulanceService, private readonly prisma: PrismaService) {}

  @Post()
  async request(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EmergencyRequestBody) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return {
      emergencyFlow: true,
      bypassesProviderSearch: true,
      bypassesOrdinaryBooking: true,
      request: this.service.create({ ...input, patientId: patient.id }),
    };
  }

  @Get(":id")
  async status(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    const request = this.service.get(id);
    if (request.patientId !== patient.id) throw new ForbiddenException("Emergency request access denied.");
    return request;
  }
}

@Module({ controllers: [EmergencyAmbulanceController], providers: [EmergencyAmbulanceService] })
export class EmergencyModule {}
