import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ObservationService } from "./observation.service";
import { buildObservationTrend, normalizeTrendSourceType } from "./observation-trend.engine";

@Injectable()
export class ObservationTrendService {
  constructor(
    private readonly observations: ObservationService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async patientStats(
    principal: AuthPrincipal,
    code: string,
    from?: string,
    to?: string,
  ) {
    const history = await this.observations.historyMine(principal, code, from, to, 500);
    const projection = buildObservationTrend(history.items, null);
    const series = projection.series.map((item) => {
      const latestPoint = item.points.length > 0 ? item.points[item.points.length - 1] : null;
      return {
        canonicalUnitCode: item.canonicalUnitCode,
        count: item.count,
        latest: latestPoint?.canonicalValue ?? null,
        latestObservedAt: latestPoint?.observedAt ?? null,
        minimum: item.minimum,
        maximum: item.maximum,
        average: item.average,
        firstObservedAt: item.firstObservedAt,
        lastObservedAt: item.lastObservedAt,
      };
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OBSERVATION_STATS_READ",
      objectType: "PATIENT",
      objectId: history.patientId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "OBSERVATION",
        patientId: history.patientId,
        metricCode: history.code,
        accessBasis: history.accessBasis,
        measurementCount: projection.table.length,
        seriesCount: series.length,
        unitConsistency: projection.unitConsistency,
        decision: "ALLOW",
      },
    });

    return {
      patientId: history.patientId,
      code: history.code,
      accessBasis: history.accessBasis,
      from: from ?? null,
      to: to ?? null,
      measurementCount: projection.table.length,
      unitConsistency: projection.unitConsistency,
      series,
      automatedClinicalInference: false,
      automatedDiagnosis: false,
    };
  }

  async providerTrend(
    principal: AuthPrincipal,
    patientId: string,
    code: string,
    from?: string,
    to?: string,
    sourceType?: string,
  ) {
    const normalizedSource = this.source(sourceType);
    const history = await this.observations.historyForDoctor(principal, patientId, code, from, to, 500);
    const projection = buildObservationTrend(history.items, normalizedSource);

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OBSERVATION_TRENDS_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OBSERVATION",
        patientId,
        metricCode: history.code,
        accessBasis: history.accessBasis,
        sourceType: normalizedSource,
        itemCount: projection.table.length,
        seriesCount: projection.series.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      code: history.code,
      accessBasis: history.accessBasis,
      from: from ?? null,
      to: to ?? null,
      ...projection,
    };
  }

  private source(value?: string) {
    try {
      return normalizeTrendSourceType(value);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid sourceType.");
    }
  }
}
