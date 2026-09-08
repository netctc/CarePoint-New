"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./SecurityOperations.module.css";

type Severity = "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";
type SessionRow = {
  sessionId: string;
  accountRef: string;
  role: string;
  accountStatus: string;
  current: boolean;
  active: boolean;
  mfaEnabled: boolean;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  maskedIp: string | null;
  client: { browser: string; platform: string; deviceClass: string };
  deniedEvents24h: number;
  risk: Severity;
  riskFlags: string[];
};
type LockedAccount = {
  accountRef: string;
  role: string;
  status: string;
  lockedUntil: string | null;
  failedLoginCount: number;
  deniedEvents24h: number;
};
type SecurityEvent = {
  eventRef: string;
  action: string;
  result: string;
  severity: Severity;
  actorRef: string | null;
  actorRole: string | null;
  objectType: string;
  targetRef: string | null;
  indicators: Record<string, boolean | string>;
  occurredAt: string;
};
type SecurityWorkspace = {
  generatedAt: string;
  privacy: Record<string, boolean>;
  summary: {
    activeAccounts: number;
    privilegedAccounts: number;
    privilegedMfaCoveragePercent: number;
    openSessions: number;
    lockedAccounts: number;
    deniedEvents24h: number;
    replayEvents24h: number;
    elevatedRiskSessions: number;
  };
  queues: {
    sessions: SessionRow[];
    lockedAccounts: LockedAccount[];
    securityEvents: SecurityEvent[];
  };
};

type Copy = {
  eyebrow: string;
  title: string;
  intro: string;
  activeAccounts: string;
  mfaCoverage: string;
  openSessions: string;
  lockedAccounts: string;
  denied24h: string;
  replay24h: string;
  elevated: string;
  sessions: string;
  sessionsText: string;
  account: string;
  client: string;
  ip: string;
  created: string;
  refreshExpiry: string;
  denied: string;
  current: string;
  revoke: string;
  revokeAll: string;
  lockedQueue: string;
  lockedText: string;
  lockedUntil: string;
  events: string;
  eventsText: string;
  actor: string;
  target: string;
  noSessions: string;
  noLocked: string;
  noEvents: string;
  refreshed: string;
  refresh: string;
  loading: string;
  failed: string;
  confirmSession: string;
  confirmAll: string;
  info: string;
  medium: string;
  high: string;
  critical: string;
  mfaOn: string;
  mfaOff: string;
  privacy: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    eyebrow: "SECURITY OPERATIONS", title: "Identity security & audit response", intro: "Investigate live IAM posture, prioritize risky sessions and revoke compromised access without exposing bearer tokens or patient identity.",
    activeAccounts: "Active accounts", mfaCoverage: "Privileged MFA", openSessions: "Open sessions", lockedAccounts: "Locked accounts", denied24h: "Denied events · 24h", replay24h: "Replay signals · 24h", elevated: "Elevated sessions",
    sessions: "Session response queue", sessionsText: "Risk is heuristic and based on account state, MFA posture and recent denied/replay events.", account: "Account", client: "Client", ip: "Masked IP", created: "Created", refreshExpiry: "Refresh expiry", denied: "Denied · 24h", current: "Current session", revoke: "Revoke session", revokeAll: "Revoke account sessions",
    lockedQueue: "Temporarily locked accounts", lockedText: "Accounts remain pseudonymized; the queue is for investigation, not identity lookup.", lockedUntil: "Locked until",
    events: "Security audit stream", eventsText: "Only whitelisted IAM/security event fields are exposed; raw audit metadata is never sent to the browser.", actor: "Actor", target: "Target",
    noSessions: "No active sessions.", noLocked: "No temporarily locked accounts.", noEvents: "No security events in the current window.", refreshed: "Updated", refresh: "Refresh", loading: "Loading security posture…", failed: "Security workspace could not be loaded.",
    confirmSession: "Revoke this remote session?", confirmAll: "Revoke all sessions for this pseudonymous account?", info: "Info", medium: "Medium", high: "High", critical: "Critical", mfaOn: "MFA enabled", mfaOff: "MFA missing", privacy: "PHI-neutral · pseudonymized identities · masked network context"
  },
  ar: {
    eyebrow: "عمليات الأمن", title: "أمن الهوية والاستجابة للتدقيق", intro: "تحقق من وضع IAM المباشر ورتب الجلسات حسب المخاطر وألغِ الوصول المخترق دون كشف رموز المصادقة أو هوية المريض.",
    activeAccounts: "الحسابات النشطة", mfaCoverage: "MFA للحسابات المميزة", openSessions: "الجلسات المفتوحة", lockedAccounts: "الحسابات المقفلة", denied24h: "أحداث مرفوضة · 24س", replay24h: "إشارات إعادة استخدام · 24س", elevated: "جلسات مرتفعة المخاطر",
    sessions: "قائمة الاستجابة للجلسات", sessionsText: "المخاطر تقديرية وتعتمد على حالة الحساب وMFA والأحداث المرفوضة أو المعاد استخدامها مؤخراً.", account: "الحساب", client: "العميل", ip: "IP مخفي", created: "الإنشاء", refreshExpiry: "انتهاء التحديث", denied: "مرفوض · 24س", current: "الجلسة الحالية", revoke: "إلغاء الجلسة", revokeAll: "إلغاء جلسات الحساب",
    lockedQueue: "الحسابات المقفلة مؤقتاً", lockedText: "تبقى الحسابات بأسماء مستعارة؛ القائمة للتحقيق وليست للبحث عن الهوية.", lockedUntil: "مقفل حتى",
    events: "سجل تدقيق الأمان", eventsText: "يتم عرض حقول IAM والأمان المسموح بها فقط؛ لا يتم إرسال metadata الخام للمتصفح.", actor: "الفاعل", target: "الهدف",
    noSessions: "لا توجد جلسات نشطة.", noLocked: "لا توجد حسابات مقفلة مؤقتاً.", noEvents: "لا توجد أحداث أمان في النافذة الحالية.", refreshed: "آخر تحديث", refresh: "تحديث", loading: "جارٍ تحميل وضع الأمان…", failed: "تعذر تحميل مساحة عمل الأمان.",
    confirmSession: "إلغاء هذه الجلسة البعيدة؟", confirmAll: "إلغاء جميع جلسات هذا الحساب المستعار؟", info: "معلومات", medium: "متوسط", high: "مرتفع", critical: "حرج", mfaOn: "MFA مفعل", mfaOff: "MFA غير مفعل", privacy: "دون PHI · هويات مستعارة · سياق شبكة مخفي"
  },
  fr: {
    eyebrow: "OPÉRATIONS SÉCURITÉ", title: "Sécurité des identités & réponse d’audit", intro: "Analysez la posture IAM en direct, priorisez les sessions à risque et révoquez les accès compromis sans exposer de jetons ni l’identité patient.",
    activeAccounts: "Comptes actifs", mfaCoverage: "MFA privilégié", openSessions: "Sessions ouvertes", lockedAccounts: "Comptes verrouillés", denied24h: "Événements refusés · 24 h", replay24h: "Signaux de rejeu · 24 h", elevated: "Sessions à risque",
    sessions: "File de réponse des sessions", sessionsText: "Le risque est heuristique et combine l’état du compte, la posture MFA et les refus/rejeux récents.", account: "Compte", client: "Client", ip: "IP masquée", created: "Créée", refreshExpiry: "Expiration refresh", denied: "Refus · 24 h", current: "Session actuelle", revoke: "Révoquer la session", revokeAll: "Révoquer les sessions du compte",
    lockedQueue: "Comptes temporairement verrouillés", lockedText: "Les comptes restent pseudonymisés ; cette file sert à l’investigation, pas à l’identification.", lockedUntil: "Verrouillé jusqu’à",
    events: "Flux d’audit sécurité", eventsText: "Seuls les champs IAM/sécurité autorisés sont exposés ; les métadonnées brutes ne sont jamais envoyées au navigateur.", actor: "Acteur", target: "Cible",
    noSessions: "Aucune session active.", noLocked: "Aucun compte temporairement verrouillé.", noEvents: "Aucun événement de sécurité dans la fenêtre actuelle.", refreshed: "Mis à jour", refresh: "Actualiser", loading: "Chargement de la posture de sécurité…", failed: "Impossible de charger l’espace sécurité.",
    confirmSession: "Révoquer cette session distante ?", confirmAll: "Révoquer toutes les sessions de ce compte pseudonymisé ?", info: "Info", medium: "Moyen", high: "Élevé", critical: "Critique", mfaOn: "MFA activé", mfaOff: "MFA absent", privacy: "Sans PHI · identités pseudonymisées · contexte réseau masqué"
  },
  es: {
    eyebrow: "OPERACIONES DE SEGURIDAD", title: "Seguridad de identidad y respuesta de auditoría", intro: "Investiga la postura IAM en vivo, prioriza sesiones de riesgo y revoca accesos comprometidos sin exponer bearer tokens ni identidad del paciente.",
    activeAccounts: "Cuentas activas", mfaCoverage: "MFA privilegiado", openSessions: "Sesiones abiertas", lockedAccounts: "Cuentas bloqueadas", denied24h: "Eventos denegados · 24 h", replay24h: "Señales de replay · 24 h", elevated: "Sesiones elevadas",
    sessions: "Cola de respuesta de sesiones", sessionsText: "El riesgo es heurístico y combina estado de cuenta, postura MFA y eventos recientes de denegación o replay.", account: "Cuenta", client: "Cliente", ip: "IP enmascarada", created: "Creada", refreshExpiry: "Expiración refresh", denied: "Denegados · 24 h", current: "Sesión actual", revoke: "Revocar sesión", revokeAll: "Revocar sesiones de cuenta",
    lockedQueue: "Cuentas temporalmente bloqueadas", lockedText: "Las cuentas permanecen pseudonimizadas; esta cola sirve para investigar, no para identificar pacientes.", lockedUntil: "Bloqueada hasta",
    events: "Flujo de auditoría de seguridad", eventsText: "Sólo se exponen campos IAM/seguridad permitidos; el metadata bruto nunca llega al navegador.", actor: "Actor", target: "Objetivo",
    noSessions: "No hay sesiones activas.", noLocked: "No hay cuentas temporalmente bloqueadas.", noEvents: "No hay eventos de seguridad en la ventana actual.", refreshed: "Actualizado", refresh: "Actualizar", loading: "Cargando postura de seguridad…", failed: "No se pudo cargar el workspace de seguridad.",
    confirmSession: "¿Revocar esta sesión remota?", confirmAll: "¿Revocar todas las sesiones de esta cuenta pseudonimizada?", info: "Info", medium: "Medio", high: "Alto", critical: "Crítico", mfaOn: "MFA activo", mfaOff: "MFA ausente", privacy: "PHI-neutral · identidades pseudonimizadas · contexto de red enmascarado"
  },
};

export function SecurityOperations() {
  const { locale } = useI18n();
  const c = copy[locale];
  const [workspace, setWorkspace] = useState<SecurityWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/security/workspace", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setWorkspace(await response.json() as SecurityWorkspace);
    } catch {
      setError(c.failed);
    } finally {
      setLoading(false);
    }
  }, [c.failed]);

  useEffect(() => { void load(); }, [load]);

  async function act(action: "REVOKE_SESSION" | "REVOKE_ACCOUNT_SESSIONS", session: SessionRow) {
    if (session.current) return;
    const message = action === "REVOKE_SESSION" ? c.confirmSession : c.confirmAll;
    if (!window.confirm(message)) return;
    setBusy(`${action}:${session.sessionId}`);
    setError(null);
    try {
      const response = await fetch("/api/admin/security/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, sessionId: session.sessionId }),
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
    [c.activeAccounts, String(workspace.summary.activeAccounts)],
    [c.mfaCoverage, `${workspace.summary.privilegedMfaCoveragePercent}%`],
    [c.openSessions, String(workspace.summary.openSessions)],
    [c.lockedAccounts, String(workspace.summary.lockedAccounts)],
    [c.denied24h, String(workspace.summary.deniedEvents24h)],
    [c.replay24h, String(workspace.summary.replayEvents24h)],
    [c.elevated, String(workspace.summary.elevatedRiskSessions)],
  ] as const;

  return <div className={styles.workspace}>
    <section className={styles.hero}>
      <div><span>{c.eyebrow}</span><h2>{c.title}</h2><p>{c.intro}</p><small>{c.privacy}</small></div>
      <button className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? c.loading : c.refresh}</button>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}

    <section className={styles.metrics}>
      {metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </section>

    <section className={styles.panel}>
      <div className={styles.heading}><div><span>{c.eyebrow}</span><h3>{c.sessions}</h3><p>{c.sessionsText}</p></div><small>{c.refreshed}: {formatDate(workspace.generatedAt, locale)}</small></div>
      <div className={styles.sessionGrid}>
        {workspace.queues.sessions.length ? workspace.queues.sessions.map((session) => {
          const key = `REVOKE_SESSION:${session.sessionId}`;
          const allKey = `REVOKE_ACCOUNT_SESSIONS:${session.sessionId}`;
          return <article className={styles.sessionCard} key={session.sessionId}>
            <div className={styles.sessionTop}><div><strong>{session.accountRef}</strong><span>{session.role} · {session.accountStatus}</span></div><SeverityBadge severity={session.risk} copy={c}/></div>
            <div className={styles.sessionFacts}>
              <span><b>{c.client}</b>{session.client.browser} · {session.client.platform} · {session.client.deviceClass}</span>
              <span><b>{c.ip}</b>{session.maskedIp ?? "—"}</span>
              <span><b>{c.created}</b>{formatDate(session.createdAt, locale)}</span>
              <span><b>{c.refreshExpiry}</b>{formatDate(session.refreshExpiresAt, locale)}</span>
              <span><b>{c.denied}</b>{session.deniedEvents24h}</span>
              <span><b>MFA</b>{session.mfaEnabled ? c.mfaOn : c.mfaOff}</span>
            </div>
            {session.riskFlags.length ? <div className={styles.flags}>{session.riskFlags.map((flag) => <em key={flag}>{flag.replaceAll("_", " ")}</em>)}</div> : null}
            <div className={styles.actions}>
              {session.current ? <span className={styles.current}>{c.current}</span> : <>
                <button onClick={() => void act("REVOKE_SESSION", session)} disabled={busy !== null}>{busy === key ? "…" : c.revoke}</button>
                <button className={styles.danger} onClick={() => void act("REVOKE_ACCOUNT_SESSIONS", session)} disabled={busy !== null}>{busy === allKey ? "…" : c.revokeAll}</button>
              </>}
            </div>
          </article>;
        }) : <p className={styles.empty}>{c.noSessions}</p>}
      </div>
    </section>

    <section className={styles.twoColumn}>
      <div className={styles.panel}>
        <div className={styles.heading}><div><span>{c.eyebrow}</span><h3>{c.lockedQueue}</h3><p>{c.lockedText}</p></div></div>
        <div className={styles.compactList}>
          {workspace.queues.lockedAccounts.length ? workspace.queues.lockedAccounts.map((account) => <div key={account.accountRef}>
            <div><strong>{account.accountRef}</strong><span>{account.role} · {account.status}</span></div>
            <div><b>{c.lockedUntil}</b><span>{account.lockedUntil ? formatDate(account.lockedUntil, locale) : "—"}</span><small>{c.denied}: {account.deniedEvents24h}</small></div>
          </div>) : <p className={styles.empty}>{c.noLocked}</p>}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.heading}><div><span>{c.eyebrow}</span><h3>{c.events}</h3><p>{c.eventsText}</p></div></div>
        <div className={styles.eventList}>
          {workspace.queues.securityEvents.length ? workspace.queues.securityEvents.map((event) => <div key={`${event.eventRef}-${event.occurredAt}`}>
            <SeverityBadge severity={event.severity} copy={c}/>
            <div><strong>{event.action}</strong><span>{event.eventRef} · {event.result}</span><small>{c.actor}: {event.actorRef ?? "SYSTEM"}{event.actorRole ? ` · ${event.actorRole}` : ""}</small><small>{c.target}: {event.targetRef ?? event.objectType}</small></div>
            <time>{formatDate(event.occurredAt, locale)}</time>
          </div>) : <p className={styles.empty}>{c.noEvents}</p>}
        </div>
      </div>
    </section>
  </div>;
}

function SeverityBadge({ severity, copy: c }: { severity: Severity; copy: Copy }) {
  const label = severity === "CRITICAL" ? c.critical : severity === "HIGH" ? c.high : severity === "MEDIUM" ? c.medium : c.info;
  return <span className={`${styles.severity} ${styles[`severity${severity}`]}`}>{label}</span>;
}

function formatDate(value: string, locale: Locale) {
  const tag = locale === "ar" ? "ar-SA" : locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : "en-US";
  return new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
