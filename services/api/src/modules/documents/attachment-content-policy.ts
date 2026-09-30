import { BadRequestException } from "@nestjs/common";

export const SupportedClinicalAttachmentMediaTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/dicom",
  "text/plain",
] as const;

export function sniffClinicalAttachmentMediaType(bytes: Uint8Array): string {
  const data = Buffer.from(bytes);
  if (data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (
    data.length >= 8 &&
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
    data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  ) return "image/png";
  if (data.length >= 132 && data.subarray(128, 132).toString("ascii") === "DICM") return "application/dicom";
  if (isLikelyText(data)) return "text/plain";
  return "application/octet-stream";
}

export function assertDeclaredClinicalAttachmentMediaType(declaredMediaType: unknown, bytes: Uint8Array): string {
  if (typeof declaredMediaType !== "string" || !declaredMediaType.trim()) {
    throw new BadRequestException("Clinical attachment mediaType is required.");
  }
  const declared = declaredMediaType.trim().toLowerCase();
  if (!(SupportedClinicalAttachmentMediaTypes as readonly string[]).includes(declared)) {
    throw new BadRequestException("Unsupported clinical attachment mediaType.");
  }
  const detected = sniffClinicalAttachmentMediaType(bytes);
  if (!(SupportedClinicalAttachmentMediaTypes as readonly string[]).includes(detected)) {
    throw new BadRequestException("Clinical attachment content type is not supported.");
  }
  if (detected !== declared) {
    throw new BadRequestException("Clinical attachment media type does not match its content.");
  }
  return detected;
}

function isLikelyText(data: Buffer): boolean {
  const decoded = data.toString("utf8");
  if (decoded.includes("\uFFFD") || decoded.includes("\u0000")) return false;
  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index]!;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false;
  }
  return true;
}
