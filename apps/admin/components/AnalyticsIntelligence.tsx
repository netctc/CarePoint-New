"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./AnalyticsIntelligence.module.css";

type Days = 7 | 30 | 90;
type Direction = "UP" | "DOWN" | "STABLE" | "NEW";
type Trend = { current: number; previous: number; direction: Direction; deltaPercent: number | null; favorable: boolean | null };
type AppointmentStatusCounts = { REQUESTED: number; CONFIRMED: number; CANCELLED: number; COMPLETED: number; NO_SHOW: number };
type ModalityCounts = { CLINIC: number; TELEMEDICINE: number; HOME_VISIT: number };
type TelehealthStatusCounts = { WAITING: number; READY: number; ACTIVE: number; ENDED: number; CANCELLED: number };
type ClaimStatusCounts = { SUBMITTED: number; ACCEPTED: number; PENDING: number; ADJUDICATED: number; DENIED: number; PAID: number; VOID: number };
type AppointmentAnalytics = {
  total: number;
  byStatus: AppointmentStatusCounts;
  byModality: ModalityCounts;
  completionRate: number;
  cancellationRate: number;
  noShowRate: number;
};
type FinanceRow = {
  currency: string;
  invoiceCount: number;
  invoicedMinor: number;
  successfulPaymentCount: number;
  successfulPaymentsMinor: number;
};
type PeriodSnapshot = {
  appointments: AppointmentAnalytics;
  telehealth: { appointments: number; initializedSessions: number; initializationRate: number; byStatus: TelehealthStatusCounts };
  finance: FinanceRow[];
  claims: { total: number; byStatus: ClaimStatusCounts; reviewRequired: number; denialRate: number };
  security: { events: number; denied: number; replayDenied: number };
  mobility: { emergencyRequests: number; scheduledTransport: { ground: number; air: number } };
};
type Workspace = {
  generatedAt: string;
  window: { days: Days; current: { from: string; to: string }; previous: { from: string; to: string } };
  privacy: Record<string, boolean>;
  network: { activeDoctors: number; activeOtherProviders: number; onboardingReview: number };
  current: PeriodSnapshot;
  previous: PeriodSnapshot;
  signals: Record<string, Trend>;
};

type Copy = {
  eyebrow: string; title: string; intro: string; privacy: string; loading: string; failed: string; updated: string; period: string;
  current: string; previous: string; appointments: string; noShow: string; claimsDenied: string; securityDenied: string; trends: string;
  trendsText: string; favorable: string; unfavorable: string; neutral: string; newValue: string; stable: string;
  outcomes: string; modalities: string; completed: string; cancelled: string; requested: string; confirmed: string;
  clinic: string; telemedicine: string; homeVisit: string; telehealth: string; initialized: string; waiting: string; ready: string; active: string; ended: string;
  finance: string; invoices: string; invoiced: string; payments: string; paidVolume: string; currency: string; noFinance: string;
  claims: string; submitted: string; denied: string; paid: string; review: string; denialRate: string;
  security: string; securityEvents: string; replayDenied: string; network: string; doctors: string; otherProviders: string; onboarding: string;
  mobility: string; emergency: string; ground: string; air: string; rolling: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    eyebrow: "OPERATIONAL INTELLIGENCE", title: "Cross-domain analytics without PHI", intro: "Compare rolling operational periods across appointments, telehealth, finance, claims, security and medical mobility using aggregate-only platform data.", privacy: "Aggregate only · no patient/provider identity · no clinical content · no room or encryption material", loading: "Loading analytics…", failed: "Analytics could not be loaded.", updated: "Updated", period: "Period",
    current: "Current", previous: "Previous", appointments: "Appointments", noShow: "No-show rate", claimsDenied: "Claim denial rate", securityDenied: "Denied security events", trends: "Operational trend signals", trendsText: "Signals compare the selected rolling period with the immediately preceding period. They are deterministic comparisons, not AI predictions.", favorable: "Favorable", unfavorable: "Unfavorable", neutral: "Neutral", newValue: "New", stable: "Stable",
    outcomes: "Appointment outcomes", modalities: "Modality mix", completed: "Completed", cancelled: "Cancelled", requested: "Requested", confirmed: "Confirmed", clinic: "Clinic", telemedicine: "Telemedicine", homeVisit: "Home visit", telehealth: "Telehealth delivery", initialized: "Initialization rate", waiting: "Waiting", ready: "Ready", active: "Active", ended: "Ended",
    finance: "Finance throughput", invoices: "Invoices", invoiced: "Invoiced", payments: "Successful payments", paidVolume: "Payment volume", currency: "Currency", noFinance: "No finance activity in this period.", claims: "Claims", submitted: "Claims in period", denied: "Denied", paid: "Paid", review: "Review required", denialRate: "Denial rate", security: "Security", securityEvents: "Security events", replayDenied: "Replay denials", network: "Provider network snapshot", doctors: "Active doctors", otherProviders: "Active other providers", onboarding: "Onboarding review", mobility: "Medical mobility", emergency: "Emergency requests", ground: "Ground transport", air: "Air transport", rolling: "rolling days"
  },
  ar: {
    eyebrow: "الذكاء التشغيلي", title: "تحليلات متعددة المجالات دون PHI", intro: "قارن الفترات التشغيلية المتحركة للمواعيد والرعاية عن بُعد والمالية والمطالبات والأمان والنقل الطبي باستخدام بيانات مجمعة فقط.", privacy: "بيانات مجمعة فقط · دون هوية المريض أو المقدم · دون محتوى سريري · دون بيانات الغرفة أو التشفير", loading: "جارٍ تحميل التحليلات…", failed: "تعذر تحميل التحليلات.", updated: "آخر تحديث", period: "الفترة",
    current: "الحالية", previous: "السابقة", appointments: "المواعيد", noShow: "نسبة عدم الحضور", claimsDenied: "نسبة رفض المطالبات", securityDenied: "أحداث الأمان المرفوضة", trends: "إشارات الاتجاه التشغيلي", trendsText: "تقارن الإشارات الفترة المختارة بالفترة السابقة مباشرة. هي مقارنات حتمية وليست تنبؤات ذكاء اصطناعي.", favorable: "إيجابي", unfavorable: "سلبي", neutral: "محايد", newValue: "جديد", stable: "مستقر",
    outcomes: "نتائج المواعيد", modalities: "مزيج أنماط الرعاية", completed: "مكتمل", cancelled: "ملغى", requested: "مطلوب", confirmed: "مؤكد", clinic: "عيادة", telemedicine: "طب عن بُعد", homeVisit: "زيارة منزلية", telehealth: "تقديم الرعاية عن بُعد", initialized: "نسبة التهيئة", waiting: "انتظار", ready: "جاهز", active: "نشط", ended: "منتهٍ",
    finance: "التدفق المالي", invoices: "الفواتير", invoiced: "قيمة الفواتير", payments: "مدفوعات ناجحة", paidVolume: "حجم المدفوعات", currency: "العملة", noFinance: "لا يوجد نشاط مالي في هذه الفترة.", claims: "المطالبات", submitted: "مطالبات الفترة", denied: "مرفوض", paid: "مدفوع", review: "تحتاج مراجعة", denialRate: "نسبة الرفض", security: "الأمان", securityEvents: "أحداث الأمان", replayDenied: "رفض إعادة الاستخدام", network: "لقطة شبكة مقدمي الخدمة", doctors: "أطباء نشطون", otherProviders: "مقدمو رعاية آخرون نشطون", onboarding: "مراجعة الانضمام", mobility: "النقل الطبي", emergency: "طلبات طارئة", ground: "نقل بري", air: "نقل جوي", rolling: "يوماً متحركاً"
  },
  fr: {
    eyebrow: "INTELLIGENCE OPÉRATIONNELLE", title: "Analytique transverse sans PHI", intro: "Comparez des périodes glissantes pour les rendez-vous, la télésanté, la finance, les sinistres, la sécurité et le transport médical à partir de données agrégées uniquement.", privacy: "Agrégats uniquement · aucune identité patient/prestataire · aucun contenu clinique · aucune donnée de salle ou de chiffrement", loading: "Chargement de l’analytique…", failed: "Impossible de charger l’analytique.", updated: "Mis à jour", period: "Période",
    current: "Actuelle", previous: "Précédente", appointments: "Rendez-vous", noShow: "Taux d’absence", claimsDenied: "Taux de refus des sinistres", securityDenied: "Événements sécurité refusés", trends: "Signaux de tendance opérationnelle", trendsText: "Les signaux comparent la période sélectionnée à la période précédente. Ce sont des comparaisons déterministes, pas des prédictions IA.", favorable: "Favorable", unfavorable: "Défavorable", neutral: "Neutre", newValue: "Nouveau", stable: "Stable",
    outcomes: "Résultats des rendez-vous", modalities: "Mix des modalités", completed: "Terminés", cancelled: "Annulés", requested: "Demandés", confirmed: "Confirmés", clinic: "Clinique", telemedicine: "Télémédecine", homeVisit: "Visite à domicile", telehealth: "Prestation télésanté", initialized: "Taux d’initialisation", waiting: "En attente", ready: "Prêt", active: "Actif", ended: "Terminé",
    finance: "Flux financier", invoices: "Factures", invoiced: "Facturé", payments: "Paiements réussis", paidVolume: "Volume payé", currency: "Devise", noFinance: "Aucune activité financière sur cette période.", claims: "Sinistres", submitted: "Sinistres de la période", denied: "Refusés", paid: "Payés", review: "Révision requise", denialRate: "Taux de refus", security: "Sécurité", securityEvents: "Événements sécurité", replayDenied: "Replays refusés", network: "Instantané du réseau de prestataires", doctors: "Médecins actifs", otherProviders: "Autres prestataires actifs", onboarding: "Onboarding à revoir", mobility: "Mobilité médicale", emergency: "Demandes urgentes", ground: "Transport terrestre", air: "Transport aérien", rolling: "jours glissants"
  },
  es: {
    eyebrow: "INTELIGENCIA OPERATIVA", title: "Analítica transversal sin PHI", intro: "Compara periodos móviles de citas, telemedicina, finanzas, claims, seguridad y movilidad médica utilizando únicamente datos agregados de plataforma.", privacy: "Sólo agregados · sin identidad de paciente/proveedor · sin contenido clínico · sin datos de sala o cifrado", loading: "Cargando analítica…", failed: "No se pudo cargar la analítica.", updated: "Actualizado", period: "Periodo",
    current: "Actual", previous: "Anterior", appointments: "Citas", noShow: "Tasa no-show", claimsDenied: "Tasa de claims denegados", securityDenied: "Eventos de seguridad denegados", trends: "Señales de tendencia operativa", trendsText: "Las señales comparan el periodo seleccionado con el inmediatamente anterior. Son comparaciones deterministas, no predicciones de IA.", favorable: "Favorable", unfavorable: "Desfavorable", neutral: "Neutral", newValue: "Nuevo", stable: "Estable",
    outcomes: "Resultados de citas", modalities: "Mix de modalidades", completed: "Completadas", cancelled: "Canceladas", requested: "Solicitadas", confirmed: "Confirmadas", clinic: "Clínica", telemedicine: "Telemedicina", homeVisit: "Visita domiciliaria", telehealth: "Prestación Telehealth", initialized: "Tasa de inicialización", waiting: "En espera", ready: "Preparada", active: "Activa", ended: "Finalizada",
    finance: "Throughput financiero", invoices: "Facturas", invoiced: "Facturado", payments: "Pagos exitosos", paidVolume: "Volumen cobrado", currency: "Moneda", noFinance: "Sin actividad financiera en este periodo.", claims: "Claims", submitted: "Claims del periodo", denied: "Denegados", paid: "Pagados", review: "Revisión requerida", denialRate: "Tasa de denegación", security: "Seguridad", securityEvents: "Eventos de seguridad", replayDenied: "Replays denegados", network: "Snapshot de red de proveedores", doctors: "Doctores activos", otherProviders: "Otros proveedores activos", onboarding: "Onboarding a revisar", mobility: "Movilidad médica", emergency: "Solicitudes de emergencia", ground: "Transporte terrestre", air: "Transporte aéreo", rolling: "días móviles"
  },
};

const signalLabels: Record<string, Record<Locale, string>> = {
  appointmentVolume: { en: "Appointment volume", ar: "حجم المواعيد", fr: "Volume de rendez-vous", es: "Volumen de citas" },
  noShowRate: { en: "No-show rate", ar: "نسبة عدم الحضور", fr: "Taux d’absence", es: "Tasa no-show" },
  claimDenialRate: { en: "Claim denial rate", ar: "نسبة رفض المطالبات", fr: "Taux de refus", es: "Tasa de claims denegados" },
  deniedSecurityEvents: { en: "Denied security events", ar: "أحداث الأمان المرفوضة", fr: "Événements sécurité refusés", es: "Eventos de seguridad denegados" },
  telehealthInitializationRate: { en: "Telehealth initialization", ar: "تهيئة الرعاية عن بُعد", fr: "Initialisation télésanté", es: "Inicialización Telehealth" },
  emergencyDemand: { en: "Emergency demand", ar: "الطلب الطارئ", fr: "Demande urgente", es: "Demanda de emergencia" },
};

export function AnalyticsIntelligence() {
  const { locale } = useI18n();
  const c = copy[locale];
  const [days, setDays] = useState<Days>(30);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/analytics/workspace?days=${days}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`);
      setWorkspace(payload as Workspace);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c.failed);
    } finally {
      setLoading(false);
    }
  }, [c.failed, days]);

  useEffect(() => { void load(); }, [load]);

  const finance = useMemo(() => mergeFinance(workspace?.current.finance ?? [], workspace?.previous.finance ?? []), [workspace]);
  if (loading && !workspace) return <section className={styles.loading}>{c.loading}</section>;
  if (!workspace) return <section className={styles.error}>{error ?? c.failed}</section>;

  const kpis = [
    [c.appointments, workspace.current.appointments.total, workspace.previous.appointments.total, false],
    [c.noShow, workspace.current.appointments.noShowRate, workspace.previous.appointments.noShowRate, true],
    [c.claimsDenied, workspace.current.claims.denialRate, workspace.previous.claims.denialRate, true],
    [c.securityDenied, workspace.current.security.denied, workspace.previous.security.denied, false],
  ] as const;

  return <div className={styles.workspace}>
    <section className={styles.hero}>
      <div><span>{c.eyebrow}</span><h2>{c.title}</h2><p>{c.intro}</p><small>{c.privacy}</small></div>
      <div className={styles.periodBox}><small>{c.period}</small><div>{([7, 30, 90] as Days[]).map((value) => <button key={value} data-active={days === value} onClick={() => setDays(value)}>{value}</button>)}</div><em>{days} {c.rolling}</em></div>
    </section>
    {error ? <div className={styles.error}>{error}</div> : null}
    <div className={styles.updated}>{c.updated}: {formatDate(workspace.generatedAt, locale)} · {formatDate(workspace.window.current.from, locale)} → {formatDate(workspace.window.current.to, locale)}</div>

    <section className={styles.metrics}>{kpis.map(([label, current, previous, percentage]) => <article key={label}><span>{label}</span><strong>{percentage ? `${current}%` : current}</strong><small>{c.previous}: {percentage ? `${previous}%` : previous}</small></article>)}</section>

    <section className={styles.panel}>
      <header><div><h3>{c.trends}</h3><p>{c.trendsText}</p></div></header>
      <div className={styles.signalGrid}>{Object.entries(workspace.signals).map(([key, trend]) => <article key={key} data-favorable={trend.favorable === null ? "neutral" : String(trend.favorable)}><span>{signalLabels[key]?.[locale] ?? key}</span><strong>{trend.direction === "NEW" ? c.newValue : trend.direction === "STABLE" ? c.stable : `${trend.direction} ${trend.deltaPercent === null ? "" : `${Math.abs(trend.deltaPercent)}%`}`}</strong><small>{trend.favorable === null ? c.neutral : trend.favorable ? c.favorable : c.unfavorable}</small></article>)}</div>
    </section>

    <div className={styles.twoColumn}>
      <section className={styles.panel}>
        <header><div><h3>{c.outcomes}</h3><p>{c.current} / {c.previous}</p></div></header>
        <ComparisonRow label={c.completed} current={workspace.current.appointments.byStatus.COMPLETED} previous={workspace.previous.appointments.byStatus.COMPLETED} total={workspace.current.appointments.total} />
        <ComparisonRow label={c.cancelled} current={workspace.current.appointments.byStatus.CANCELLED} previous={workspace.previous.appointments.byStatus.CANCELLED} total={workspace.current.appointments.total} />
        <ComparisonRow label={c.noShow} current={workspace.current.appointments.byStatus.NO_SHOW} previous={workspace.previous.appointments.byStatus.NO_SHOW} total={workspace.current.appointments.total} />
        <ComparisonRow label={c.confirmed} current={workspace.current.appointments.byStatus.CONFIRMED} previous={workspace.previous.appointments.byStatus.CONFIRMED} total={workspace.current.appointments.total} />
      </section>
      <section className={styles.panel}>
        <header><div><h3>{c.modalities}</h3><p>{c.current} / {c.previous}</p></div></header>
        <ComparisonRow label={c.clinic} current={workspace.current.appointments.byModality.CLINIC} previous={workspace.previous.appointments.byModality.CLINIC} total={workspace.current.appointments.total} />
        <ComparisonRow label={c.telemedicine} current={workspace.current.appointments.byModality.TELEMEDICINE} previous={workspace.previous.appointments.byModality.TELEMEDICINE} total={workspace.current.appointments.total} />
        <ComparisonRow label={c.homeVisit} current={workspace.current.appointments.byModality.HOME_VISIT} previous={workspace.previous.appointments.byModality.HOME_VISIT} total={workspace.current.appointments.total} />
      </section>
    </div>

    <div className={styles.twoColumn}>
      <section className={styles.panel}>
        <header><div><h3>{c.telehealth}</h3><p>{c.initialized}: {workspace.current.telehealth.initializationRate}% · {c.previous} {workspace.previous.telehealth.initializationRate}%</p></div></header>
        <div className={styles.miniGrid}><Metric label={c.waiting} value={workspace.current.telehealth.byStatus.WAITING} /><Metric label={c.ready} value={workspace.current.telehealth.byStatus.READY} /><Metric label={c.active} value={workspace.current.telehealth.byStatus.ACTIVE} /><Metric label={c.ended} value={workspace.current.telehealth.byStatus.ENDED} /></div>
      </section>
      <section className={styles.panel}>
        <header><div><h3>{c.mobility}</h3><p>{c.current} / {c.previous}</p></div></header>
        <div className={styles.miniGrid}><Metric label={c.emergency} value={`${workspace.current.mobility.emergencyRequests} / ${workspace.previous.mobility.emergencyRequests}`} /><Metric label={c.ground} value={`${workspace.current.mobility.scheduledTransport.ground} / ${workspace.previous.mobility.scheduledTransport.ground}`} /><Metric label={c.air} value={`${workspace.current.mobility.scheduledTransport.air} / ${workspace.previous.mobility.scheduledTransport.air}`} /></div>
      </section>
    </div>

    <section className={styles.panel}>
      <header><div><h3>{c.finance}</h3><p>{c.current} / {c.previous}</p></div></header>
      {finance.length === 0 ? <div className={styles.empty}>{c.noFinance}</div> : <div className={styles.tableWrap}><table><thead><tr><th>{c.currency}</th><th>{c.invoices}</th><th>{c.invoiced}</th><th>{c.payments}</th><th>{c.paidVolume}</th></tr></thead><tbody>{finance.map((row) => <tr key={row.currency}><td><strong>{row.currency}</strong></td><td>{row.current.invoiceCount} / {row.previous.invoiceCount}</td><td>{money(row.current.invoicedMinor, row.currency, locale)} / {money(row.previous.invoicedMinor, row.currency, locale)}</td><td>{row.current.successfulPaymentCount} / {row.previous.successfulPaymentCount}</td><td>{money(row.current.successfulPaymentsMinor, row.currency, locale)} / {money(row.previous.successfulPaymentsMinor, row.currency, locale)}</td></tr>)}</tbody></table></div>}
    </section>

    <div className={styles.threeColumn}>
      <section className={styles.panel}><header><h3>{c.claims}</h3></header><Metric label={c.submitted} value={`${workspace.current.claims.total} / ${workspace.previous.claims.total}`} /><Metric label={c.denied} value={`${workspace.current.claims.byStatus.DENIED} / ${workspace.previous.claims.byStatus.DENIED}`} /><Metric label={c.paid} value={`${workspace.current.claims.byStatus.PAID} / ${workspace.previous.claims.byStatus.PAID}`} /><Metric label={c.review} value={`${workspace.current.claims.reviewRequired} / ${workspace.previous.claims.reviewRequired}`} /></section>
      <section className={styles.panel}><header><h3>{c.security}</h3></header><Metric label={c.securityEvents} value={`${workspace.current.security.events} / ${workspace.previous.security.events}`} /><Metric label={c.securityDenied} value={`${workspace.current.security.denied} / ${workspace.previous.security.denied}`} /><Metric label={c.replayDenied} value={`${workspace.current.security.replayDenied} / ${workspace.previous.security.replayDenied}`} /></section>
      <section className={styles.panel}><header><h3>{c.network}</h3></header><Metric label={c.doctors} value={workspace.network.activeDoctors} /><Metric label={c.otherProviders} value={workspace.network.activeOtherProviders} /><Metric label={c.onboarding} value={workspace.network.onboardingReview} /></section>
    </div>
  </div>;
}

function ComparisonRow({ label, current, previous, total }: { label: string; current: number; previous: number; total: number }) {
  const width = total <= 0 ? 0 : Math.min(100, Math.max(3, (current / total) * 100));
  return <div className={styles.comparison}><div><span>{label}</span><strong>{current} <small>/ {previous}</small></strong></div><div className={styles.track}><i style={{ width: `${width}%` }} /></div></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.metricLine}><span>{label}</span><strong>{value}</strong></div>;
}

function mergeFinance(current: FinanceRow[], previous: FinanceRow[]) {
  const rows = new Map<string, { currency: string; current: FinanceRow; previous: FinanceRow }>();
  const empty = (currency: string): FinanceRow => ({ currency, invoiceCount: 0, invoicedMinor: 0, successfulPaymentCount: 0, successfulPaymentsMinor: 0 });
  for (const row of current) rows.set(row.currency, { currency: row.currency, current: row, previous: empty(row.currency) });
  for (const row of previous) {
    const existing = rows.get(row.currency) ?? { currency: row.currency, current: empty(row.currency), previous: empty(row.currency) };
    existing.previous = row;
    rows.set(row.currency, existing);
  }
  return [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

function money(minor: number, currency: string, locale: Locale) {
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100); }
  catch { return `${currency} ${(minor / 100).toFixed(2)}`; }
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
