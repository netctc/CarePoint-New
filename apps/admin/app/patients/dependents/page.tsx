"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";

type EvidenceStatus = "PENDING_REVIEW" | "VERIFIED" | "REJECTED";
type RelationStatus = "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "REVOKED";

type Evidence = {
  id: string;
  evidenceType: string;
  referenceId: string;
  status: EvidenceStatus;
  issuedAt: string | null;
  expiresAt: string | null;
  reviewedAt: string | null;
  reasonCode: string | null;
};

type Relation = {
  id: string;
  dependentPatientId: string;
  dependent: { id: string; displayName: string } | null;
  relationshipType: string;
  status: RelationStatus;
  scopes: string[];
  validFrom: string;
  validUntil: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  effective: boolean;
  clinicalAccessEnabled: boolean;
  guardian: { id: string; email: string; role: string } | null;
  evidence: Evidence[];
};

type Queue = { items: Relation[] };

const copy = {
  en: {
    title: "Dependent relationship review",
    eyebrow: "ADM-098 · Family access governance",
    intro: "Review legal-authority evidence before a guardian can access a dependent patient's clinical context.",
    invariant: "PENDING_REVIEW or rejected relationships never grant clinical access. Approval requires current verified evidence and no rejected evidence.",
    refresh: "Refresh",
    queue: "Pending review queue",
    empty: "No dependent relationship is waiting for review.",
    guardian: "Guardian",
    dependent: "Dependent",
    relation: "Relationship",
    scopes: "Requested scopes",
    validity: "Validity",
    evidence: "Legal-authority evidence",
    reference: "Reference",
    issued: "Issued",
    expires: "Expires",
    status: "Status",
    reason: "Reason code",
    verify: "Verify evidence",
    rejectEvidence: "Reject evidence",
    approve: "Approve relationship",
    rejectRelation: "Reject relationship",
    approvalBlocked: "Approval remains blocked until at least one current evidence item is VERIFIED and none is REJECTED.",
    accessDisabled: "Clinical access disabled",
    accessEnabled: "Clinical access enabled",
    saved: "Review saved.",
    failed: "Request failed.",
    reasonRequired: "A reason code is required for rejection.",
    invalidReason: "Use an uppercase reason code with letters, numbers, underscore, colon or hyphen.",
    pending: "Pending review",
    verified: "Verified",
    rejected: "Rejected",
    revoked: "Revoked",
    noExpiry: "No expiry",
  },
  ar: {
    title: "مراجعة علاقة التابع",
    eyebrow: "ADM-098 · حوكمة وصول الأسرة",
    intro: "راجع أدلة الصلاحية القانونية قبل منح الوصي إمكانية الوصول إلى السياق السريري للتابع.",
    invariant: "العلاقات قيد المراجعة أو المرفوضة لا تمنح وصولاً سريرياً. تتطلب الموافقة دليلاً سارياً موثقاً وألا يوجد دليل مرفوض.",
    refresh: "تحديث",
    queue: "قائمة المراجعة المعلقة",
    empty: "لا توجد علاقة تابع بانتظار المراجعة.",
    guardian: "الوصي",
    dependent: "التابع",
    relation: "العلاقة",
    scopes: "نطاقات الوصول المطلوبة",
    validity: "الصلاحية",
    evidence: "دليل الصلاحية القانونية",
    reference: "المرجع",
    issued: "تاريخ الإصدار",
    expires: "تاريخ الانتهاء",
    status: "الحالة",
    reason: "رمز السبب",
    verify: "توثيق الدليل",
    rejectEvidence: "رفض الدليل",
    approve: "الموافقة على العلاقة",
    rejectRelation: "رفض العلاقة",
    approvalBlocked: "تظل الموافقة محظورة حتى يوجد دليل سارٍ واحد على الأقل بحالة VERIFIED ولا يوجد دليل REJECTED.",
    accessDisabled: "الوصول السريري معطل",
    accessEnabled: "الوصول السريري مفعل",
    saved: "تم حفظ المراجعة.",
    failed: "فشل الطلب.",
    reasonRequired: "رمز السبب مطلوب عند الرفض.",
    invalidReason: "استخدم رمز سبب بأحرف إنجليزية كبيرة وأرقام وشرطة سفلية أو نقطتين أو شرطة.",
    pending: "قيد المراجعة",
    verified: "موثق",
    rejected: "مرفوض",
    revoked: "ملغى",
    noExpiry: "بدون انتهاء",
  },
  fr: {
    title: "Revue de la relation avec une personne à charge",
    eyebrow: "ADM-098 · Gouvernance de l'accès familial",
    intro: "Vérifiez les preuves d'autorité légale avant qu'un représentant puisse accéder au contexte clinique d'une personne à charge.",
    invariant: "Une relation en attente ou rejetée n'accorde jamais d'accès clinique. L'approbation exige au moins une preuve valide vérifiée et aucune preuve rejetée.",
    refresh: "Actualiser",
    queue: "File des revues en attente",
    empty: "Aucune relation n'attend de revue.",
    guardian: "Représentant",
    dependent: "Personne à charge",
    relation: "Relation",
    scopes: "Périmètres demandés",
    validity: "Validité",
    evidence: "Preuve d'autorité légale",
    reference: "Référence",
    issued: "Émise",
    expires: "Expire",
    status: "État",
    reason: "Code motif",
    verify: "Vérifier la preuve",
    rejectEvidence: "Rejeter la preuve",
    approve: "Approuver la relation",
    rejectRelation: "Rejeter la relation",
    approvalBlocked: "L'approbation reste bloquée jusqu'à ce qu'au moins une preuve valide soit VERIFIED et qu'aucune ne soit REJECTED.",
    accessDisabled: "Accès clinique désactivé",
    accessEnabled: "Accès clinique activé",
    saved: "Revue enregistrée.",
    failed: "Échec de la requête.",
    reasonRequired: "Un code motif est requis pour un rejet.",
    invalidReason: "Utilisez un code motif en majuscules avec lettres, chiffres, souligné, deux-points ou tiret.",
    pending: "En attente",
    verified: "Vérifiée",
    rejected: "Rejetée",
    revoked: "Révoquée",
    noExpiry: "Sans expiration",
  },
  es: {
    title: "Revisión de relación de dependientes",
    eyebrow: "ADM-098 · Gobernanza de acceso familiar",
    intro: "Revisa la evidencia de autoridad legal antes de que un tutor pueda acceder al contexto clínico de un dependiente.",
    invariant: "Las relaciones pendientes o rechazadas nunca conceden acceso clínico. Aprobar requiere al menos una evidencia vigente verificada y ninguna evidencia rechazada.",
    refresh: "Actualizar",
    queue: "Cola pendiente de revisión",
    empty: "No hay relaciones de dependientes pendientes de revisión.",
    guardian: "Tutor/representante",
    dependent: "Dependiente",
    relation: "Relación",
    scopes: "Scopes solicitados",
    validity: "Vigencia",
    evidence: "Evidencia de autoridad legal",
    reference: "Referencia",
    issued: "Emisión",
    expires: "Vencimiento",
    status: "Estado",
    reason: "Código de motivo",
    verify: "Verificar evidencia",
    rejectEvidence: "Rechazar evidencia",
    approve: "Aprobar relación",
    rejectRelation: "Rechazar relación",
    approvalBlocked: "La aprobación queda bloqueada hasta que exista al menos una evidencia vigente VERIFIED y ninguna REJECTED.",
    accessDisabled: "Acceso clínico desactivado",
    accessEnabled: "Acceso clínico activado",
    saved: "Revisión guardada.",
    failed: "La solicitud falló.",
    reasonRequired: "Se requiere un código de motivo para rechazar.",
    invalidReason: "Usa un código en mayúsculas con letras, números, guion bajo, dos puntos o guion.",
    pending: "Pendiente",
    verified: "Verificada",
    rejected: "Rechazada",
    revoked: "Revocada",
    noExpiry: "Sin vencimiento",
  },
} as const satisfies Record<Locale, Record<string, string>>;

const SAFE_REASON = /^[A-Z][A-Z0-9_:-]{1,63}$/;

async function adminApi(path: string, method = "GET", body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
    cache: "no-store",
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch("/api/admin/dependents/" + path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.message === "string" ? payload.message : "Request failed.");
  }
  return payload;
}

export default function DependentReviewPage() {
  const { locale } = useI18n();
  const c = copy[locale];
  const [data, setData] = useState<Queue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [relationReasons, setRelationReasons] = useState<Record<string, string>>({});
  const [evidenceReasons, setEvidenceReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const next = await adminApi("review") as Queue;
      setData(next);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c.failed);
    }
  }, [c.failed]);

  useEffect(() => { void load(); }, [load]);

  const queueCount = data?.items?.length ?? 0;
  const formatDate = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    return (value: string | null | undefined) => {
      if (!value) return c.noExpiry;
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? formatter.format(parsed) : "—";
    };
  }, [locale, c.noExpiry]);

  function statusLabel(status: string) {
    if (status === "VERIFIED") return c.verified;
    if (status === "REJECTED") return c.rejected;
    if (status === "REVOKED") return c.revoked;
    return c.pending;
  }

  function normalizedReason(raw: string) {
    const value = raw.trim().toUpperCase();
    return SAFE_REASON.test(value) ? value : null;
  }

  async function reviewEvidence(relation: Relation, evidence: Evidence, status: "VERIFIED" | "REJECTED") {
    const key = relation.id + ":" + evidence.id;
    const reasonRaw = evidenceReasons[key] ?? "";
    const reasonCode = reasonRaw ? normalizedReason(reasonRaw) : null;
    if (status === "REJECTED" && !reasonRaw.trim()) {
      setMessage(c.reasonRequired);
      return;
    }
    if (reasonRaw.trim() && !reasonCode) {
      setMessage(c.invalidReason);
      return;
    }
    setBusy("evidence:" + key);
    try {
      await adminApi(
        relation.id + "/evidence/" + evidence.id + "/review",
        "POST",
        { status, ...(reasonCode ? { reasonCode } : {}) },
      );
      setEvidenceReasons((current) => ({ ...current, [key]: "" }));
      setMessage(c.saved);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c.failed);
    } finally {
      setBusy(null);
    }
  }

  async function reviewRelation(relation: Relation, decision: "APPROVE" | "REJECT") {
    const reasonRaw = relationReasons[relation.id] ?? "";
    const reasonCode = reasonRaw ? normalizedReason(reasonRaw) : null;
    if (decision === "REJECT" && !reasonRaw.trim()) {
      setMessage(c.reasonRequired);
      return;
    }
    if (reasonRaw.trim() && !reasonCode) {
      setMessage(c.invalidReason);
      return;
    }
    setBusy("relation:" + relation.id);
    try {
      await adminApi(
        relation.id + "/review",
        "POST",
        { decision, ...(reasonCode ? { reasonCode } : {}) },
      );
      setRelationReasons((current) => ({ ...current, [relation.id]: "" }));
      setMessage(c.saved);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c.failed);
    } finally {
      setBusy(null);
    }
  }

  const box = {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 16,
  } as const;

  return <AppShell active="18" eyebrow={c.eyebrow} title={c.title}>
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...box, background: "#f8fafc" }}>
        <strong>{c.intro}</strong>
        <div style={{ color: "#475569", marginTop: 7 }}>{c.invariant}</div>
      </div>

      <div style={{ ...box, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div><strong>{c.queue}</strong> · {queueCount}</div>
        <button className="secondary-button" disabled={busy !== null} onClick={() => void load()}>{c.refresh}</button>
      </div>

      {message ? <div style={box}>{message}</div> : null}
      {queueCount === 0 ? <div style={box}>{c.empty}</div> : null}

      {(data?.items ?? []).map((relation) => {
        const validEvidence = relation.evidence.filter((item) =>
          item.status === "VERIFIED" &&
          (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()),
        );
        const hasRejected = relation.evidence.some((item) => item.status === "REJECTED");
        const canApprove = validEvidence.length > 0 && !hasRejected;
        const relationBusy = busy === "relation:" + relation.id;

        return <section key={relation.id} style={box} data-relation-id={relation.id}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <div>
              <small style={{ color: "#64748b" }}>{c.guardian}</small>
              <div style={{ fontWeight: 800 }}>{relation.guardian?.email ?? "—"}</div>
              <small>{relation.guardian?.id ?? "—"}</small>
            </div>
            <div>
              <small style={{ color: "#64748b" }}>{c.dependent}</small>
              <div style={{ fontWeight: 800 }}>{relation.dependent?.displayName ?? relation.dependentPatientId}</div>
              <small>{relation.dependentPatientId}</small>
            </div>
            <div>
              <small style={{ color: "#64748b" }}>{c.relation}</small>
              <div style={{ fontWeight: 800 }}>{relation.relationshipType}</div>
              <small>{statusLabel(relation.status)}</small>
            </div>
            <div>
              <small style={{ color: "#64748b" }}>{c.validity}</small>
              <div>{formatDate(relation.validFrom)} → {formatDate(relation.validUntil)}</div>
              <strong style={{ color: relation.clinicalAccessEnabled ? "#166534" : "#991b1b" }}>
                {relation.clinicalAccessEnabled ? c.accessEnabled : c.accessDisabled}
              </strong>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <small style={{ color: "#64748b" }}>{c.scopes}</small>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {relation.scopes.map((scope) => <code key={scope} style={{ background: "#f1f5f9", padding: "4px 7px", borderRadius: 7 }}>{scope}</code>)}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <strong>{c.evidence}</strong>
            <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
              {relation.evidence.map((evidence) => {
                const key = relation.id + ":" + evidence.id;
                const evidenceBusy = busy === "evidence:" + key;
                return <div key={evidence.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
                    <div><small>{c.evidence}</small><div><strong>{evidence.evidenceType}</strong></div></div>
                    <div><small>{c.reference}</small><div>{evidence.referenceId}</div></div>
                    <div><small>{c.status}</small><div>{statusLabel(evidence.status)}</div></div>
                    <div><small>{c.issued}</small><div>{formatDate(evidence.issuedAt)}</div></div>
                    <div><small>{c.expires}</small><div>{formatDate(evidence.expiresAt)}</div></div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 10 }}>
                    <label style={{ display: "grid", gap: 4, minWidth: 240, flex: "1 1 260px" }}>
                      {c.reason}
                      <input
                        value={evidenceReasons[key] ?? ""}
                        onChange={(event) => setEvidenceReasons((current) => ({ ...current, [key]: event.target.value.toUpperCase() }))}
                        placeholder="DOCUMENT_VERIFIED / INVALID_EVIDENCE"
                        maxLength={64}
                        style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8 }}
                      />
                    </label>
                    <button className="secondary-button" disabled={busy !== null} onClick={() => void reviewEvidence(relation, evidence, "VERIFIED")}>{c.verify}</button>
                    <button className="secondary-button" disabled={busy !== null} onClick={() => void reviewEvidence(relation, evidence, "REJECTED")}>{c.rejectEvidence}</button>
                    {evidenceBusy ? <span>…</span> : null}
                  </div>
                </div>;
              })}
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
            {!canApprove ? <div style={{ color: "#92400e", marginBottom: 8 }}>{c.approvalBlocked}</div> : null}
            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 4, minWidth: 260, flex: "1 1 300px" }}>
                {c.reason}
                <input
                  value={relationReasons[relation.id] ?? ""}
                  onChange={(event) => setRelationReasons((current) => ({ ...current, [relation.id]: event.target.value.toUpperCase() }))}
                  placeholder="AUTHORITY_VERIFIED / INSUFFICIENT_AUTHORITY"
                  maxLength={64}
                  style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8 }}
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy !== null || !canApprove}
                onClick={() => void reviewRelation(relation, "APPROVE")}
              >{c.approve}</button>
              <button
                className="secondary-button"
                disabled={busy !== null}
                onClick={() => void reviewRelation(relation, "REJECT")}
              >{c.rejectRelation}</button>
              {relationBusy ? <span>…</span> : null}
            </div>
          </div>
        </section>;
      })}
    </div>
  </AppShell>;
}
