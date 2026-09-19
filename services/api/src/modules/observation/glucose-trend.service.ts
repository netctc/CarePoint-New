import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalProfileService } from "../clinical-profile/clinical-profile.service";
import { OrdersService } from "../orders/orders.service";
import {
  buildMedicationStatementEvents,
  buildPrescriptionEvents,
  normalizeGlucoseMetricSelection,
} from "./glucose-trend.engine";
import { isGlucoseMetricCode } from "./observation.engine";
import { ObservationTrendService } from "./observation-trend.service";

type OverlaySection = {
  state: "AVAILABLE" | "RESTRICTED";
  accessBasis: string | null;
  items: ReturnType<typeof buildMedicationStatementEvents>;
};

@Injectable()
export class GlucoseTrendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trends: ObservationTrendService,
    private readonly clinicalProfile: ClinicalProfileService,
    private readonly orders: OrdersService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async providerTrend(
    principal: AuthPrincipal,
    patientId: string,
    code?: string,
    from?: string,
    to?: string,
    sourceType?: string,
  ) {
    const metric = await this.resolveMetric(code);
    const trend = await this.trends.providerTrend(principal, patientId, metric.code, from, to, sourceType);
    const [medications, prescriptions] = await Promise.all([
      this.medicationStatements(principal, patientId),
      this.prescriptionEvents(principal, patientId),
    ]);

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "GLUCOSE_TRENDS_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OBSERVATION",
        patientId,
        metricCode: metric.code,
        accessBasis: trend.accessBasis,
        pointCount: trend.table.length,
        medicationOverlayState: medications.state,
        prescriptionOverlayState: prescriptions.state,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      code: metric.code,
      availableMetricCodes: metric.availableMetricCodes,
      accessBasis: trend.accessBasis,
      from: trend.from,
      to: trend.to,
      state: trend.state,
      sourceType: trend.sourceType,
      unitConsistency: trend.unitConsistency,
      series: trend.series,
      table: trend.table,
      overlays: {
        medicationStatements: medications,
        prescriptions,
      },
      automatedClinicalInference: false,
      causalInference: false,
    };
  }

  private async resolveMetric(requested?: string) {
    const rows = await this.prisma.observationType.findMany({
      where: {
        active: true,
        versions: { some: { status: "ACTIVE" } },
      },
      select: { code: true },
      orderBy: { code: "asc" },
    });
    const availableMetricCodes = rows.map((row) => row.code).filter((candidate) => {
      try {
        return isGlucoseMetricCode(candidate);
      } catch {
        return false;
      }
    });
    if (availableMetricCodes.length === 0) {
      throw new NotFoundException("No active glucose observation metric is configured.");
    }

    if (requested !== undefined && requested !== null && requested !== "") {
      const code = normalizeGlucoseMetricSelection(requested);
      if (!availableMetricCodes.includes(code)) {
        throw new NotFoundException("Requested glucose observation metric is not active.");
      }
      return { code, availableMetricCodes };
    }

    const code = availableMetricCodes.find((item) => item === "BLOOD_GLUCOSE")
      ?? availableMetricCodes.find((item) => item === "GLUCOSE")
      ?? availableMetricCodes[0];
    return { code, availableMetricCodes };
  }

  private async medicationStatements(principal: AuthPrincipal, patientId: string): Promise<OverlaySection> {
    try {
      const view = await this.clinicalProfile.listForDoctor(principal, patientId, "MEDICATION");
      return {
        state: "AVAILABLE",
        accessBasis: view.accessBasis,
        items: buildMedicationStatementEvents(view.items),
      };
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      return { state: "RESTRICTED", accessBasis: null, items: [] };
    }
  }

  private async prescriptionEvents(principal: AuthPrincipal, patientId: string): Promise<OverlaySection> {
    try {
      const view = await this.orders.providerPatientOrders(principal, patientId);
      return {
        state: "AVAILABLE",
        accessBasis: view.accessBasis,
        items: buildPrescriptionEvents(view.items),
      };
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      return { state: "RESTRICTED", accessBasis: null, items: [] };
    }
  }
}
