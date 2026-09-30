import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

type SavedLocationKind = "HOME" | "WORK" | "HEALTHCARE" | "OTHER";

type LocationInput = {
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  placeId?: unknown;
  source?: unknown;
};

type SavedLocationBody = LocationInput & {
  label?: unknown;
  kind?: unknown;
};

type RoutePreviewBody = {
  mode?: unknown;
  pickup?: unknown;
  destination?: unknown;
  languageCode?: unknown;
};

type NormalizedInputLocation = {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  source: string | null;
};

const GOOGLE_ROUTES_COMPUTE = "https://routes.googleapis.com/directions/v2:computeRoutes";
const PROVIDER_TIMEOUT_MS = 6_000;
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

@Injectable()
class TransportSavedLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  capabilities() {
    const routeProvider = this.routeProvider();
    return {
      savedLocationsAvailable: true,
      healthcareCentersAvailable: true,
      routePreviewAvailable: routeProvider === "google" && Boolean(this.googleApiKey()),
      routeProvider,
    };
  }

  async listSaved(principal: AuthPrincipal) {
    const patient = await this.patientForAccount(principal.accountId);
    const rows = await this.prisma.transportSavedLocation.findMany({
      where: { patientId: patient.id },
      orderBy: [{ updatedAt: "desc" }, { label: "asc" }],
      take: 100,
    });
    return rows.map((row) => this.presentSaved(row));
  }

  async createSaved(principal: AuthPrincipal, input: SavedLocationBody) {
    const patient = await this.patientForAccount(principal.accountId);
    const location = this.locationInput(input, "saved location");
    const row = await this.prisma.transportSavedLocation.create({
      data: {
        patientId: patient.id,
        label: this.requiredText(input.label, 1, 120, "label"),
        kind: this.savedKind(input.kind),
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        placeId: location.placeId,
        source: location.source,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "TRANSPORT_SAVED_LOCATION_CREATED",
      objectType: "TRANSPORT_SAVED_LOCATION",
      objectId: row.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: { kind: row.kind },
    });
    return this.presentSaved(row);
  }

  async updateSaved(
    principal: AuthPrincipal,
    locationId: string,
    input: SavedLocationBody,
  ) {
    const patient = await this.patientForAccount(principal.accountId);
    const current = await this.prisma.transportSavedLocation.findUnique({
      where: { id: this.id(locationId, "locationId") },
    });
    if (!current || current.patientId !== patient.id) {
      throw new NotFoundException("Saved transport location not found.");
    }
    const location = this.locationInput(input, "saved location");
    const row = await this.prisma.transportSavedLocation.update({
      where: { id: current.id },
      data: {
        label: this.requiredText(input.label, 1, 120, "label"),
        kind: this.savedKind(input.kind),
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        placeId: location.placeId,
        source: location.source,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "TRANSPORT_SAVED_LOCATION_UPDATED",
      objectType: "TRANSPORT_SAVED_LOCATION",
      objectId: row.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: { kind: row.kind },
    });
    return this.presentSaved(row);
  }

  async deleteSaved(principal: AuthPrincipal, locationId: string) {
    const patient = await this.patientForAccount(principal.accountId);
    const current = await this.prisma.transportSavedLocation.findUnique({
      where: { id: this.id(locationId, "locationId") },
    });
    if (!current || current.patientId !== patient.id) {
      throw new NotFoundException("Saved transport location not found.");
    }
    await this.prisma.transportSavedLocation.delete({ where: { id: current.id } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "TRANSPORT_SAVED_LOCATION_DELETED",
      objectType: "TRANSPORT_SAVED_LOCATION",
      objectId: current.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: { kind: current.kind },
    });
    return { deleted: true, id: current.id };
  }

  async healthcareCenters(rawQuery?: string) {
    const query = rawQuery?.trim().toLocaleLowerCase() ?? "";
    if (query.length > 120) {
      throw new BadRequestException("q must not exceed 120 characters.");
    }

    const clinicModalities = await this.prisma.serviceModality.findMany({
      where: {
        modality: "CLINIC",
        active: true,
        service: { active: true, provider: { status: "ACTIVE" } },
      },
      select: { serviceId: true },
      take: 500,
    });
    const serviceIds = [...new Set(clinicModalities.map((row) => row.serviceId))];
    if (serviceIds.length === 0) return { items: [] };

    const contexts = await this.prisma.serviceDeliveryContext.findMany({
      where: {
        modality: "CLINIC",
        serviceId: { in: serviceIds },
        clinicLocationId: { not: null },
      },
      select: { clinicLocationId: true },
      take: 500,
    });
    const locationIds = [
      ...new Set(
        contexts
          .map((row) => row.clinicLocationId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (locationIds.length === 0) return { items: [] };

    const locations = await this.prisma.providerLocation.findMany({
      where: {
        id: { in: locationIds },
        active: true,
        addressValidatedAt: { not: null },
      },
      orderBy: [{ city: "asc" }, { label: "asc" }],
      take: 200,
    });
    const providerIds = [...new Set(locations.map((row) => row.providerId))];
    const providers = await this.prisma.provider.findMany({
      where: { id: { in: providerIds }, status: "ACTIVE" },
      select: { id: true, displayName: true },
    });
    const providerById = new Map(providers.map((row) => [row.id, row.displayName]));

    const items = locations
      .map((row) => {
        const providerName = providerById.get(row.providerId);
        if (!providerName) return null;
        const address = [
          row.addressLine1,
          row.addressLine2,
          row.city,
          row.region,
          row.postalCode,
          row.countryCode,
        ]
          .filter((part): part is string => Boolean(part?.trim()))
          .join(", ");
        const haystack = `${providerName} ${row.label} ${address}`.toLocaleLowerCase();
        if (query && !haystack.includes(query)) return null;
        return {
          id: row.id,
          providerId: row.providerId,
          label: providerName === row.label ? row.label : `${providerName} · ${row.label}`,
          kind: "HEALTHCARE",
          arrivalInstructions: row.arrivalInstructions,
          location: {
            address,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            placeId: null,
            source: "HEALTHCARE_CENTER",
          },
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .slice(0, 50);

    return { items };
  }

  async routePreviewForRequest(principal: AuthPrincipal, requestIdRaw: string) {
    const requestId = this.id(requestIdRaw, "requestId");
    const request = await this.prisma.medicalTransportRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        mode: true,
        pickupAddress: true,
        pickupLatitude: true,
        pickupLongitude: true,
        destinationAddress: true,
        destinationLatitude: true,
        destinationLongitude: true,
      },
    });
    if (!request) throw new NotFoundException("Medical transport request not found.");

    return this.routePreview(principal, {
      mode: request.mode,
      pickup: {
        address: request.pickupAddress,
        latitude: request.pickupLatitude == null ? null : Number(request.pickupLatitude),
        longitude: request.pickupLongitude == null ? null : Number(request.pickupLongitude),
        source: "TRANSPORT_REQUEST",
      },
      destination: {
        address: request.destinationAddress,
        latitude: request.destinationLatitude == null ? null : Number(request.destinationLatitude),
        longitude: request.destinationLongitude == null ? null : Number(request.destinationLongitude),
        source: "TRANSPORT_REQUEST",
      },
    });
  }

  async routePreview(principal: AuthPrincipal, input: RoutePreviewBody) {
    const mode = this.transportMode(input.mode);
    const pickup = this.locationInput(this.map(input.pickup, "pickup"), "pickup");
    const destination = this.locationInput(
      this.map(input.destination, "destination"),
      "destination",
    );
    const capabilities = this.capabilities();

    if (mode !== "GROUND") {
      await this.auditRoute(principal, capabilities.routeProvider, false, "AIR_NOT_SUPPORTED");
      return {
        ...capabilities,
        available: false,
        reason: "AIR_NOT_SUPPORTED",
        mode,
      };
    }
    if (!capabilities.routePreviewAvailable) {
      await this.auditRoute(principal, capabilities.routeProvider, false, "NOT_CONFIGURED");
      return {
        ...capabilities,
        available: false,
        reason: "NOT_CONFIGURED",
        mode,
      };
    }

    const languageCode = this.languageCode(input.languageCode);
    const payload = await this.googleRouteJson({
      origin: this.routeWaypoint(pickup),
      destination: this.routeWaypoint(destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: false,
      polylineQuality: "OVERVIEW",
      ...(languageCode ? { languageCode } : {}),
    });
    const routes = Array.isArray(payload.routes) ? payload.routes : [];
    const first = routes[0] as Record<string, any> | undefined;
    const durationSeconds = this.durationSeconds(first?.duration);
    const distanceMeters = this.nonNegativeInt(first?.distanceMeters);
    if (!first || durationSeconds == null || distanceMeters == null) {
      await this.auditRoute(principal, capabilities.routeProvider, false, "NO_ROUTE");
      return {
        ...capabilities,
        available: false,
        reason: "NO_ROUTE",
        mode,
      };
    }

    const etaMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    await this.auditRoute(principal, capabilities.routeProvider, true, "ROUTE_FOUND");
    return {
      ...capabilities,
      available: true,
      mode,
      distanceMeters,
      durationSeconds,
      etaMinutes,
      encodedPolyline:
        typeof first.polyline?.encodedPolyline === "string"
          ? first.polyline.encodedPolyline
          : null,
      pickup,
      destination,
    };
  }

  private routeProvider(): "none" | "google" {
    const value = process.env.TRANSPORT_ROUTE_PROVIDER?.trim().toLowerCase();
    return value === "google" ? "google" : "none";
  }

  private googleApiKey(): string | null {
    const value =
      process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim();
    return value || null;
  }

  private async googleRouteJson(body: Record<string, unknown>) {
    const apiKey = this.googleApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "Transport route preview is not configured. Booking remains available without route preview.",
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch(GOOGLE_ROUTES_COMPUTE, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(
          "Transport route preview is temporarily unavailable. Booking remains available.",
        );
      }
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ServiceUnavailableException(
          "Transport route preview returned an invalid response. Booking remains available.",
        );
      }
      return payload as Record<string, any>;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        "Transport route preview is temporarily unavailable. Booking remains available.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private routeWaypoint(location: NormalizedInputLocation) {
    if (location.placeId) return { placeId: location.placeId };
    if (location.latitude != null && location.longitude != null) {
      return {
        location: {
          latLng: {
            latitude: location.latitude,
            longitude: location.longitude,
          },
        },
      };
    }
    return { address: location.address };
  }

  private locationInput(input: LocationInput, field: string): NormalizedInputLocation {
    const address = this.optionalText(input.address, 500, `${field}.address`);
    const placeId = this.optionalText(input.placeId, 500, `${field}.placeId`);
    const source = this.optionalText(input.source, 40, `${field}.source`);
    const pair = this.optionalLocationPair(
      input.latitude,
      input.longitude,
      `${field}.latitude`,
      `${field}.longitude`,
    );
    if (!address && !pair) {
      throw new BadRequestException(
        `${field} requires an address or an optional complete latitude/longitude pair.`,
      );
    }
    return {
      address,
      latitude: pair?.latitude ?? null,
      longitude: pair?.longitude ?? null,
      placeId,
      source,
    };
  }

  private optionalLocationPair(
    latitudeValue: unknown,
    longitudeValue: unknown,
    latitudeField: string,
    longitudeField: string,
  ) {
    const hasLatitude = latitudeValue !== undefined && latitudeValue !== null && latitudeValue !== "";
    const hasLongitude = longitudeValue !== undefined && longitudeValue !== null && longitudeValue !== "";
    if (!hasLatitude && !hasLongitude) return null;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        `${latitudeField} and ${longitudeField} are optional, but must be provided together.`,
      );
    }
    return {
      latitude: this.coordinate(latitudeValue, latitudeField, -90, 90),
      longitude: this.coordinate(longitudeValue, longitudeField, -180, 180),
    };
  }

  private savedKind(value: unknown): SavedLocationKind {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "OTHER";
    if (
      normalized !== "HOME" &&
      normalized !== "WORK" &&
      normalized !== "HEALTHCARE" &&
      normalized !== "OTHER"
    ) {
      throw new BadRequestException("kind must be HOME, WORK, HEALTHCARE or OTHER.");
    }
    return normalized;
  }

  private transportMode(value: unknown): "GROUND" | "AIR" {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "GROUND";
    if (normalized !== "GROUND" && normalized !== "AIR") {
      throw new BadRequestException("mode must be GROUND or AIR.");
    }
    return normalized;
  }

  private languageCode(value: unknown) {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !LANGUAGE_CODE.test(value.trim())) {
      throw new BadRequestException("languageCode is invalid.");
    }
    return value.trim();
  }

  private coordinate(value: unknown, field: string, min: number, max: number) {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return number;
  }

  private requiredText(
    value: unknown,
    min: number,
    max: number,
    field: string,
  ) {
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be text.`);
    }
    const text = value.trim();
    if (text.length < min || text.length > max) {
      throw new BadRequestException(
        `${field} must contain between ${min} and ${max} characters.`,
      );
    }
    return text;
  }

  private optionalText(value: unknown, max: number, field: string) {
    if (value == null || value === "") return null;
    return this.requiredText(value, 1, max, field);
  }

  private id(value: string, field: string) {
    return this.requiredText(value, 1, 128, field);
  }

  private map(value: unknown, field: string): LocationInput {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(`${field} must be an object.`);
    }
    return value as LocationInput;
  }

  private durationSeconds(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(value.trim());
    if (!match) return null;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
  }

  private nonNegativeInt(value: unknown): number | null {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  }

  private async patientForAccount(accountId: string) {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: accountId },
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundException("Patient profile not found.");
    }
    return patient;
  }

  private presentSaved(row: any) {
    return {
      id: row.id,
      label: row.label,
      kind: row.kind,
      location: {
        address: row.address,
        latitude: row.latitude == null ? null : Number(row.latitude),
        longitude: row.longitude == null ? null : Number(row.longitude),
        placeId: row.placeId,
        source: "SAVED_LOCATION",
      },
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async auditRoute(
    principal: AuthPrincipal,
    provider: string,
    resolved: boolean,
    reason: string,
  ) {
    await this.audit.write({
      actorId: principal.accountId,
      action: "TRANSPORT_ROUTE_PREVIEW",
      objectType: "TRANSPORT_ROUTE",
      objectId: provider.toUpperCase(),
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: { provider, resolved, reason },
    });
  }
}

@RequirePermissions("PATIENT_TRANSPORT_REQUEST")
@Controller("transport/location")
class TransportSavedLocationsController {
  constructor(private readonly locations: TransportSavedLocationsService) {}

  @Get("capabilities")
  @Header("Cache-Control", "no-store")
  capabilities() {
    return this.locations.capabilities();
  }

  @Get("saved")
  @Header("Cache-Control", "no-store")
  listSaved(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.locations.listSaved(principal);
  }

  @Post("saved")
  @Header("Cache-Control", "no-store")
  createSaved(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: SavedLocationBody,
  ) {
    return this.locations.createSaved(principal, body ?? {});
  }

  @Patch("saved/:locationId")
  @Header("Cache-Control", "no-store")
  updateSaved(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("locationId") locationId: string,
    @Body() body: SavedLocationBody,
  ) {
    return this.locations.updateSaved(principal, locationId, body ?? {});
  }

  @Delete("saved/:locationId")
  @Header("Cache-Control", "no-store")
  deleteSaved(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("locationId") locationId: string,
  ) {
    return this.locations.deleteSaved(principal, locationId);
  }

  @Get("healthcare-centers")
  @Header("Cache-Control", "no-store")
  healthcareCenters(@Query("q") query?: string) {
    return this.locations.healthcareCenters(query);
  }

  @Post("route-preview")
  @Header("Cache-Control", "no-store")
  routePreview(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: RoutePreviewBody,
  ) {
    return this.locations.routePreview(principal, body ?? {});
  }
}

@RequirePermissions("TRANSPORT_OPERATE")
@Controller("operations/medical-transport")
class TransportRouteOperationsController {
  constructor(private readonly locations: TransportSavedLocationsService) {}

  @Post(":requestId/route-preview")
  @Header("Cache-Control", "no-store")
  routePreview(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
  ) {
    return this.locations.routePreviewForRequest(principal, requestId);
  }
}

@Module({
  controllers: [TransportSavedLocationsController, TransportRouteOperationsController],
  providers: [TransportSavedLocationsService],
})
export class TransportSavedLocationsModule {}
