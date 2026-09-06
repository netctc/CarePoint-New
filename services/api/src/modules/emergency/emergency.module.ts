import { Body, Controller, Get, Module, NotFoundException, Param, Post } from "@nestjs/common";
import {
  assertValidEmergencyLocation,
  type CreateEmergencyAmbulanceRequestInput,
  type EmergencyAmbulanceRequest,
} from "@carepoint/contracts";
import { randomUUID } from "node:crypto";

class EmergencyAmbulanceService {
  private readonly requests = new Map<string, EmergencyAmbulanceRequest>();

  create(input: CreateEmergencyAmbulanceRequestInput): EmergencyAmbulanceRequest {
    if (!input.patientId?.trim()) throw new Error("patientId is required");
    assertValidEmergencyLocation(input.latitude, input.longitude);
    const now = new Date().toISOString();
    const request: EmergencyAmbulanceRequest = {
      id: randomUUID(),
      patientId: input.patientId,
      status: "REQUESTED",
      latitude: input.latitude,
      longitude: input.longitude,
      pickupAddress: input.pickupAddress?.trim() || null,
      callbackPhone: input.callbackPhone?.trim() || null,
      note: input.note?.trim() || null,
      assignedProviderId: null,
      etaMinutes: null,
      requestedAt: now,
      updatedAt: now,
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

@Controller("emergency/ambulance")
class EmergencyAmbulanceController {
  constructor(private readonly service: EmergencyAmbulanceService) {}

  @Post()
  request(@Body() input: CreateEmergencyAmbulanceRequestInput) {
    return {
      emergencyFlow: true,
      bypassesProviderSearch: true,
      bypassesOrdinaryBooking: true,
      request: this.service.create(input),
    };
  }

  @Get(":id")
  status(@Param("id") id: string) {
    return this.service.get(id);
  }
}

@Module({
  controllers: [EmergencyAmbulanceController],
  providers: [EmergencyAmbulanceService],
})
export class EmergencyModule {}
