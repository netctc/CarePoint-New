import { BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";

const UID = /^\d+(?:\.\d+)+$/;

export type DicomWebReferenceDescriptor = {
  scope: "STUDY" | "SERIES" | "INSTANCE";
  studyInstanceUid: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  proxyRequired: true;
};

@Injectable()
export class DicomWebService {
  normalizeReference(input: Record<string, unknown>): string {
    const provider = this.providerName();
    if (provider === "mock") {
      if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("Mock DICOMweb references are forbidden in production.");
      const reference = typeof input.externalReference === "string" ? input.externalReference.trim() : "";
      if (!reference) throw new BadRequestException("externalReference is required for the mock DICOMweb provider.");
      return reference;
    }
    if (provider !== "dicomweb") throw new InternalServerErrorException(`Unsupported DICOMweb provider '${provider}'.`);

    const base = this.baseUrl();
    const study = this.optionalUid(input.studyInstanceUid, "studyInstanceUid");
    const series = this.optionalUid(input.seriesInstanceUid, "seriesInstanceUid");
    const instance = this.optionalUid(input.sopInstanceUid, "sopInstanceUid");
    if (series && !study) throw new BadRequestException("studyInstanceUid is required when seriesInstanceUid is provided.");
    if (instance && (!study || !series)) throw new BadRequestException("studyInstanceUid and seriesInstanceUid are required when sopInstanceUid is provided.");

    if (study) {
      let url = new URL(`studies/${encodeURIComponent(study)}`, base);
      if (series) url = new URL(`studies/${encodeURIComponent(study)}/series/${encodeURIComponent(series)}`, base);
      if (instance) url = new URL(`studies/${encodeURIComponent(study)}/series/${encodeURIComponent(series!)}/instances/${encodeURIComponent(instance)}`, base);
      return url.toString();
    }

    const reference = typeof input.externalReference === "string" ? input.externalReference.trim() : "";
    if (!reference) throw new BadRequestException("A DICOMweb UID reference or externalReference is required.");
    const parsed = this.parseAllowedReference(reference, base);
    return parsed.toString();
  }

  inspectReference(reference: string): DicomWebReferenceDescriptor {
    if (this.providerName() !== "dicomweb") {
      throw new BadRequestException("Structured DICOM ImagingStudy interoperability requires the DICOMweb provider.");
    }
    const base = new URL(this.baseUrl());
    const parsed = this.parseAllowedReference(reference, base.toString());
    const relativePath = parsed.pathname.slice(base.pathname.length);
    const rawSegments = relativePath.split("/").filter(Boolean);
    const segments = rawSegments.map((segment) => {
      try { return decodeURIComponent(segment); } catch { throw new BadRequestException("Stored DICOMweb reference contains invalid path encoding."); }
    });

    if (segments.length !== 2 && segments.length !== 4 && segments.length !== 6) {
      throw new BadRequestException("Stored DICOMweb reference is not a supported study, series, or instance path.");
    }
    if (segments[0] !== "studies") throw new BadRequestException("Stored DICOMweb reference does not identify a study.");
    const studyInstanceUid = this.requiredUid(segments[1], "studyInstanceUid");

    if (segments.length === 2) {
      return { scope: "STUDY", studyInstanceUid, proxyRequired: true };
    }
    if (segments[2] !== "series") throw new BadRequestException("Stored DICOMweb reference does not identify a supported series path.");
    const seriesInstanceUid = this.requiredUid(segments[3], "seriesInstanceUid");
    if (segments.length === 4) {
      return { scope: "SERIES", studyInstanceUid, seriesInstanceUid, proxyRequired: true };
    }
    if (segments[4] !== "instances") throw new BadRequestException("Stored DICOMweb reference does not identify a supported instance path.");
    const sopInstanceUid = this.requiredUid(segments[5], "sopInstanceUid");
    return { scope: "INSTANCE", studyInstanceUid, seriesInstanceUid, sopInstanceUid, proxyRequired: true };
  }

  descriptor(): { provider: "DICOMWEB"; proxyRequired: true } {
    return { provider: "DICOMWEB", proxyRequired: true };
  }

  private providerName(): string {
    return process.env.DICOMWEB_PROVIDER ?? (process.env.NODE_ENV === "production" ? "dicomweb" : "mock");
  }

  private parseAllowedReference(reference: string, baseValue: string): URL {
    let parsed: URL;
    try { parsed = new URL(reference); } catch { throw new BadRequestException("externalReference must be an absolute DICOMweb URL."); }
    const allowed = new URL(baseValue);
    if (parsed.username || parsed.password) throw new BadRequestException("DICOMweb references must not contain embedded credentials.");
    if (parsed.protocol !== allowed.protocol || parsed.host !== allowed.host || !parsed.pathname.startsWith(allowed.pathname)) {
      throw new BadRequestException("DICOMweb reference is outside the configured PACS endpoint.");
    }
    return parsed;
  }

  private baseUrl(): string {
    const value = process.env.DICOMWEB_BASE_URL?.trim();
    if (!value) throw new InternalServerErrorException("DICOMWEB_BASE_URL is required for the DICOMweb provider.");
    let url: URL;
    try { url = new URL(value.endsWith("/") ? value : `${value}/`); } catch { throw new InternalServerErrorException("DICOMWEB_BASE_URL is invalid."); }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new InternalServerErrorException("Production DICOMweb requires HTTPS.");
    if (url.username || url.password) throw new InternalServerErrorException("DICOMWEB_BASE_URL must not contain embedded credentials.");
    return url.toString();
  }

  private optionalUid(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be a valid DICOM UID.`);
    return this.requiredUid(value.trim(), field);
  }

  private requiredUid(value: string | undefined, field: string): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || !UID.test(normalized) || normalized.length > 128) throw new BadRequestException(`${field} must be a valid DICOM UID.`);
    return normalized;
  }
}
