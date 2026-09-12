"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./TelehealthOperations.module.css";

type Severity = "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";
type TelehealthItem = {
  appointmentId: string;
  sessionId: string | null;
  appointmentStatus: string;
  sessionStatus: string | null;
  startsAt: string;
  endsAt: string;
  provider: { id: string; class: string; displayName: string };
  service: { id: string; name: string };
  consentGranted: boolean;
  patientReady: boolean;
  providerReady: boolean;
  startedAt: string | null;
  endedAt: string | null;
  recordingEnabled: boolean;
  severity: Severity;
  attentionReasons: string[];
  actions: { canResetReadiness: boolean; canTerminateSession: boolean };
};
type Workspace = {
  generatedAt: string;
  window: { from: string; to: string };
  privacy: Record<string, boolean>;
  policy: Record<string, boolean>;
  summary: { appointmentsInWindow: number; waiting: number; ready: number; active: number; attentionNeeded: number };
  queue: TelehealthItem[];
};
type Reason = "TECHNICAL_FAILURE" | "SECURITY" | "PROVIDER_REQUEST" | "OPERATIONS";

type Copy = {
  eyebrow: string; title: string; intro: string; privacy: string; refresh: string; updated: string; loading: string; failed: string;
  total: string; waiting: string; ready: string; active: string; attention: string; queue: string; queueText: string; noItems: string;
  provider: string; service: string; schedule: string; consent: string; patientReady: string; providerReady: string; yes: string; no: string;
  reset: string; terminate: string; reason: string; confirmReset: string; confirmTerminate: string; currentState: string; signals: string;
  technical: string; security: string; providerRequest: string; operations: string; noSignals: string; sessionMissing: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    eyebrow: "TELEHEALTH OPERATIONS", title: "Virtual care delivery control", intro: "Monitor readiness and session health without entering visits, exposing patient identity, room credentials or E2EE material.", privacy: "PHI-neutral · no join credentials · no room or encryption material", refresh: "Refresh", updated: "Updated", loading: "Loading telehealth operations…", failed: "Telehealth operations could not be loaded.",
    total: "Appointments · window", waiting: "Waiting", ready: "Ready", active: "Active", attention: "Needs attention", queue: "Care delivery queue", queueText: "Priority is derived from schedule proximity, consent/readiness state, lifecycle mismatches and overdue active sessions.", noItems: "No telemedicine appointments in the operational window.",
    provider: "Provider", service: "Service", schedule: "Schedule", consent: "Consent", patientReady: "Patient ready", providerReady: "Provider ready", yes: "Yes", no: "No", reset: "Reset readiness", terminate: "Terminate active session", reason: "Termination reason", confirmReset: "Reset both readiness checks while preserving patient consent?", confirmTerminate: "Terminate this active telehealth session? The appointment status will remain unchanged.", currentState: "State", signals: "Attention signals", technical: "Technical failure", security: "Security", providerRequest: "Provider request", operations: "Operations", noSignals: "No attention signals", sessionMissing: "Session not initialized"
  },
  ar: {
    eyebrow: "عمليات الرعاية عن بُعد", title: "التحكم في تقديم الرعاية الافتراضية", intro: "راقب الجاهزية وصحة الجلسة دون الدخول إلى الزيارة أو كشف هوية المريض أو بيانات الغرفة أو مفاتيح E2EE.", privacy: "دون PHI · دون بيانات دخول · دون مفاتيح الغرفة أو التشفير", refresh: "تحديث", updated: "آخر تحديث", loading: "جارٍ تحميل عمليات الرعاية عن بُعد…", failed: "تعذر تحميل عمليات الرعاية عن بُعد.",
    total: "المواعيد · النافذة", waiting: "انتظار", ready: "جاهز", active: "نشط", attention: "يحتاج انتباهاً", queue: "قائمة تقديم الرعاية", queueText: "تُحدد الأولوية حسب قرب الموعد وحالة الموافقة والجاهزية وتعارض دورة الحياة والجلسات النشطة المتأخرة.", noItems: "لا توجد مواعيد طب عن بُعد في النافذة التشغيلية.",
    provider: "المقدم", service: "الخدمة", schedule: "الموعد", consent: "الموافقة", patientReady: "جاهزية المريض", providerReady: "جاهزية المقدم", yes: "نعم", no: "لا", reset: "إعادة ضبط الجاهزية", terminate: "إنهاء الجلسة النشطة", reason: "سبب الإنهاء", confirmReset: "إعادة ضبط جاهزية الطرفين مع الاحتفاظ بموافقة المريض؟", confirmTerminate: "إنهاء جلسة الرعاية عن بُعد النشطة؟ ستبقى حالة الموعد دون تغيير.", currentState: "الحالة", signals: "إشارات الانتباه", technical: "عطل تقني", security: "أمان", providerRequest: "طلب المقدم", operations: "عمليات", noSignals: "لا توجد إشارات انتباه", sessionMissing: "لم تتم تهيئة الجلسة"
  },
  fr: {
    eyebrow: "OPÉRATIONS TÉLÉSANTÉ", title: "Pilotage de la prestation de soins virtuels", intro: "Surveillez la préparation et la santé des sessions sans rejoindre les visites ni exposer l’identité patient, les accès de salle ou les éléments E2EE.", privacy: "Sans PHI · sans accès de connexion · sans données de salle ou de chiffrement", refresh: "Actualiser", updated: "Mis à jour", loading: "Chargement des opérations télésanté…", failed: "Impossible de charger les opérations télésanté.",
    total: "Rendez-vous · fenêtre", waiting: "En attente", ready: "Prêt", active: "Actif", attention: "À surveiller", queue: "File de prestation de soins", queueText: "La priorité combine proximité horaire, consentement/préparation, incohérences de cycle de vie et sessions actives en retard.", noItems: "Aucun rendez-vous de télémédecine dans la fenêtre opérationnelle.",
    provider: "Prestataire", service: "Service", schedule: "Horaire", consent: "Consentement", patientReady: "Patient prêt", providerReady: "Prestataire prêt", yes: "Oui", no: "Non", reset: "Réinitialiser la préparation", terminate: "Terminer la session active", reason: "Motif de terminaison", confirmReset: "Réinitialiser les deux contrôles de préparation tout en conservant le consentement ?", confirmTerminate: "Terminer cette session active ? Le statut du rendez-vous restera inchangé.", currentState: "État", signals: "Signaux d’attention", technical: "Incident technique", security: "Sécurité", providerRequest: "Demande du prestataire", operations: "Opérations", noSignals: "Aucun signal d’attention", sessionMissing: "Session non initialisée"
  },
  es: {
    eyebrow: "OPERACIONES DE TELEMEDICINA", title: "Control de prestación de atención virtual", intro: "Supervisa readiness y salud de las sesiones sin entrar en consultas ni exponer identidad del paciente, credenciales de sala o material E2EE.", privacy: "PHI-neutral · sin credenciales de acceso · sin sala ni material de cifrado", refresh: "Actualizar", updated: "Actualizado", loading: "Cargando operaciones de telemedicina…", failed: "No se pudo cargar el workspace de telemedicina.",
    total: "Citas · ventana", waiting: "En espera", ready: "Preparadas", active: "Activas", attention: "Requieren atención", queue: "Cola de prestación asistencial", queueText: "La prioridad deriva de proximidad del horario, consentimiento/readiness, inconsistencias de lifecycle y sesiones activas fuera de ventana.", noItems: "No hay citas de telemedicina en la ventana operativa.",
    provider: "Proveedor", service: "Servicio", schedule: "Horario", consent: "Consentimiento", patientReady: "Paciente preparado", providerReady: "Proveedor preparado", yes: "Sí", no: "No", reset: "Resetear readiness", terminate: "Terminar sesión activa", reason: "Motivo de terminación", confirmReset: "¿Resetear ambos controles de readiness conservando el consentimiento del paciente?", confirmTerminate: "¿Terminar esta sesión activa? El estado de la cita permanecerá sin cambios.", currentState: "Estado", signals: "Señales de atención", technical: "Fallo técnico", security: "Seguridad", providerRequest: "Solicitud del proveedor", operations: "Operaciones", noSignals: "Sin señales de atención", sessionMissing: "Sesión no inicializada"
  },
};

const reasonLabels = (c: Copy): Record<Reason, string> => ({ TECHNICAL_FAILURE: c.technical, SECURITY: c.security, PROVIDER_REQUEST: c.providerRequest, OPERATIONS: c.operations });

export function TelehealthOperations() {
  const { locale } = useI18n();
  const c = copy[locale];
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, Reason>>({});
  const labels = useMemo(() => reasonLabels(c), [c]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/telehealth/workspace", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`);
      setWorkspace(payload as Workspace);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c.failed);
    } finally {
      setLoading(false);
    }
  }, [c.failed]);

  useEffect(() => { void load(); }, [load]);

  async function act(item: TelehealthItem, action: "RESET_READINESS" | "TERMINATE_SESSION") {
    if (!item.sessionId) return;
    const confirmText = action === "RESET_READINESS" ? c.confirmReset : c.confirmTerminate;
    if (!window.confirm(confirmText)) return;
    const reasonCode = reasons[item.sessionId] ?? "OPERATIONS";
    setBusy(`${action}:${item.sessionId}`);
    setError(null);
    try {
      const response = await fetch("/api/admin/telehealth/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, sessionId: item.sessionId, ...(action === "TERMINATE_SESSION" ? { reasonCode } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c.failed);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !workspace) return <section className={styles.loading}>{c.loading}</section>;
  if (!workspace) return <section className={styles.error}>{error ?? c.failed}</section>;

  const metrics = [
    [c.total, workspace.summary.appointmentsInWindow], [c.waiting, workspace.summary.waiting], [c.ready, workspace.summary.ready], [c.active, workspace.summary.active], [c.attention, workspace.summary.attentionNeeded],
  ] as const;

  return <div className={styles.workspace}>
    <section className={styles.hero}>
      <div><span>{c.eyebrow}</span><h2>{c.title}</h2><p>{c.intro}</p><small>{c.privacy}</small></div>
      <div className={styles.refreshBox}><button onClick={() => void load()} disabled={loading}>{c.refresh}</button><small>{c.updated}<br />{formatDate(workspace.generatedAt, locale)}</small></div>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}

    <section className={styles.metrics}>{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>

    <section className={styles.panel}>
      <header><div><h3>{c.queue}</h3><p>{c.queueText}</p></div><small>{formatDate(workspace.window.from, locale)} → {formatDate(workspace.window.to, locale)}</small></header>
      {workspace.queue.length === 0 ? <div className={styles.empty}>{c.noItems}</div> : <div className={styles.list}>
        {workspace.queue.map((item) => {
          const key = item.sessionId ?? item.appointmentId;
          const terminationReason = item.sessionId ? (reasons[item.sessionId] ?? "OPERATIONS") : "OPERATIONS";
          return <article className={styles.card} key={key} data-severity={item.severity}>
            <div className={styles.cardTop}>
              <div><span className={styles.severity}>{item.severity}</span><strong>{item.provider.displayName}</strong><small>{item.provider.class} · {item.service.name}</small></div>
              <div className={styles.state}><small>{c.currentState}</small><b>{item.sessionStatus ?? c.sessionMissing}</b><span>{item.appointmentStatus}</span></div>
            </div>
            <div className={styles.details}>
              <div><span>{c.provider}</span><strong>{item.provider.displayName}</strong></div>
              <div><span>{c.service}</span><strong>{item.service.name}</strong></div>
              <div><span>{c.schedule}</span><strong>{formatDate(item.startsAt, locale)}</strong></div>
              <div><span>{c.consent}</span><strong>{item.consentGranted ? c.yes : c.no}</strong></div>
              <div><span>{c.patientReady}</span><strong>{item.patientReady ? c.yes : c.no}</strong></div>
              <div><span>{c.providerReady}</span><strong>{item.providerReady ? c.yes : c.no}</strong></div>
            </div>
            <div className={styles.signals}><span>{c.signals}</span>{item.attentionReasons.length ? <div>{item.attentionReasons.map((reason) => <b key={reason}>{humanize(reason)}</b>)}</div> : <small>{c.noSignals}</small>}</div>
            {(item.actions.canResetReadiness || item.actions.canTerminateSession) && item.sessionId ? <div className={styles.actions}>
              {item.actions.canResetReadiness ? <button onClick={() => void act(item, "RESET_READINESS")} disabled={busy !== null}>{busy === `RESET_READINESS:${item.sessionId}` ? "…" : c.reset}</button> : null}
              {item.actions.canTerminateSession ? <><label>{c.reason}<select value={terminationReason} onChange={(event) => setReasons((current) => ({ ...current, [item.sessionId!]: event.target.value as Reason }))}>{(Object.keys(labels) as Reason[]).map((reason) => <option key={reason} value={reason}>{labels[reason]}</option>)}</select></label><button className={styles.danger} onClick={() => void act(item, "TERMINATE_SESSION")} disabled={busy !== null}>{busy === `TERMINATE_SESSION:${item.sessionId}` ? "…" : c.terminate}</button></> : null}
            </div> : null}
          </article>;
        })}
      </div>}
    </section>
  </div>;
}

function formatDate(value: string, locale: Locale) {
  const language = locale === "ar" ? "ar" : locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : "en-GB";
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
