"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./ProviderGovernanceQueue.module.css";

type ProviderKind = "DOCTOR" | "OTHER_PROVIDER";
type OnboardingState = "DRAFT" | "PENDING_REVIEW" | "REQUEST_CHANGES" | "APPROVED" | "REJECTED";
type CredentialState = "PENDING" | "VERIFIED" | "REJECTED";

type Credential = {
  id: string;
  type: string;
  number?: string | null;
  issuer?: string | null;
  validUntil?: string | null;
  documentId?: string | null;
  state: CredentialState;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
};

type Onboarding = {
  id: string;
  userId: string;
  kind: ProviderKind;
  state: OnboardingState;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  updatedAt: string;
  user: { id: string; email: string; role: string; status: string };
  specialty?: { labels?: unknown } | null;
  providerCategory?: { labels?: unknown; family?: string } | null;
  provider?: { id: string; displayName: string; legalName?: string | null; status: string } | null;
  credentials: Credential[];
};

type GovernanceAction = "credential-verify" | "credential-reject" | "request-changes" | "reject" | "approve";

type Copy = {
  reviewQueue: string;
  reviewQueueText: string;
  pending: string;
  changes: string;
  approved: string;
  credentialsPending: string;
  search: string;
  allStates: string;
  noCases: string;
  submitted: string;
  updated: string;
  account: string;
  providerState: string;
  credential: string;
  credentialNumber: string;
  issuer: string;
  expires: string;
  reviewState: string;
  actions: string;
  verify: string;
  rejectCredential: string;
  note: string;
  notePlaceholder: string;
  requestChanges: string;
  rejectApplication: string;
  approve: string;
  openDetails: string;
  closeDetails: string;
  decisionLogged: string;
  loading: string;
  refresh: string;
  retry: string;
  actionFailed: string;
  noteRequired: string;
  approveHint: string;
  rejectedHistory: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    reviewQueue: "Credential review queue", reviewQueueText: "Review submitted provider applications, verify evidence and make auditable activation decisions.", pending: "Pending review", changes: "Changes requested", approved: "Approved", credentialsPending: "Credentials pending", search: "Search by email, category, specialty or credential…", allStates: "All states", noCases: "No onboarding cases match the current filters.", submitted: "Submitted", updated: "Updated", account: "Account", providerState: "Provider state", credential: "Credential", credentialNumber: "Number", issuer: "Issuer", expires: "Expires", reviewState: "Review state", actions: "Actions", verify: "Verify", rejectCredential: "Reject credential", note: "Review note", notePlaceholder: "Reason, remediation request or decision context…", requestChanges: "Request changes", rejectApplication: "Reject application", approve: "Approve provider", openDetails: "Open review", closeDetails: "Close review", decisionLogged: "Governance actions are recorded in the CarePoint audit trail.", loading: "Loading governance queue…", refresh: "Refresh", retry: "Retry", actionFailed: "The governance action could not be completed.", noteRequired: "Enter a review note before this decision.", approveHint: "Approval is allowed only after every pending credential is reviewed and all required credential types have verified evidence.", rejectedHistory: "Rejected credentials remain in the immutable review history and do not erase later corrected evidence."
  },
  ar: {
    reviewQueue: "قائمة مراجعة الاعتمادات", reviewQueueText: "راجع طلبات مقدمي الخدمة وتحقق من الأدلة واتخذ قرارات تفعيل قابلة للتدقيق.", pending: "قيد المراجعة", changes: "مطلوب تعديل", approved: "مقبول", credentialsPending: "اعتمادات معلقة", search: "بحث بالبريد أو الفئة أو التخصص أو الاعتماد…", allStates: "كل الحالات", noCases: "لا توجد طلبات مطابقة لعوامل التصفية الحالية.", submitted: "تم الإرسال", updated: "آخر تحديث", account: "الحساب", providerState: "حالة مقدم الخدمة", credential: "الاعتماد", credentialNumber: "الرقم", issuer: "الجهة المصدرة", expires: "الانتهاء", reviewState: "حالة المراجعة", actions: "الإجراءات", verify: "تحقق", rejectCredential: "رفض الاعتماد", note: "ملاحظة المراجعة", notePlaceholder: "سبب القرار أو التعديل المطلوب…", requestChanges: "طلب تعديلات", rejectApplication: "رفض الطلب", approve: "اعتماد مقدم الخدمة", openDetails: "فتح المراجعة", closeDetails: "إغلاق المراجعة", decisionLogged: "تسجل إجراءات الحوكمة في سجل تدقيق CarePoint.", loading: "جارٍ تحميل قائمة الحوكمة…", refresh: "تحديث", retry: "إعادة المحاولة", actionFailed: "تعذر إكمال إجراء الحوكمة.", noteRequired: "أدخل ملاحظة مراجعة قبل هذا القرار.", approveHint: "لا يمكن الاعتماد إلا بعد مراجعة كل الاعتمادات المعلقة والتحقق من جميع أنواع الاعتماد المطلوبة.", rejectedHistory: "تبقى الاعتمادات المرفوضة ضمن سجل المراجعة ولا تمحو الأدلة المصححة اللاحقة."
  },
  fr: {
    reviewQueue: "File de contrôle des habilitations", reviewQueueText: "Examinez les dossiers soumis, vérifiez les justificatifs et prenez des décisions d’activation auditables.", pending: "En révision", changes: "Modifications demandées", approved: "Approuvé", credentialsPending: "Justificatifs en attente", search: "Rechercher par e-mail, catégorie, spécialité ou justificatif…", allStates: "Tous les statuts", noCases: "Aucun dossier ne correspond aux filtres actuels.", submitted: "Soumis", updated: "Mis à jour", account: "Compte", providerState: "Statut prestataire", credential: "Justificatif", credentialNumber: "Numéro", issuer: "Émetteur", expires: "Expiration", reviewState: "État de revue", actions: "Actions", verify: "Vérifier", rejectCredential: "Rejeter le justificatif", note: "Note de revue", notePlaceholder: "Motif, correction demandée ou contexte de décision…", requestChanges: "Demander des modifications", rejectApplication: "Rejeter le dossier", approve: "Approuver le prestataire", openDetails: "Ouvrir la revue", closeDetails: "Fermer la revue", decisionLogged: "Les actions de gouvernance sont enregistrées dans la piste d’audit CarePoint.", loading: "Chargement de la file de gouvernance…", refresh: "Actualiser", retry: "Réessayer", actionFailed: "L’action de gouvernance n’a pas pu être exécutée.", noteRequired: "Ajoutez une note de revue avant cette décision.", approveHint: "L’approbation exige que chaque justificatif en attente soit revu et que tous les types requis disposent d’une preuve vérifiée.", rejectedHistory: "Les justificatifs rejetés restent dans l’historique de revue et n’effacent pas les preuves corrigées ultérieures."
  },
  es: {
    reviewQueue: "Cola de revisión de credenciales", reviewQueueText: "Revisa solicitudes de proveedores, valida evidencias y toma decisiones de activación totalmente auditables.", pending: "Pendiente de revisión", changes: "Cambios solicitados", approved: "Aprobado", credentialsPending: "Credenciales pendientes", search: "Buscar por email, categoría, especialidad o credencial…", allStates: "Todos los estados", noCases: "No hay expedientes que coincidan con los filtros actuales.", submitted: "Enviado", updated: "Actualizado", account: "Cuenta", providerState: "Estado del proveedor", credential: "Credencial", credentialNumber: "Número", issuer: "Emisor", expires: "Caduca", reviewState: "Estado de revisión", actions: "Acciones", verify: "Verificar", rejectCredential: "Rechazar credencial", note: "Nota de revisión", notePlaceholder: "Motivo, corrección solicitada o contexto de la decisión…", requestChanges: "Solicitar cambios", rejectApplication: "Rechazar solicitud", approve: "Aprobar proveedor", openDetails: "Abrir revisión", closeDetails: "Cerrar revisión", decisionLogged: "Las acciones de gobernanza quedan registradas en la auditoría de CarePoint.", loading: "Cargando cola de gobernanza…", refresh: "Actualizar", retry: "Reintentar", actionFailed: "No se pudo completar la acción de gobernanza.", noteRequired: "Introduce una nota de revisión antes de esta decisión.", approveHint: "La aprobación sólo se permite cuando todas las credenciales pendientes han sido revisadas y cada tipo obligatorio dispone de evidencia verificada.", rejectedHistory: "Las credenciales rechazadas permanecen en el historial de revisión y no eliminan evidencias corregidas posteriores."
  }
};

export function ProviderGovernanceQueue({ kind }: { kind: ProviderKind }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [rows, setRows] = useState<Onboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<OnboardingState | "ALL">("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [working, setWorking] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/governance/onboarding", { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload)) throw new Error(messageOf(payload, copy.actionFailed));
      setRows((payload as Onboarding[]).filter((item) => item.kind === kind));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [kind]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (state !== "ALL" && row.state !== state) return false;
      if (!needle) return true;
      const haystack = [
        row.user.email,
        row.provider?.displayName,
        row.provider?.legalName,
        localLabel(row.specialty?.labels, locale),
        localLabel(row.providerCategory?.labels, locale),
        row.providerCategory?.family,
        ...row.credentials.flatMap((credential) => [credential.type, credential.number, credential.issuer]),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, query, state, locale]);

  const metrics = useMemo(() => ({
    pending: rows.filter((row) => row.state === "PENDING_REVIEW").length,
    changes: rows.filter((row) => row.state === "REQUEST_CHANGES").length,
    approved: rows.filter((row) => row.state === "APPROVED").length,
    credentialsPending: rows.reduce((count, row) => count + row.credentials.filter((credential) => credential.state === "PENDING").length, 0),
  }), [rows]);

  async function act(row: Onboarding, action: GovernanceAction, credentialId?: string) {
    const note = (notes[row.id] || "").trim();
    if (["credential-reject", "request-changes", "reject"].includes(action) && !note) {
      setError(copy.noteRequired);
      setExpanded(row.id);
      return;
    }
    const key = `${row.id}:${credentialId || action}`;
    setWorking(key);
    setError("");
    try {
      const response = await fetch("/api/admin/governance/onboarding/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, onboardingId: row.id, ...(credentialId ? { credentialId } : {}), ...(note ? { note } : {}) }),
      });
      if (response.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageOf(payload, copy.actionFailed));
      setNotes((current) => ({ ...current, [row.id]: "" }));
      await load();
      setExpanded(row.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionFailed);
      setExpanded(row.id);
    } finally {
      setWorking("");
    }
  }

  if (loading) return <section className={styles.panel}><div className={styles.loading}>{copy.loading}</div></section>;

  return <section className={styles.panel}>
    <div className={styles.heading}>
      <div><span>PHASE B2 · GOVERNANCE</span><h2>{copy.reviewQueue}</h2><p>{copy.reviewQueueText}</p></div>
      <button className={styles.refresh} onClick={() => void load()}>{copy.refresh}</button>
    </div>

    <div className={styles.metrics}>
      <Metric label={copy.pending} value={metrics.pending} />
      <Metric label={copy.changes} value={metrics.changes} />
      <Metric label={copy.approved} value={metrics.approved} />
      <Metric label={copy.credentialsPending} value={metrics.credentialsPending} />
    </div>

    <div className={styles.filters}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} />
      <select value={state} onChange={(event) => setState(event.target.value as OnboardingState | "ALL")}>
        <option value="ALL">{copy.allStates}</option>
        <option value="PENDING_REVIEW">{stateLabel("PENDING_REVIEW", copy)}</option>
        <option value="REQUEST_CHANGES">{stateLabel("REQUEST_CHANGES", copy)}</option>
        <option value="APPROVED">{stateLabel("APPROVED", copy)}</option>
        <option value="REJECTED">{stateLabel("REJECTED", copy)}</option>
        <option value="DRAFT">DRAFT</option>
      </select>
    </div>

    {error && <div className={styles.error} role="alert">{error} <button onClick={() => setError("")}>×</button></div>}

    <div className={styles.queue}>
      {filtered.length === 0 && <div className={styles.empty}>{copy.noCases}</div>}
      {filtered.map((row) => {
        const isOpen = expanded === row.id;
        const pendingCredentials = row.credentials.filter((credential) => credential.state === "PENDING").length;
        return <article className={styles.case} key={row.id}>
          <div className={styles.caseHeader}>
            <div>
              <div className={styles.identity}><strong>{row.provider?.displayName || row.user.email}</strong><StateBadge state={row.state} copy={copy} /></div>
              <p>{localLabel(row.specialty?.labels, locale) || localLabel(row.providerCategory?.labels, locale) || row.providerCategory?.family || row.kind}</p>
              <small>{copy.account}: {row.user.email} · {copy.providerState}: {row.provider?.status || "DRAFT"}</small>
            </div>
            <div className={styles.caseMeta}>
              <span>{copy.submitted}: {formatDate(row.submittedAt, locale)}</span>
              <span>{copy.updated}: {formatDate(row.updatedAt, locale)}</span>
              <b>{pendingCredentials} {copy.credentialsPending.toLowerCase()}</b>
              <button onClick={() => setExpanded(isOpen ? null : row.id)}>{isOpen ? copy.closeDetails : copy.openDetails}</button>
            </div>
          </div>

          {isOpen && <div className={styles.details}>
            {row.reviewNote && <div className={styles.reviewNote}><b>{copy.note}:</b> {row.reviewNote}</div>}
            <div className={styles.credentials}>
              <div className={`${styles.credentialRow} ${styles.credentialHead}`}>
                <span>{copy.credential}</span><span>{copy.credentialNumber}</span><span>{copy.issuer}</span><span>{copy.expires}</span><span>{copy.reviewState}</span><span>{copy.actions}</span>
              </div>
              {row.credentials.map((credential) => {
                const key = `${row.id}:${credential.id}`;
                return <div className={styles.credentialRow} key={credential.id}>
                  <span><b>{credential.type}</b>{credential.documentId && <small>Doc: {credential.documentId}</small>}</span>
                  <span>{credential.number || "—"}</span>
                  <span>{credential.issuer || "—"}</span>
                  <span>{formatDate(credential.validUntil, locale)}</span>
                  <span><CredentialBadge state={credential.state} />{credential.reviewNote && <small>{credential.reviewNote}</small>}</span>
                  <span className={styles.credentialActions}>
                    {row.state === "PENDING_REVIEW" && credential.state === "PENDING" ? <>
                      <button disabled={Boolean(working)} onClick={() => void act(row, "credential-verify", credential.id)}>{working === key ? "…" : copy.verify}</button>
                      <button className={styles.dangerLink} disabled={Boolean(working)} onClick={() => void act(row, "credential-reject", credential.id)}>{copy.rejectCredential}</button>
                    </> : <span>—</span>}
                  </span>
                </div>;
              })}
            </div>

            <p className={styles.historyHint}>{copy.rejectedHistory}</p>
            <label className={styles.noteBox}><span>{copy.note}</span><textarea value={notes[row.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder={copy.notePlaceholder} /></label>
            <div className={styles.decisionBar}>
              <span>{copy.decisionLogged}</span>
              <div>
                {row.state === "PENDING_REVIEW" && <button disabled={Boolean(working)} onClick={() => void act(row, "request-changes")}>{copy.requestChanges}</button>}
                {(row.state === "PENDING_REVIEW" || row.state === "REQUEST_CHANGES") && <button className={styles.danger} disabled={Boolean(working)} onClick={() => void act(row, "reject")}>{copy.rejectApplication}</button>}
                {row.state === "PENDING_REVIEW" && <button className={styles.approve} disabled={Boolean(working) || pendingCredentials > 0} title={copy.approveHint} onClick={() => void act(row, "approve")}>{copy.approve}</button>}
              </div>
            </div>
            <p className={styles.approveHint}>{copy.approveHint}</p>
          </div>}
        </article>;
      })}
    </div>
  </section>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function StateBadge({ state, copy }: { state: OnboardingState; copy: Copy }) {
  return <em className={`${styles.badge} ${styles[`state${state}`] || ""}`}>{stateLabel(state, copy)}</em>;
}

function CredentialBadge({ state }: { state: CredentialState }) {
  return <em className={`${styles.badge} ${styles[`credential${state}`] || ""}`}>{state.replaceAll("_", " ")}</em>;
}

function stateLabel(state: OnboardingState, copy: Copy): string {
  if (state === "PENDING_REVIEW") return copy.pending;
  if (state === "REQUEST_CHANGES") return copy.changes;
  if (state === "APPROVED") return copy.approved;
  if (state === "REJECTED") return "REJECTED";
  return "DRAFT";
}

function localLabel(labels: unknown, locale: Locale): string {
  if (typeof labels === "string") return labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return "";
  const row = labels as Record<string, unknown>;
  for (const key of [locale, "en", "ar", "fr", "es", "label", "name"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function formatDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const tag = locale === "ar" ? "ar-LB" : locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : "en-GB";
  return new Intl.DateTimeFormat(tag, { year: "numeric", month: "short", day: "2-digit" }).format(date);
}

function messageOf(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const message = (payload as Record<string, unknown>).message;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) return message.filter((item) => typeof item === "string").join(" ") || fallback;
  return fallback;
}
