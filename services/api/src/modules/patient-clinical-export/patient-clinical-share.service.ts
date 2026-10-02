import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PatientContextService } from "../dependents/dependents.service";
import { DocumentsEnvelopeService } from "../documents/documents-envelope.service";
import { PatientHealthSummaryService } from "../patient-health-summary/patient-health-summary.service";

const SHARE_SCOPES = [
  "OBSERVATIONS",
  "MEDICATIONS",
  "DEVICES",
  "QUESTIONNAIRE",
  "CARE_PLAN",
] as const;
type PatientClinicalShareScope = (typeof SHARE_SCOPES)[number];
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 60;

export interface CreatePatientClinicalShareInput {
  scope?: string;
  ttlMinutes?: number;
}

@Injectable()
export class PatientClinicalShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly contexts: PatientContextService,
    private readonly summary: PatientHealthSummaryService,
    private readonly envelope: DocumentsEnvelopeService,
  ) {}

  async list(principal: AuthPrincipal) {
    this.assertPatient(principal);
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const rows = await this.prisma.patientClinicalShare.findMany({
      where: { accountId: principal.accountId, patientId: context.patientId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const now = Date.now();
    return {
      patientId: context.patientId,
      contextMode: context.mode,
      items: rows.map((row) => ({
        id: row.id,
        scope: row.scope,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        lastAccessedAt: row.lastAccessedAt,
        accessCount: row.accessCount,
        active: !row.revokedAt && row.expiresAt.getTime() > now,
      })),
    };
  }

  async create(principal: AuthPrincipal, input: CreatePatientClinicalShareInput) {
    this.assertPatient(principal);
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const scope = this.scope(input?.scope);
    const ttlMinutes = this.ttl(input?.ttlMinutes);

    const fullSummary = await this.summary.get(principal);
    if (fullSummary.patientId !== context.patientId) {
      throw new ConflictException("Patient context changed while preparing the temporary share.");
    }
    const payload = {
      schemaVersion: 1,
      scope,
      generatedAt: fullSummary.generatedAt,
      automatedDiagnosis: false,
      section: this.project(fullSummary.sections, scope),
    };
    const bytes = Buffer.from(JSON.stringify(payload), "utf8");
    const contentDigest = this.sha256(bytes);
    const encrypted = await this.envelope.encryptBytes(bytes);

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = this.sha256(rawToken);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const row = await this.prisma.patientClinicalShare.create({
      data: {
        patientId: context.patientId,
        accountId: principal.accountId,
        relationId: context.relationId,
        scope,
        tokenHash,
        algorithm: encrypted.envelope.algorithm,
        keyId: encrypted.envelope.keyId,
        wrappedKey: encrypted.envelope.wrappedKey,
        iv: encrypted.envelope.iv,
        ciphertext: encrypted.ciphertext,
        contentDigest,
        expiresAt,
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_CLINICAL_SHARE_CREATED",
      objectType: "PATIENT_CLINICAL_SHARE",
      objectId: row.id,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        patientId: context.patientId,
        contextMode: context.mode,
        relationId: context.relationId,
        scope,
        expiresAt,
        contentDigest,
        tokenPersisted: false,
        decision: "ALLOW",
      },
    });
    return {
      id: row.id,
      scope,
      createdAt: row.createdAt,
      expiresAt,
      relativePath: `/s/${rawToken}`,
      tokenPresentedOnce: true,
    };
  }

  async revoke(principal: AuthPrincipal, shareIdInput: string) {
    this.assertPatient(principal);
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const shareId = this.id(shareIdInput, "shareId");
    const row = await this.prisma.patientClinicalShare.findFirst({
      where: { id: shareId, accountId: principal.accountId, patientId: context.patientId },
    });
    if (!row) throw new NotFoundException("Temporary clinical share not found.");
    if (row.revokedAt) return { id: row.id, revokedAt: row.revokedAt, active: false };

    const revokedAt = new Date();
    const updated = await this.prisma.patientClinicalShare.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt },
    });
    if (updated.count !== 1) {
      const current = await this.prisma.patientClinicalShare.findUnique({ where: { id: row.id } });
      return { id: row.id, revokedAt: current?.revokedAt ?? revokedAt, active: false };
    }
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_CLINICAL_SHARE_REVOKED",
      objectType: "PATIENT_CLINICAL_SHARE",
      objectId: row.id,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        patientId: row.patientId,
        scope: row.scope,
        decision: "ALLOW",
      },
    });
    return { id: row.id, revokedAt, active: false };
  }

  async readPublic(tokenInput: unknown) {
    const token = this.token(tokenInput);
    const tokenHash = this.sha256(token);
    const row = await this.prisma.patientClinicalShare.findUnique({ where: { tokenHash } });
    if (!row) throw new NotFoundException("Temporary clinical share is unavailable.");
    if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("Temporary clinical share is no longer active.");
    }

    const authorityValid = await this.shareAuthorityIsStillValid(row);
    if (!authorityValid) {
      await this.prisma.patientClinicalShare.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.writeClinical({
        actorId: null,
        action: "PATIENT_CLINICAL_SHARE_ACCESS_DENIED",
        objectType: "PATIENT_CLINICAL_SHARE",
        objectId: row.id,
        purpose: "TEMPORARY_PATIENT_SHARE",
        result: "DENIED",
        metadata: {
          patientId: row.patientId,
          scope: row.scope,
          reasonCode: "SOURCE_AUTHORITY_INACTIVE",
          decision: "DENY",
        },
      });
      throw new GoneException("Temporary clinical share is no longer active.");
    }

    const bytes = await this.envelope.decryptBytes(this.asEnvelope(row));
    if (this.sha256(bytes) !== row.contentDigest) {
      throw new ConflictException("Temporary clinical share integrity validation failed.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new ConflictException("Temporary clinical share payload is invalid.");
    }

    const accessedAt = new Date();
    const touched = await this.prisma.patientClinicalShare.updateMany({
      where: {
        id: row.id,
        revokedAt: null,
        expiresAt: { gt: accessedAt },
      },
      data: {
        lastAccessedAt: accessedAt,
        accessCount: { increment: 1 },
      },
    });
    if (touched.count !== 1) throw new GoneException("Temporary clinical share is no longer active.");

    await this.audit.writeClinical({
      actorId: null,
      action: "PATIENT_CLINICAL_SHARE_ACCESSED",
      objectType: "PATIENT_CLINICAL_SHARE",
      objectId: row.id,
      purpose: "TEMPORARY_PATIENT_SHARE",
      result: "SUCCESS",
      metadata: {
        patientId: row.patientId,
        scope: row.scope,
        viewerAuthenticated: false,
        contentDigest: row.contentDigest,
        decision: "ALLOW",
      },
    });

    return {
      shareId: row.id,
      scope: row.scope,
      expiresAt: row.expiresAt,
      sharedAt: row.createdAt,
      ...this.object(payload),
    };
  }

  renderPublicHtml(share: Record<string, any>) {
    const escape = (value: unknown) => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
    const date = (value: unknown) => {
      if (!value) return "—";
      const parsed = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(parsed.getTime())
        ? escape(value)
        : escape(parsed.toISOString().replace("T", " ").replace(".000Z", " UTC"));
    };
    const scope = String(share.scope ?? "").toUpperCase();
    const section = this.object(share.section);
    const titles: Record<string, string> = {
      OBSERVATIONS: "Recent observations",
      MEDICATIONS: "Medications",
      DEVICES: "Medical devices",
      QUESTIONNAIRE: "Questionnaire summary",
      CARE_PLAN: "Care plan",
    };
    const title = titles[scope] ?? "Clinical summary";
    const state = escape(section.state ?? "AVAILABLE");
    const row = (label: string, value: unknown) =>
      '<div class="kv"><span>' + escape(label) + '</span><strong>' +
      (value == null || value === "" ? "—" : escape(value)) + "</strong></div>";
    const card = (heading: string, body: string) =>
      '<article class="card"><h3>' + escape(heading) + "</h3>" + body + "</article>";

    let content = "";
    if (scope === "OBSERVATIONS") {
      const items = this.array(section.items);
      content = items.length === 0
        ? '<div class="empty">No observations are included in this temporary share.</div>'
        : '<div class="grid">' + items.map((item) => {
            const labels = this.object(item.labels);
            const heading = labels.en ?? item.code ?? "Observation";
            return card(String(heading),
              row("Value", [item.value, item.unitCode].filter(Boolean).join(" ")) +
              row("Observed", date(item.observedAt)) +
              row("Category", item.category) +
              row("Source", item.sourceType) +
              row("Verification", item.verificationStatus));
          }).join("") + "</div>";
    } else if (scope === "MEDICATIONS") {
      const items = this.array(section.items);
      content = items.length === 0
        ? '<div class="empty">No medications are included in this temporary share.</div>'
        : '<div class="grid">' + items.map((item) => card(
            String(item.name ?? "Medication"),
            row("Dose", item.dose) +
            row("Frequency", item.frequency) +
            row("Medication status", item.medicationStatus ?? item.status) +
            row("Source", item.sourceType) +
            row("Recorded", date(item.recordedAt))
          )).join("") + "</div>";
    } else if (scope === "DEVICES") {
      const items = this.array(section.items);
      content = items.length === 0
        ? '<div class="empty">No medical devices are included in this temporary share.</div>'
        : '<div class="grid">' + items.map((item) => card(
            String(item.display ?? item.deviceType ?? "Medical device"),
            row("Device type", item.deviceType) +
            row("Implanted on", date(item.implantedOn)) +
            row("Facility", item.facility) +
            row("Verification", item.verificationStatus) +
            row("Recorded", date(item.recordedAt))
          )).join("") + "</div>";
    } else if (scope === "QUESTIONNAIRE") {
      const item = this.object(section.item);
      const labels = this.object(item.labels);
      content = Object.keys(item).length === 0
        ? '<div class="empty">No questionnaire summary is included in this temporary share.</div>'
        : card(String(labels.en ?? item.code ?? "Questionnaire"),
            row("Version", item.questionnaireVersion) +
            row("Last completed", date(item.lastCompletedAt)) +
            row("Due", item.due === true ? "Yes" : "No") +
            row("Due reason", item.dueReason) +
            row("Due at", date(item.dueAt)));
    } else if (scope === "CARE_PLAN") {
      const item = this.object(section.item);
      const nextTask = this.object(item.nextTask);
      content = Object.keys(item).length === 0
        ? '<div class="empty">No care plan is included in this temporary share.</div>'
        : card(String(item.title ?? "Care plan"),
            row("Status", item.status) +
            row("Version", item.version) +
            row("Review at", date(item.reviewAt)) +
            row("Effective until", date(item.effectiveUntil)) +
            (Object.keys(nextTask).length === 0 ? "" :
              '<h4>Next task</h4>' +
              row("Task", nextTask.label ?? nextTask.kind) +
              row("Task status", nextTask.status) +
              row("Due at", date(nextTask.dueAt))));
    } else {
      content = '<div class="empty">This temporary share does not contain a supported section.</div>';
    }

    return [
      "<!doctype html>",
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>CarePoint · " + escape(title) + "</title>",
      "<style>",
      ":root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;background:#f1f5f9}",
      "*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#e0f2fe 0,#f8fafc 260px);min-height:100vh}",
      ".wrap{max-width:980px;margin:0 auto;padding:32px 18px 64px}",
      ".brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}.mark{width:46px;height:46px;border-radius:14px;background:#0284c7;color:#fff;display:grid;place-items:center;font-weight:900;font-size:20px}.brand strong{font-size:22px}.brand small{display:block;color:#475569;margin-top:2px}",
      ".hero{background:#fff;border:1px solid #dbeafe;border-radius:22px;padding:24px;box-shadow:0 16px 45px rgba(15,23,42,.08)}",
      ".badge{display:inline-flex;padding:6px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}",
      "h1{font-size:clamp(25px,4vw,38px);margin:12px 0 7px}h2{font-size:20px;margin:28px 0 12px}h3{font-size:17px;margin:0 0 12px}h4{margin:16px 0 8px;color:#334155}.muted{color:#64748b;line-height:1.55}",
      ".meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:20px}.meta div{background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:12px}.meta span{display:block;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}.meta strong{display:block;margin-top:4px;font-size:13px;overflow-wrap:anywhere}",
      ".grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;box-shadow:0 5px 18px rgba(15,23,42,.04)}",
      ".kv{display:flex;gap:16px;justify-content:space-between;border-top:1px solid #f1f5f9;padding:9px 0}.kv:first-of-type{border-top:0}.kv span{color:#64748b}.kv strong{text-align:right;overflow-wrap:anywhere}",
      ".empty{background:#fff;border:1px dashed #cbd5e1;border-radius:16px;padding:28px;text-align:center;color:#64748b}",
      ".notice{margin-top:22px;padding:15px 16px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;line-height:1.5}.footer{margin-top:24px;color:#64748b;font-size:12px;line-height:1.55}",
      "@media(max-width:680px){.wrap{padding-top:20px}.hero{padding:18px}.meta,.grid{grid-template-columns:1fr}.kv{align-items:flex-start}.kv strong{max-width:58%}}",
      "</style></head><body><main class=\"wrap\">",
      '<div class="brand"><div class="mark">CP</div><div><strong>CarePoint</strong><small>Temporary secure clinical share</small></div></div>',
      '<section class="hero"><span class="badge">Read-only · temporary</span>',
      "<h1>" + escape(title) + "</h1>",
      '<p class="muted">This page contains only the section selected by the patient. It is protected by a high-entropy temporary link and is not an authenticated CarePoint session.</p>',
      '<div class="meta"><div><span>Status</span><strong>' + state + '</strong></div>',
      '<div><span>Shared</span><strong>' + date(share.sharedAt) + '</strong></div>',
      '<div><span>Expires</span><strong>' + date(share.expiresAt) + "</strong></div></div></section>",
      "<h2>" + escape(title) + "</h2>",
      content,
      '<div class="notice"><strong>Privacy notice:</strong> Anyone holding this link or its QR code can view this temporary summary until it expires or the patient revokes it. Do not forward it unless authorized by the patient.</div>',
      '<div class="footer">Generated by CarePoint. This temporary summary is read-only and does not provide access to the patient account. Automated diagnosis is not performed by this share.</div>',
      "</main></body></html>",
    ].join("");
  }

  private async shareAuthorityIsStillValid(row: {
    patientId: string;
    accountId: string;
    relationId: string | null;
  }) {
    if (row.relationId) {
      try {
        const relation = await this.contexts.effectiveRelation(row.accountId, row.patientId, "CLINICAL_READ");
        return relation.id === row.relationId;
      } catch {
        return false;
      }
    }
    const self = await this.prisma.patientProfile.findFirst({
      where: { id: row.patientId, userId: row.accountId },
      select: { id: true },
    });
    return Boolean(self);
  }

  private project(sections: Record<string, any>, scope: PatientClinicalShareScope) {
    switch (scope) {
      case "OBSERVATIONS":
        return {
          state: sections.observations?.state ?? "EMPTY",
          items: this.array(sections.observations?.items).map((item) => ({
            code: item.code ?? null,
            labels: item.labels ?? null,
            category: item.category ?? null,
            value: item.value ?? null,
            unitCode: item.unitCode ?? null,
            observedAt: item.observedAt ?? null,
            sourceType: item.sourceType ?? null,
            verificationStatus: item.verificationStatus ?? null,
          })),
        };
      case "MEDICATIONS":
        return {
          state: sections.medications?.state ?? "EMPTY",
          items: this.array(sections.medications?.items).map((item) => ({
            name: item.name ?? null,
            dose: item.dose ?? null,
            frequency: item.frequency ?? null,
            medicationStatus: item.medicationStatus ?? null,
            status: item.status ?? null,
            sourceType: item.sourceType ?? null,
            verificationStatus: item.verificationStatus ?? null,
            recordedAt: item.recordedAt ?? null,
          })),
        };
      case "DEVICES":
        return {
          state: sections.devices?.state ?? "EMPTY",
          items: this.array(sections.devices?.items).map((item) => ({
            display: item.display ?? null,
            deviceType: item.deviceType ?? null,
            implantedOn: item.implantedOn ?? null,
            facility: item.facility ?? null,
            sourceType: item.sourceType ?? null,
            verificationStatus: item.verificationStatus ?? null,
            recordedAt: item.recordedAt ?? null,
          })),
        };
      case "QUESTIONNAIRE": {
        const item = this.object(sections.questionnaire?.item);
        return {
          state: sections.questionnaire?.state ?? "EMPTY",
          item: Object.keys(item).length === 0 ? null : {
            code: item.code ?? null,
            labels: item.labels ?? null,
            questionnaireVersion: item.questionnaireVersion ?? null,
            lastCompletedAt: item.lastCompletedAt ?? null,
            due: item.due ?? false,
            dueReason: item.dueReason ?? null,
            dueAt: item.dueAt ?? null,
          },
        };
      }
      case "CARE_PLAN": {
        const item = this.object(sections.carePlan?.item);
        const nextTask = this.object(item.nextTask);
        return {
          state: sections.carePlan?.state ?? "EMPTY",
          item: Object.keys(item).length === 0 ? null : {
            status: item.status ?? null,
            version: item.version ?? null,
            reviewAt: item.reviewAt ?? null,
            effectiveUntil: item.effectiveUntil ?? null,
            title: item.title ?? null,
            nextTask: Object.keys(nextTask).length === 0 ? null : {
              status: nextTask.status ?? null,
              dueAt: nextTask.dueAt ?? null,
              kind: nextTask.kind ?? null,
              label: nextTask.label ?? null,
            },
          },
        };
      }
    }
  }

  private scope(value: unknown): PatientClinicalShareScope {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!SHARE_SCOPES.includes(normalized as PatientClinicalShareScope)) {
      throw new BadRequestException(`scope must be one of: ${SHARE_SCOPES.join(", ")}.`);
    }
    return normalized as PatientClinicalShareScope;
  }

  private ttl(value: unknown) {
    const ttl = value == null ? 15 : Number(value);
    if (!Number.isInteger(ttl) || ttl < MIN_TTL_MINUTES || ttl > MAX_TTL_MINUTES) {
      throw new BadRequestException(`ttlMinutes must be an integer between ${MIN_TTL_MINUTES} and ${MAX_TTL_MINUTES}.`);
    }
    return ttl;
  }

  private token(value: unknown) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.trim())) {
      throw new NotFoundException("Temporary clinical share is unavailable.");
    }
    return value.trim();
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private sha256(value: string | Uint8Array) {
    return createHash("sha256").update(value).digest("hex");
  }

  private asEnvelope(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported temporary clinical share encryption.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    };
  }

  private array(value: unknown): Array<Record<string, any>> {
    return Array.isArray(value)
      ? value.filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
  }

  private object(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, any>
      : {};
  }

  private assertPatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Temporary clinical sharing requires PATIENT role.");
  }
}
