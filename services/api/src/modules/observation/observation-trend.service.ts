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
