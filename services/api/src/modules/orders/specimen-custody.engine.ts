import { createHash } from "node:crypto";

export const SpecimenCustodyEventTypes = [
  "COLLECTED",
  "TRANSFERRED",
  "RECEIVED",
  "PROCESSING",
  "STORED",
  "DISPOSED",
] as const;

export const SpecimenConditionCodes = [
  "ACCEPTABLE",
  "COMPROMISED",
  "REJECTED",
] as const;

export type SpecimenCustodyEventType = (typeof SpecimenCustodyEventTypes)[number];
export type SpecimenConditionCode = (typeof SpecimenConditionCodes)[number];

export type SpecimenCustodyHashInput = {
  specimenId: string;
  sequence: number;
  eventType: SpecimenCustodyEventType;
  actorProviderId: string;
  receiverRef: string | null;
  occurredAt: Date | string;
  location: string | null;
  conditionCode: SpecimenConditionCode;
  previousHash: string | null;
};

export function specimenCustodyEventHash(input: SpecimenCustodyHashInput): string {
  const payload = JSON.stringify({
    specimenId: input.specimenId,
    sequence: input.sequence,
    eventType: input.eventType,
    actorProviderId: input.actorProviderId,
    receiverRef: input.receiverRef,
    occurredAt: new Date(input.occurredAt).toISOString(),
    location: input.location,
    conditionCode: input.conditionCode,
    previousHash: input.previousHash,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function verifySpecimenCustodyChain(
  events: Array<SpecimenCustodyHashInput & { eventHash: string }>,
) {
  let previousHash: string | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      return {
        verified: false as const,
        reason: "SEQUENCE_GAP" as const,
        failedSequence: event.sequence,
      };
    }
    if (event.previousHash !== previousHash) {
      return {
        verified: false as const,
        reason: "PREVIOUS_HASH_MISMATCH" as const,
        failedSequence: event.sequence,
      };
    }
    const expectedHash = specimenCustodyEventHash({ ...event, previousHash });
    if (event.eventHash !== expectedHash) {
      return {
        verified: false as const,
        reason: "EVENT_HASH_MISMATCH" as const,
        failedSequence: event.sequence,
      };
    }
    previousHash = event.eventHash;
  }
  return {
    verified: true as const,
    eventCount: events.length,
    headHash: previousHash,
  };
}
