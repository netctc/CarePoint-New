import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { DocumentsService } from "../documents/documents.service";
import { OrdersService } from "../orders/orders.service";
import { ClinicalService } from "./clinical.service";

type WorkspaceSection = {
  state: "AVAILABLE" | "RESTRICTED";
  accessBasis?: string;
  items: unknown[];
};

type RiskAlert = {
  source: "LAB_RESULT_FLAG";
  label: string;
  flag: string;
  orderId: string;
};

@Injectable()
export class ClinicalWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly clinical: ClinicalService,
    private readonly orders: OrdersService,
    private readonly documents: DocumentsService,
  ) {}

  async providerRoster(principal: AuthPrincipal) {
    const provider = await this.requireActiveProvider(principal);
    const appointments = await this.prisma.appointment.findMany({
      where: { providerId: provider.id, status: { in: ["CONFIRMED", "COMPLETED"] } },
      select: {
        startsAt: true,
        status: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startsAt: "desc" },
      take: 500,
    });
    const records = await this.prisma.clinicalRecord.findMany({
      where: { providerId: provider.id },
      select: {
        createdAt: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const patients = new Map<string, { id: string; firstName: string; lastName: string; lastInteractionAt: Date; relationshipSource: "APPOINTMENT" | "AUTHORED_RECORD" }>();
    for (const appointment of appointments) {
      const current = patients.get(appointment.patient.id);
      if (!current || appointment.startsAt > current.lastInteractionAt) {
        patients.set(appointment.patient.id, {
          ...appointment.patient,
          lastInteractionAt: appointment.startsAt,
          relationshipSource: "APPOINTMENT",
        });
      }
    }
    for (const record of records) {
      const current = patients.get(record.patient.id);
      if (!current || record.createdAt > current.lastInteractionAt) {
        patients.set(record.patient.id, {
          ...record.patient,
          lastInteractionAt: record.createdAt,
          relationshipSource: "AUTHORED_RECORD",
        });
      }
    }

    const items = [...patients.values()]
      .sort((left, right) => right.lastInteractionAt.getTime() - left.lastInteractionAt.getTime())
      .map((item) => ({ ...item, lastInteractionAt: item.lastInteractionAt.toISOString() }));

    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_WORKSPACE_ROSTER_READ",
      objectType: "PROVIDER",
      objectId: provider.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { itemCount: items.length },
    });

    return {
      viewer: { providerId: provider.id, displayName: provider.displayName, class: provider.class },
      items,
    };
  }

  async providerWorkspace(principal: AuthPrincipal, patientId: string) {
    const provider = await this.requireActiveProvider(principal);
    const timeline = await this.clinical.providerPatientTimeline(principal, patientId);
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");

    const [orders, documents, diagnosticReports] = await Promise.all([
      this.section(() => this.orders.providerPatientOrders(principal, patient.id)),
      this.section(() => this.documents.providerPatientDocuments(principal, patient.id)),
      this.section(() => this.documents.providerPatientDiagnosticReports(principal, patient.id)),
    ]);

    const riskAlerts = this.labResultFlags(orders);
    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_WORKSPACE_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        basis: timeline.accessBasis,
        encounterCount: timeline.items.length,
        orderSection: orders.state,
        documentSection: documents.state,
        diagnosticReportSection: diagnosticReports.state,
        riskAlertCount: riskAlerts.length,
      },
    });

    return {
      patient,
      viewer: { providerId: provider.id, displayName: provider.displayName, class: provider.class },
      accessBasis: timeline.accessBasis,
      timeline: timeline.items,
      orders,
      documents,
      diagnosticReports,
      riskAlerts,
      security: {
        encryptedClinicalRecords: true,
        auditedAccess: true,
        serverSideAccessBasisEnforced: true,
        automatedClinicalRiskInference: false,
      },
    };
  }

  private async section(loader: () => Promise<unknown>): Promise<WorkspaceSection> {
    try {
      const value = await loader();
      if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "AVAILABLE", items: [] };
      const row = value as Record<string, unknown>;
      return {
        state: "AVAILABLE",
        ...(typeof row.accessBasis === "string" ? { accessBasis: row.accessBasis } : {}),
        items: Array.isArray(row.items) ? row.items : [],
      };
    } catch (error) {
      if (error instanceof ForbiddenException) return { state: "RESTRICTED", items: [] };
      throw error;
    }
  }

  private labResultFlags(section: WorkspaceSection): RiskAlert[] {
    if (section.state !== "AVAILABLE") return [];
    const alerts: RiskAlert[] = [];
    for (const rawOrder of section.items) {
      if (!rawOrder || typeof rawOrder !== "object" || Array.isArray(rawOrder)) continue;
      const order = rawOrder as Record<string, unknown>;
      const orderId = typeof order.id === "string" ? order.id : "";
      const labResult = this.object(order.labResult);
      const data = this.object(labResult.data);
      const observations = Array.isArray(data.observations) ? data.observations : [];
      for (const rawObservation of observations) {
        const observation = this.object(rawObservation);
        const flag = typeof observation.flag === "string" ? observation.flag.trim() : "";
        if (!flag) continue;
        const label = this.firstText(observation.display, observation.code, "Laboratory observation");
        alerts.push({ source: "LAB_RESULT_FLAG", label, flag, orderId });
        if (alerts.length >= 50) return alerts;
      }
    }
    return alerts;
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private firstText(...values: unknown[]): string {
    for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
    return "Clinical signal";
  }

  private async requireActiveProvider(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Clinical workspace access requires an active healthcare provider account.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, class: true, displayName: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ForbiddenException("Clinical workspace access requires an active healthcare provider profile.");
    }
    return provider;
  }
}
