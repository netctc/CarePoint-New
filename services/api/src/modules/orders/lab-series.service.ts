import { Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { buildLaboratorySeries } from "./lab-series.engine";
import { OrdersService } from "./orders.service";

@Injectable()
export class LabSeriesService {
  constructor(
    private readonly orders: OrdersService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async providerPatientSeries(principal: AuthPrincipal, patientId: string) {
    const orderView = await this.orders.providerPatientOrders(principal, patientId);
    const projection = buildLaboratorySeries(orderView.items);

    await this.audit.write({
      actorId: principal.accountId,
      action: "LAB_SERIES_READ",
      objectType: "PATIENT",
      objectId: orderView.patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "LABORATORY",
        accessBasis: orderView.accessBasis,
        patientId: orderView.patientId,
        seriesCount: projection.series.length,
        pointCount: projection.pointCount,
        decision: "ALLOW",
      },
    });

    return {
      patientId: orderView.patientId,
      accessBasis: orderView.accessBasis,
      ...projection,
    };
  }
}
