import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";

export const DAY_MS = 86_400_000;
export const TELEHEALTH_CHANGE_BUFFER_MS = 30 * 60_000;
export function journeyId(value: unknown, field = "identifier", min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > 128 || /[\u0000-\u001f\u007f]/.test(value)) throw new BadRequestException(`${field} is invalid.`);
  return value.trim();
}
export function journeyInstant(value: unknown, field: string): Date {
  if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO timestamp with timezone.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const parsed = new Date(value);
  if (!match || !Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO timestamp with timezone.`);
  const [, y, m, d, h, minute, second] = match;
  const civil = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (civil.toISOString().slice(0, 10) !== `${y}-${m}-${d}` || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59) throw new BadRequestException(`${field} is an invalid calendar timestamp.`);
  return parsed;
}
export function journeyWindow(from: unknown, to: unknown, maxDays = 31) {
  const start = journeyInstant(from, "from");
  const end = journeyInstant(to, "to");
  if (end <= start || end.getTime() - start.getTime() > maxDays * DAY_MS) throw new BadRequestException(`The interval must be positive and no longer than ${maxDays} days.`);
  return { from: start, to: end };
}
export function journeyHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function assertFutureChange(appointment: { status: string; modality: string; startsAt: Date; telehealthSession?: { status: string; startedAt: Date | null; endedAt: Date | null } | null }, now: Date) {
  if (!["REQUESTED", "CONFIRMED"].includes(appointment.status)) throw new ConflictException("Only active appointments can be rescheduled.");
  const buffer = appointment.modality === "TELEMEDICINE" ? TELEHEALTH_CHANGE_BUFFER_MS : 0;
  if (appointment.startsAt.getTime() <= now.getTime() + buffer) throw new ConflictException("The appointment has started or entered its telemedicine preparation window. Contact the provider.");
  const session = appointment.telehealthSession;
  if (session && (session.startedAt || session.endedAt || ["ACTIVE", "ENDED", "CANCELLED"].includes(session.status))) throw new ConflictException("A started or ended consultation cannot be rescheduled.");
}
