import { BadRequestException, Injectable } from "@nestjs/common";

type FhirResource = Record<string, unknown>;
export type FhirSearchQuery = Record<string, unknown>;
export type FhirPaging = { count: number; offset: number };

const DEFAULT_COUNT = 20;
const MAX_COUNT = 100;
const MAX_OFFSET = 10000;

@Injectable()
export class FhirSearchSupportService {
  assertAllowed(query: FhirSearchQuery, allowed: readonly string[], repeatable: readonly string[] = []): void {
    const accepted = new Set(allowed);
    const repeated = new Set(repeatable);
    for (const key of Object.keys(query)) {
      if (!accepted.has(key)) throw new BadRequestException(`Unsupported FHIR search parameter '${key}'.`);
      if (repeated.has(key)) this.values(query, key);
      else this.single(query[key], key);
    }
  }

  paging(query: FhirSearchQuery): FhirPaging {
    const count = this.integer(query._count, "_count", DEFAULT_COUNT, 1, MAX_COUNT);
    const offset = this.integer(query._offset, "_offset", 0, 0, MAX_OFFSET);
    return { count, offset };
  }

  required(query: FhirSearchQuery, name: string): string {
    const value = this.optional(query, name);
    if (!value) throw new BadRequestException(`FHIR search requires ${name}.`);
    return value;
  }

  optional(query: FhirSearchQuery, name: string): string | null {
    const value = this.single(query[name], name);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  values(query: FhirSearchQuery, name: string): string[] {
    const raw = query[name];
    if (raw === undefined || raw === null || raw === "") return [];
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length === 0) return [];
    return values.map((value) => {
      if (typeof value !== "string" || !value.trim()) {
        throw new BadRequestException(`FHIR search parameter '${name}' must contain non-empty string values.`);
      }
      return value.trim();
    });
  }

  tokens(query: FhirSearchQuery, name: string): string[] {
    const raw = this.optional(query, name);
    if (!raw) return [];
    const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length === 0) throw new BadRequestException(`FHIR search parameter '${name}' is empty.`);
    return [...new Set(values)];
  }

  bundle(args: {
    resources: FhirResource[];
    total: number;
    route: string;
    query: FhirSearchQuery;
    paging: FhirPaging;
  }): FhirResource {
    const { resources, total, route, query, paging } = args;
    const link: Array<{ relation: string; url: string }> = [
      { relation: "self", url: this.url(route, query, paging.offset, paging.count) },
    ];
    const nextOffset = paging.offset + resources.length;
    if (nextOffset < total && resources.length > 0) {
      link.push({ relation: "next", url: this.url(route, query, nextOffset, paging.count) });
    }
    if (paging.offset > 0) {
      link.push({ relation: "previous", url: this.url(route, query, Math.max(0, paging.offset - paging.count), paging.count) });
    }
    return {
      resourceType: "Bundle",
      type: "searchset",
      total,
      link,
      entry: resources.map((resource) => ({
        fullUrl: `urn:uuid:${String(resource.id ?? "resource")}`,
        resource,
        search: { mode: "match" },
      })),
    };
  }

  private url(route: string, query: FhirSearchQuery, offset: number, count: number): string {
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(query)) {
      if (key === "_count" || key === "_offset") continue;
      const value = this.single(raw, key);
      if (typeof value === "string" && value.trim()) params.set(key, value.trim());
    }
    params.set("_count", String(count));
    params.set("_offset", String(offset));
    return `${route}?${params.toString()}`;
  }

  private integer(value: unknown, name: string, fallback: number, min: number, max: number): number {
    const raw = this.single(value, name);
    if (raw === undefined || raw === null || raw === "") return fallback;
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new BadRequestException(`FHIR search parameter '${name}' must be an integer.`);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(`FHIR search parameter '${name}' must be between ${min} and ${max}.`);
    }
    return parsed;
  }

  private single(value: unknown, name: string): unknown {
    if (Array.isArray(value)) throw new BadRequestException(`FHIR search parameter '${name}' must not be repeated.`);
    return value;
  }
}
