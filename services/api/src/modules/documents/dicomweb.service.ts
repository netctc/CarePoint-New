import { BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";

const UID = /^\d+(?:\.\d+)+$/;

@Injectable()
export class DicomWebService {
  normalizeReference(input: Record<string, unknown>): string {
    const provider = process.env.DICOMWEB_PROVIDER ?? (process.env.NODE_ENV === "production" ? "dicomweb" : "mock");
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
    let parsed: URL;
    try { parsed = new URL(reference); } catch { throw new BadRequestException("externalReference must be an absolute DICOMweb URL."); }
    const allowed = new URL(base);
    if (parsed.protocol !== allowed.protocol || parsed.host !== allowed.host || !parsed.pathname.startsWith(allowed.pathname)) {
      throw new BadRequestException("DICOMweb reference is outside the configured PACS endpoint.");
    }
    return parsed.toString();
  }

  descriptor(): { provider: "DICOMWEB"; proxyRequired: true } {
    return { provider: "DICOMWEB", proxyRequired: true };
  }

  private baseUrl(): string {
    const value = process.env.DICOMWEB_BASE_URL?.trim();
    if (!value) throw new InternalServerErrorException("DICOMWEB_BASE_URL is required for the DICOMweb provider.");
    let url: URL;
    try { url = new URL(value.endsWith("/") ? value : `${value}/`); } catch { throw new InternalServerErrorException("DICOMWEB_BASE_URL is invalid."); }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new InternalServerErrorException("Production DICOMweb requires HTTPS.");
    return url.toString();
  }

  private optionalUid(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !UID.test(value.trim()) || value.trim().length > 128) throw new BadRequestException(`${field} must be a valid DICOM UID.`);
    return value.trim();
  }
}
