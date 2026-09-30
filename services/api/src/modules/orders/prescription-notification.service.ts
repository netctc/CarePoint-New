import { Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { NotificationsService } from "../communications/notifications.service";

type PrescriptionNotificationOrder = {
  id: string;
  type: string;
  patientId: string;
};

type PrescriptionEvent = "SIGNED" | "CANCELLED";

@Injectable()
export class PrescriptionNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async notifySigned(principal: AuthPrincipal, order: PrescriptionNotificationOrder): Promise<void> {
    await this.notify(principal, order, "SIGNED");
  }

  async notifyCancelled(principal: AuthPrincipal, order: PrescriptionNotificationOrder): Promise<void> {
    await this.notify(principal, order, "CANCELLED");
  }

  private async notify(principal: AuthPrincipal, order: PrescriptionNotificationOrder, event: PrescriptionEvent): Promise<void> {
    if (order.type !== "PRESCRIPTION") return;
    try {
      const patient = await this.prisma.patientProfile.findUnique({
        where: { id: order.patientId },
        select: { userId: true },
      });
      if (!patient?.userId) throw new Error("Patient account is unavailable for prescription notification.");
      const suffix = event === "SIGNED" ? "prescription-signed" : "prescription-cancelled";
      const template = event === "SIGNED" ? "prescription" : "prescription.cancelled";
      await this.notifications.notifyAccount({
        accountId: patient.userId,
        dedupeKey: `clinical:${order.id}:${suffix}`,
        type: "CLINICAL_UPDATE",
        entityType: "CLINICAL_ORDER",
        entityId: order.id,
        safeTitleKey: `notification.clinical.${template}.title`,
        safeBodyKey: `notification.clinical.${template}.body`,
      });
      await this.audit.write({
        actorId: principal.accountId,
        action: `PRESCRIPTION_NOTIFICATION_${event}`,
        objectType: "CLINICAL_ORDER",
        objectId: order.id,
        purpose: "PATIENT_COMMUNICATION",
        result: "SUCCESS",
      });
    } catch {
      // The signed/cancelled clinical order remains authoritative even when an
      // auxiliary notification channel is unavailable. Retrying order creation
      // with a different idempotency key could otherwise duplicate medication
      // instructions. Record the delivery failure without leaking prescription
      // content and let the patient timeline remain the fallback source.
      try {
        await this.audit.write({
          actorId: principal.accountId,
          action: `PRESCRIPTION_NOTIFICATION_${event}`,
          objectType: "CLINICAL_ORDER",
          objectId: order.id,
          purpose: "PATIENT_COMMUNICATION",
          result: "FAILED",
        });
      } catch {
        // Notification and audit transport failures must not mutate the order.
      }
    }
  }
}
