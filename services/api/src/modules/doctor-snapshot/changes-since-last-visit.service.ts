import { Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { buildChangesSinceLastVisit } from "./changes-since-last-visit.engine";
import { DoctorSnapshotService } from "./doctor-snapshot.service";

@Injectable()
export class ChangesSinceLastVisitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly snapshot: DoctorSnapshotService,
  ) {}

  async get(principal: AuthPrincipal, patientId: string) {
    const snapshot = await this.snapshot.patientSnapshot(principal, patientId);
    const restrictedSections = this.restrictedSections(snapshot);
    const previous = snapshot.previousConsult;
    const since = previous ? (previous.endsAt ?? previous.startsAt) : null;

    if (!since) {
      const projection = buildChangesSinceLastVisit({
        patientId,
        since: null,
        healthProfile: [],
        clinicalProfile: [],
        questionnaires: [],
        observations: [],
        restrictedSections,
      });
      await this.writeAudit(principal, snapshot.viewer.providerId, projection);
      return {
        previousConsult: null,
        ...projection,
      };
    }

    const healthProfileId = snapshot.healthProfile.state === "AVAILABLE"
      ? this.text(this.object(snapshot.healthProfile.value).id)
      : null;
    const clinicalProfileAllowed = snapshot.clinicalProfile.state === "AVAILABLE";
    const questionnaireAllowed = snapshot.questionnaires.state === "AVAILABLE";
    const accessibleMetricCodes = snapshot.observations
      .filter((item) => item.section.state === "AVAILABLE")
      .map((item) => item.code);

    const [healthProfile, clinicalProfile, questionnaires, observations] = await Promise.all([
      healthProfileId
        ? this.prisma.profileRevision.findMany({
            where: { profileId: healthProfileId, createdAt: { gt: since } },
            select: {
              id: true,
              profileId: true,
              version: true,
              sourceType: true,
              sourceActorId: true,
              changedFields: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
            take: 500,
          })
        : Promise.resolve([]),
      clinicalProfileAllowed
        ? this.prisma.clinicalProfileEntryRevision.findMany({
            where: {
              createdAt: { gt: since },
              entry: { patientId },
            },
            select: {
              id: true,
              entryId: true,
              version: true,
              changedFields: true,
              verificationStatus: true,
              sourceType: true,
              sourceActorId: true,
              createdAt: true,
              entry: { select: { kind: true, status: true } },
            },
            orderBy: { createdAt: "asc" },
            take: 1000,
          })
        : Promise.resolve([]),
      questionnaireAllowed
        ? this.prisma.questionnaireResponse.findMany({
            where: { patientId, completedAt: { gt: since } },
            select: {
              id: true,
              sequence: true,
              healthChanged: true,
              changedQuestionIds: true,
              sourceType: true,
              sourceActorId: true,
              completedAt: true,
              questionnaire: { select: { code: true } },
              questionnaireVersion: { select: { version: true } },
            },
            orderBy: { completedAt: "asc" },
            take: 500,
          })
        : Promise.resolve([]),
      accessibleMetricCodes.length > 0
        ? this.prisma.observation.findMany({
            where: {
              patientId,
              observedAt: { gt: since },
              observationType: { code: { in: accessibleMetricCodes } },
            },
            select: {
              id: true,
              observedAt: true,
              sourceType: true,
              sourceId: true,
              createdByActorId: true,
              observationType: { select: { code: true } },
            },
            orderBy: { observedAt: "asc" },
            take: 2000,
          })
        : Promise.resolve([]),
    ]);

    const projection = buildChangesSinceLastVisit({
      patientId,
      since,
      healthProfile,
      clinicalProfile,
      questionnaires,
      observations,
      restrictedSections,
    });
    await this.writeAudit(principal, snapshot.viewer.providerId, projection);

    return {
      previousConsult: {
        appointmentId: previous.appointmentId,
        startsAt: previous.startsAt,
        endsAt: previous.endsAt,
      },
      ...projection,
    };
  }

  private restrictedSections(snapshot: Awaited<ReturnType<DoctorSnapshotService["patientSnapshot"]>>) {
    const restricted = new Set<string>();
    if (snapshot.healthProfile.state === "RESTRICTED") restricted.add("HEALTH_PROFILE");
    if (snapshot.clinicalProfile.state === "RESTRICTED") restricted.add("CLINICAL_PROFILE");
    if (snapshot.questionnaires.state === "RESTRICTED") restricted.add("QUESTIONNAIRE");
    for (const item of snapshot.observations) {
      if (item.section.state === "RESTRICTED") restricted.add(`OBSERVATION:${item.code}`);
    }
    return [...restricted].sort();
  }

  private async writeAudit(
    principal: AuthPrincipal,
    providerId: string,
    projection: ReturnType<typeof buildChangesSinceLastVisit>,
  ) {
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "DOCTOR_CHANGES_SINCE_LAST_VISIT_READ",
      objectType: "PATIENT",
      objectId: projection.patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "CHANGES_SINCE_LAST_VISIT",
        patientId: projection.patientId,
        providerId,
        available: projection.available,
        itemCount: projection.changes.length,
        restrictedSectionCount: projection.restrictedSections.length,
        decision: "ALLOW",
      },
    });
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private text(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
