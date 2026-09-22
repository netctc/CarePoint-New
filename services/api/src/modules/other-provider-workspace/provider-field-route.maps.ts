import { Injectable } from "@nestjs/common";
import {
  discardProviderResponseBody,
  readBoundedProviderJsonObject,
} from "../../infrastructure/http/bounded-provider-response";

export type RoutePoint = { latitude: number; longitude: number };
export type FieldRouteEstimateResult = {
  etaMinutes: number;
  distanceMeters: number;
  source: "MAPBOX" | "DIRECT_DISTANCE_V1";
  providerState: "READY" | "DISABLED" | "DEGRADED";
  geometry: null;
};

const EARTH_RADIUS_M = 6_371_000;
const DIRECT_ROAD_FACTOR = 1.25;
const DIRECT_SPEED_KMH = 35;
const MAPBOX_HOST = "api.mapbox.com";

@Injectable()
export class FieldRouteMapsAdapter {
  async estimate(origin: RoutePoint, destination: RoutePoint): Promise<FieldRouteEstimateResult> {
    if (this.provider() === "MAPBOX") {
      try {
        const mapped = await this.mapbox(origin, destination);
        if (mapped) return mapped;
      } catch {
        // Route estimation is operational assistance, not a clinical decision.
        // A provider outage must not block a home-visit job.
      }
      return { ...this.direct(origin, destination), providerState: "DEGRADED" };
    }
    return this.direct(origin, destination);
  }

  configuration() {
    const provider = this.provider();
    return {
      provider,
      externalRoutingEnabled: provider === "MAPBOX",
      providerLocationPersisted: false,
      routeGeometryPersisted: false,
      fallback: "DIRECT_DISTANCE_V1",
    };
  }

  private provider(): "DISABLED" | "MAPBOX" {
    return process.env.FIELD_ROUTE_MAPS_PROVIDER?.trim().toUpperCase() === "MAPBOX" ? "MAPBOX" : "DISABLED";
  }

  private timeoutMs(): number {
    const raw = process.env.FIELD_ROUTE_MAPS_TIMEOUT_MS?.trim() || "5000";
    if (!/^\d+$/.test(raw)) return 5000;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 15_000 ? parsed : 5000;
  }

  private async mapbox(origin: RoutePoint, destination: RoutePoint): Promise<FieldRouteEstimateResult | null> {
    const token = process.env.MAPBOX_ACCESS_TOKEN?.trim();
    if (!token) return null;
    const coordinates =
      `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const url = new URL(`https://${MAPBOX_HOST}/directions/v5/mapbox/driving/${coordinates}`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("overview", "false");
    url.searchParams.set("steps", "false");
    url.searchParams.set("alternatives", "false");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    let response: Response | null = null;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        await discardProviderResponseBody(response);
        return null;
      }
      const payload = await readBoundedProviderJsonObject(response);
      const routes = Array.isArray(payload.routes) ? payload.routes : [];
      const first = routes[0];
      if (!first || typeof first !== "object" || Array.isArray(first)) return null;
      const raw = first as Record<string, unknown>;
      const distance = Number(raw.distance);
      const duration = Number(raw.duration);
      if (!Number.isFinite(distance) || distance < 0 || distance > 2_000_000) return null;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 43_200) return null;
      return {
        etaMinutes: Math.max(1, Math.min(720, Math.ceil(duration / 60))),
        distanceMeters: Math.round(distance),
        source: "MAPBOX",
        providerState: "READY",
        geometry: null,
      };
    } finally {
      clearTimeout(timer);
      if (response?.body) await response.body.cancel().catch(() => undefined);
    }
  }

  private direct(origin: RoutePoint, destination: RoutePoint): FieldRouteEstimateResult {
    const linearMeters = this.haversineMeters(origin, destination);
    const roadMeters = Math.max(0, Math.min(2_000_000, Math.round(linearMeters * DIRECT_ROAD_FACTOR)));
    const minutes = Math.max(1, Math.min(720, Math.ceil((roadMeters / 1000 / DIRECT_SPEED_KMH) * 60)));
    return {
      etaMinutes: minutes,
      distanceMeters: roadMeters,
      source: "DIRECT_DISTANCE_V1",
      providerState: this.provider() === "MAPBOX" ? "DEGRADED" : "DISABLED",
      geometry: null,
    };
  }

  private haversineMeters(left: RoutePoint, right: RoutePoint): number {
    const rad = (value: number) => value * Math.PI / 180;
    const dLat = rad(right.latitude - left.latitude);
    const dLon = rad(right.longitude - left.longitude);
    const lat1 = rad(left.latitude);
    const lat2 = rad(right.latitude);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
