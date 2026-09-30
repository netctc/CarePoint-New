import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

type TransportLocationProviderName = "manual" | "google";

type ReverseGeocodeBody = {
  latitude?: unknown;
  longitude?: unknown;
  languageCode?: unknown;
};

type SearchLocationBody = {
  query?: unknown;
  languageCode?: unknown;
  biasLatitude?: unknown;
  biasLongitude?: unknown;
};

type NormalizedLocation = {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  source: "GPS" | "ADDRESS_SEARCH";
};

type GoogleGeocodeResult = {
  placeId?: unknown;
  formattedAddress?: unknown;
  location?: {
    latitude?: unknown;
    longitude?: unknown;
  } | null;
};

type GooglePlace = {
  id?: unknown;
  formattedAddress?: unknown;
  displayName?: { text?: unknown } | null;
  location?: {
    latitude?: unknown;
    longitude?: unknown;
  } | null;
};

const PROVIDER_TIMEOUT_MS = 6_000;
const GOOGLE_GEOCODING_BASE = "https://geocode.googleapis.com/v4/geocode";
const GOOGLE_PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

@Injectable()
class TransportLocationService {
  constructor(private readonly audit: DatabaseAuditService) {}

  config() {
    const provider = this.provider();
    const configured = provider === "google" && Boolean(this.googleApiKey());

    const map = this.mapConfig();
    return {
      provider,
      reverseGeocodingAvailable: configured,
      placeSearchAvailable: configured,
      mapPickerAvailable: map != null,
      manualFallback: true,
      map,
    };
  }

  async reverseGeocode(principal: AuthPrincipal, input: ReverseGeocodeBody) {
    const latitude = this.coordinate(input.latitude, "latitude", -90, 90);
    const longitude = this.coordinate(input.longitude, "longitude", -180, 180);
    const languageCode = this.languageCode(input.languageCode);
    const config = this.config();

    if (!config.reverseGeocodingAvailable) {
      await this.auditOperation(principal, "REVERSE", config.provider, false, 0);
      return {
        ...config,
        resolved: false,
        location: this.location({
          address: null,
          latitude,
          longitude,
          placeId: null,
          source: "GPS",
        }),
      };
    }

    const url = new URL(`${GOOGLE_GEOCODING_BASE}/location`);
    url.searchParams.set("location.latitude", String(latitude));
    url.searchParams.set("location.longitude", String(longitude));
    if (languageCode) url.searchParams.set("languageCode", languageCode);
    const regionCode = this.regionCode();
    if (regionCode) url.searchParams.set("regionCode", regionCode);

    const payload = await this.googleJson(url, {
      method: "GET",
      headers: {
        "X-Goog-FieldMask": "results.placeId,results.formattedAddress,results.location",
      },
    });
    const results = Array.isArray(payload?.results) ? payload.results as GoogleGeocodeResult[] : [];
    const first = results.find((row) => this.text(row?.formattedAddress));

    if (!first) {
      await this.auditOperation(principal, "REVERSE", config.provider, false, results.length);
      return {
        ...config,
        resolved: false,
        location: this.location({
          address: null,
          latitude,
          longitude,
          placeId: null,
          source: "GPS",
        }),
      };
    }

    await this.auditOperation(principal, "REVERSE", config.provider, true, results.length);
    return {
      ...config,
      resolved: true,
      location: this.location({
        address: this.text(first.formattedAddress),
        latitude,
        longitude,
        placeId: this.text(first.placeId),
        source: "GPS",
      }),
    };
  }

  async search(principal: AuthPrincipal, input: SearchLocationBody) {
    const query = this.searchQuery(input.query);
    const languageCode = this.languageCode(input.languageCode);
    const bias = this.optionalCoordinatePair(input.biasLatitude, input.biasLongitude);
    const config = this.config();

    if (!config.placeSearchAvailable) {
      await this.auditOperation(principal, "SEARCH", config.provider, false, 0);
      return {
        ...config,
        query,
        items: [],
      };
    }

    const body: Record<string, unknown> = {
      textQuery: query,
      pageSize: 8,
      ...(languageCode ? { languageCode } : {}),
      ...(this.regionCode() ? { regionCode: this.regionCode() } : {}),
    };

    if (bias) {
      body.locationBias = {
        circle: {
          center: {
            latitude: bias.latitude,
            longitude: bias.longitude,
          },
          radius: 20_000,
        },
      };
    }

    const payload = await this.googleJson(new URL(GOOGLE_PLACES_SEARCH), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify(body),
    });

    const places = Array.isArray(payload?.places) ? payload.places as GooglePlace[] : [];
    const items = places
      .map((place) => {
        const latitude = this.optionalCoordinate(place.location?.latitude, -90, 90);
        const longitude = this.optionalCoordinate(place.location?.longitude, -180, 180);
        const address = this.text(place.formattedAddress);
        const displayName = this.text(place.displayName?.text);
        const label = displayName ?? address;
        if (latitude == null || longitude == null || !label) return null;

        return {
          label,
          location: this.location({
            address: address ?? displayName,
            latitude,
            longitude,
            placeId: this.text(place.id),
            source: "ADDRESS_SEARCH",
          }),
        };
      })
      .filter((row): row is { label: string; location: NormalizedLocation } => Boolean(row));

    const limitedItems = items.slice(0, 8);
    await this.auditOperation(
      principal,
      "SEARCH",
      config.provider,
      limitedItems.length > 0,
      limitedItems.length,
    );
    return {
      ...config,
      query,
      items: limitedItems,
    };
  }

  private provider(): TransportLocationProviderName {
    const value = (process.env.TRANSPORT_LOCATION_PROVIDER ?? "manual").trim().toLowerCase();
    return value === "google" ? "google" : "manual";
  }

  private googleApiKey(): string | null {
    const value =
      process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim();
    return value ? value : null;
  }

  private regionCode(): string | null {
    const value = process.env.TRANSPORT_LOCATION_REGION_CODE?.trim().toUpperCase();
    return value && /^[A-Z]{2}$/.test(value) ? value : null;
  }

  private mapConfig() {
    const provider = process.env.TRANSPORT_MAP_PROVIDER?.trim().toLowerCase();
    if (provider !== "raster") return null;

    const tileUrlTemplate = process.env.TRANSPORT_MAP_TILE_URL_TEMPLATE?.trim() ?? "";
    const attribution = process.env.TRANSPORT_MAP_ATTRIBUTION?.trim() ?? "";
    if (
      !tileUrlTemplate.startsWith("https://") ||
      !tileUrlTemplate.includes("{z}") ||
      !tileUrlTemplate.includes("{x}") ||
      !tileUrlTemplate.includes("{y}") ||
      !attribution
    ) {
      return null;
    }

    const minZoom = this.integerEnv("TRANSPORT_MAP_MIN_ZOOM", 2, 0, 20);
    const maxZoom = this.integerEnv("TRANSPORT_MAP_MAX_ZOOM", 18, minZoom, 22);
    const initialZoom = this.integerEnv(
      "TRANSPORT_MAP_INITIAL_ZOOM",
      Math.min(14, maxZoom),
      minZoom,
      maxZoom,
    );

    const defaultLatitude = this.optionalEnvCoordinate(
      "TRANSPORT_MAP_DEFAULT_LATITUDE",
      -85,
      85,
    );
    const defaultLongitude = this.optionalEnvCoordinate(
      "TRANSPORT_MAP_DEFAULT_LONGITUDE",
      -180,
      180,
    );
    const hasDefaultCenter =
      defaultLatitude != null && defaultLongitude != null;

    return {
      provider: "raster",
      tileUrlTemplate,
      attribution: attribution.slice(0, 200),
      minZoom,
      maxZoom,
      initialZoom,
      defaultLatitude: hasDefaultCenter ? defaultLatitude : null,
      defaultLongitude: hasDefaultCenter ? defaultLongitude : null,
    };
  }

  private integerEnv(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = process.env[key]?.trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max
      ? parsed
      : fallback;
  }

  private optionalEnvCoordinate(
    key: string,
    min: number,
    max: number,
  ): number | null {
    const raw = process.env[key]?.trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max
      ? parsed
      : null;
  }

  private async googleJson(url: URL, init: RequestInit): Promise<Record<string, any>> {
    const apiKey = this.googleApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "Transport location provider is not configured. Manual address entry remains available.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers ?? {}),
          "X-Goog-Api-Key": apiKey,
        },
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          "Transport location provider is temporarily unavailable. Use manual address entry.",
        );
      }

      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ServiceUnavailableException(
          "Transport location provider returned an invalid response. Use manual address entry.",
        );
      }
      return payload as Record<string, any>;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        "Transport location provider is temporarily unavailable. Use manual address entry.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private location(input: NormalizedLocation): NormalizedLocation {
    return {
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      placeId: input.placeId,
      source: input.source,
    };
  }

  private searchQuery(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("query must be text.");
    const query = value.trim();
    if (query.length < 2 || query.length > 160) {
      throw new BadRequestException("query must contain between 2 and 160 characters.");
    }
    return query;
  }

  private languageCode(value: unknown): string | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !LANGUAGE_CODE.test(value.trim())) {
      throw new BadRequestException("languageCode is invalid.");
    }
    return value.trim();
  }

  private coordinate(value: unknown, field: string, min: number, max: number): number {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return number;
  }

  private optionalCoordinate(value: unknown, min: number, max: number): number | null {
    if (value == null || value === "") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }

  private optionalCoordinatePair(latitude: unknown, longitude: unknown) {
    const hasLatitude = latitude != null && latitude !== "";
    const hasLongitude = longitude != null && longitude !== "";
    if (!hasLatitude && !hasLongitude) return null;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        "biasLatitude and biasLongitude are optional, but must be provided together.",
      );
    }
    return {
      latitude: this.coordinate(latitude, "biasLatitude", -90, 90),
      longitude: this.coordinate(longitude, "biasLongitude", -180, 180),
    };
  }

  private text(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text ? text.slice(0, 500) : null;
  }

  private async auditOperation(
    principal: AuthPrincipal,
    operation: "SEARCH" | "REVERSE",
    provider: TransportLocationProviderName,
    resolved: boolean,
    resultCount: number,
  ) {
    await this.audit.write({
      actorId: principal.accountId,
      action: `TRANSPORT_LOCATION_${operation}`,
      objectType: "TRANSPORT_LOCATION_SERVICE",
      objectId: provider.toUpperCase(),
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: {
        provider,
        resolved,
        resultCount,
      },
    });
  }
}

@RequirePermissions("PATIENT_TRANSPORT_REQUEST")
@Controller("transport/location")
class TransportLocationController {
  constructor(private readonly locations: TransportLocationService) {}

  @Get("config")
  @Header("Cache-Control", "no-store")
  config() {
    return this.locations.config();
  }

  @Post("reverse-geocode")
  @Header("Cache-Control", "no-store")
  reverseGeocode(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: ReverseGeocodeBody,
  ) {
    return this.locations.reverseGeocode(principal, body ?? {});
  }

  @Post("search")
  @Header("Cache-Control", "no-store")
  search(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: SearchLocationBody,
  ) {
    return this.locations.search(principal, body ?? {});
  }
}

@Module({
  controllers: [TransportLocationController],
  providers: [TransportLocationService],
})
export class TransportLocationModule {}
