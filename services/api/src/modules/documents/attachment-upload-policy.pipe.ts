import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { assertDeclaredClinicalAttachmentMediaType } from "./attachment-content-policy";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

@Injectable()
export class AttachmentUploadPolicyPipe implements PipeTransform {
  transform(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const input = value as Record<string, unknown>;
    if (typeof input.contentBase64 !== "string") return value;
    const compact = input.contentBase64.replace(/\s+/g, "");
    if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      throw new BadRequestException("contentBase64 must be valid base64.");
    }
    const bytes = Buffer.from(compact, "base64");
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(`Clinical attachment must contain between 1 and ${MAX_ATTACHMENT_BYTES} bytes.`);
    }
    assertDeclaredClinicalAttachmentMediaType(input.mediaType, bytes);
    return value;
  }
}
