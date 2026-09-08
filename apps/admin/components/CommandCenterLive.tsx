"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./CommandCenterLive.module.css";

type CountSummary = { total: number; statuses: Record<string, number> };
type OpenReviewSummary = { pendingReview: number; requestChanges: number; totalOpen: number };
type TransportSummary = { active: number; statuses: Record<string, number> };
type MoneySummary = { currency: string; count: number; balanceDueMinor?: number; amountMinor?: number };

type CommandCenterSnapshot = {
  generatedAt: string;
  window: { timezoneOffsetMinutes: number; start: string; end: string };
  health: { status: "OPERATIONAL"; source: string };
  kpis: { visitsToday: number; activeDoctors: number; activeOtherProviders: number; urgentRequests: number };
  appointments: { total: number; byModality: { CLINIC: CountSummary; TELEMEDICINE: CountSummary; HOME_VISIT: CountSummary } };
  governance: { doctors: OpenReviewSummary; otherProviders: OpenReviewSummary };
  emergency: {
    active: number;
    queue: Array<{ requestId: string; status: string; requestedAt: string; etaMinutes: number | null; assignedProvider: string | null }>;
  };
  transport: { ground: TransportSummary; air: TransportSummary };
  finance: { outstandingInvoices: MoneySummary[]; pendingPayouts: MoneySummary[] };
  revenueCycle: { attentionClaims: number };
  security: {
    deniedEventsLast24h: number;
    recentDeniedEvents: Array<{ action: string; objectType: string; result: string; occurredAt: string }>;
  };
};

type Copy = {
  refreshing: string; refreshed: string; unavailable: string; liveSnapshot: string; pendingReview: string; changesRequested: string;
  governance: string; governanceText: string; transport: string; transportText: string; finance: string; financeText: string;
  security: string; securityText: string; openDoctors: string; openProviders: string; openAppointments: string; openSecurity: string;
  ground: string; air: string; activeJobs: string; outstanding: string; payouts: string; claimsAttention: string; denied24h: string;
  noEmergency: string; noSecurity: string; unassigned: string; eta: string; requested: string; confirmed: string; completed: string;
  operational: string; databaseSnapshot: string; refresh: string; queue: string; lastUpdated: string;
};

const copy: Record<Locale, Copy> = {
  en: { refreshing:"Refreshing…",refreshed:"Live data",unavailable:"Live operational data is temporarily unavailable.",liveSnapshot:"LIVE DATABASE SNAPSHOT",pendingReview:"pending review",changesRequested:"changes requested",governance:"Provider governance",governanceText:"Credential review workload across Doctor and Other Provider domains.",transport:"Medical transport",transportText:"Active ground and air medical transport jobs.",finance:"Finance & revenue",financeText:"Outstanding patient balances, provider payouts and claims requiring attention.",security:"Security signals",securityText:"Denied authorization events observed during the last 24 hours.",openDoctors:"Open Doctors",openProviders:"Open Providers",openAppointments:"Open Appointments",openSecurity:"Open Security",ground:"Ground",air:"Air",activeJobs:"active jobs",outstanding:"Outstanding invoices",payouts:"Pending payouts",claimsAttention:"Claims needing attention",denied24h:"Denied events / 24h",noEmergency:"No active emergency ambulance requests.",noSecurity:"No denied security events in the last 24 hours.",unassigned:"Unassigned",eta:"ETA",requested:"requested",confirmed:"confirmed",completed:"completed",operational:"Operational",databaseSnapshot:"Live database snapshot",refresh:"Refresh",queue:"Priority dispatch",lastUpdated:"Last updated" },
  ar: { refreshing:"جارٍ التحديث…",refreshed:"بيانات مباشرة",unavailable:"البيانات التشغيلية المباشرة غير متاحة مؤقتاً.",liveSnapshot:"لقطة مباشرة من قاعدة البيانات",pendingReview:"بانتظار المراجعة",changesRequested:"طُلبت تعديلات",governance:"حوكمة مقدمي الخدمة",governanceText:"عبء مراجعة الاعتمادات في نطاق الأطباء ومقدمي الخدمة الآخرين.",transport:"النقل الطبي",transportText:"مهام النقل الطبي البري والجوي النشطة.",finance:"المالية ودورة الإيرادات",financeText:"الأرصدة المستحقة ومدفوعات مقدمي الخدمة والمطالبات التي تتطلب متابعة.",security:"إشارات الأمان",securityText:"محاولات الوصول المرفوضة خلال آخر 24 ساعة.",openDoctors:"فتح الأطباء",openProviders:"فتح مقدمي الخدمة",openAppointments:"فتح المواعيد",openSecurity:"فتح الأمان",ground:"بري",air:"جوي",activeJobs:"مهام نشطة",outstanding:"فواتير مستحقة",payouts:"مدفوعات معلّقة",claimsAttention:"مطالبات تحتاج متابعة",denied24h:"عمليات رفض / 24 ساعة",noEmergency:"لا توجد طلبات إسعاف طارئة نشطة.",noSecurity:"لا توجد أحداث أمان مرفوضة خلال آخر 24 ساعة.",unassigned:"غير معيّن",eta:"الوقت المتوقع",requested:"مطلوبة",confirmed:"مؤكدة",completed:"مكتملة",operational:"تشغيلي",databaseSnapshot:"لقطة مباشرة من قاعدة البيانات",refresh:"تحديث",queue:"أولوية الإرسال",lastUpdated:"آخر تحديث" },
  fr: { refreshing:"Actualisation…",refreshed:"Données en direct",unavailable:"Les données opérationnelles en direct sont temporairement indisponibles.",liveSnapshot:"INSTANTANÉ LIVE DE LA BASE",pendingReview:"en attente de revue",changesRequested:"modifications demandées",governance:"Gouvernance prestataires",governanceText:"Charge de revue des habilitations des domaines Médecins et Autres Prestataires.",transport:"Transport médical",transportText:"Missions actives de transport médical terrestre et aérien.",finance:"Finance & cycle de revenus",financeText:"Soldes patients ouverts, paiements prestataires et demandes nécessitant une attention.",security:"Signaux de sécurité",securityText:"Autorisations refusées observées au cours des dernières 24 heures.",openDoctors:"Ouvrir Médecins",openProviders:"Ouvrir Prestataires",openAppointments:"Ouvrir Rendez-vous",openSecurity:"Ouvrir Sécurité",ground:"Terrestre",air:"Aérien",activeJobs:"missions actives",outstanding:"Factures ouvertes",payouts:"Paiements en attente",claimsAttention:"Demandes à traiter",denied24h:"Refus / 24h",noEmergency:"Aucune demande d’ambulance d’urgence active.",noSecurity:"Aucun événement de sécurité refusé sur les dernières 24 heures.",unassigned:"Non assigné",eta:"ETA",requested:"demandées",confirmed:"confirmées",completed:"terminées",operational:"Opérationnel",databaseSnapshot:"Instantané live de la base",refresh:"Actualiser",queue:"Dispatch prioritaire",lastUpdated:"Dernière mise à jour" },
  es: { refreshing:"Actualizando…",refreshed:"Datos en vivo",unavailable:"Los datos operativos en vivo no están disponibles temporalmente.",liveSnapshot:"INSTANTÁNEA EN VIVO DE BASE DE DATOS",pendingReview:"pendientes de revisión",changesRequested:"cambios solicitados",governance:"Gobernanza de proveedores",governanceText:"Carga de revisión de credenciales en los dominios Doctor y Otros Proveedores.",transport:"Transporte médico",transportText:"Servicios activos de transporte médico terrestre y aéreo.",finance:"Finanzas y ciclo de ingresos",financeText:"Saldos pendientes, pagos a proveedores y reclamaciones que requieren atención.",security:"Señales de seguridad",securityText:"Eventos de autorización denegados observados durante las últimas 24 horas.",openDoctors:"Abrir Doctores",openProviders:"Abrir Proveedores",openAppointments:"Abrir Citas",openSecurity:"Abrir Seguridad",ground:"Terrestre",air:"Aéreo",activeJobs:"servicios activos",outstanding:"Facturas pendientes",payouts:"Pagos pendientes",claimsAttention:"Reclamaciones a revisar",denied24h:"Denegaciones / 24h",noEmergency:"No hay solicitudes activas de ambulancia de emergencia.",noSecurity:"No hay eventos de seguridad denegados en las últimas 24 horas.",unassigned:"Sin asignar",eta:"ETA",requested:"solicitadas",confirmed:"confirmadas",completed:"completadas",operational:"Operativo",databaseSnapshot:"Instantánea en vivo de base de datos",refresh:"Actualizar",queue:"Despacho prioritario",lastUpdated:"Última actualización" },
};

export function CommandCenterLive() {
  const { t, locale } = useI18n();
  const c = copy[locale];
  const [snapshot, setSnapshot] = useState<CommandCenterSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
      const response = await fetch(`/api/admin/operations/command-center?tzOffsetMinutes=${timezoneOffsetMinutes}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : c.unavailable);
      setSnapshot(payload as CommandCenterSnapshot);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c.unavailable);
    } finally {
      setLoading(false);
    }
  }, [c.unavailable]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!snapshot && loading) return <section className={styles.skeleton}>{c.refreshing}</section>;
  if (!snapshot) return <section className={styles.error}>{error || c.unavailable}<div className={styles.linkRow}><button className={styles.refreshButton} onClick={() => void load()}>{c.refresh}</button></div></section>;

  const modality = snapshot.appointments.byModality;
  const flow = [
    [t("command.clinicVisits"), modality.CLINIC.total, statusDetail(modality.CLINIC.statuses, c), "blue"],
    [t("command.telemedicine"), modality.TELEMEDICINE.total, statusDetail(modality.TELEMEDICINE.statuses, c), "violet"],
    [t("command.homeVisits"), modality.HOME_VISIT.total, statusDetail(modality.HOME_VISIT.statuses, c), "green"],
    [t("command.emergencyAmbulance"), snapshot.emergency.active, `${snapshot.emergency.active} ${c.activeJobs}`, "rose"],
  ] as const;
  const oldestEmergency = snapshot.emergency.queue[0] ?? null;

  return <>
    <div className={styles.toolbar}>
      <div className={styles.toolbarMeta}><span className={styles.miniBadge}>{c.liveSnapshot}</span><span>{c.lastUpdated}: {formatTime(snapshot.generatedAt, locale)}</span>{error ? <span>{error}</span> : null}</div>
      <button className={styles.refreshButton} disabled={loading} onClick={() => void load()}>{loading ? c.refreshing : c.refresh}</button>
    </div>

    <section className="aurora-hero"><div className="hero-copy"><span className="overline">{t("command.heroOverline")}</span><h2>{t("command.heroTitle")}</h2><p>{t("command.heroText")}</p></div><div className="hero-status"><small>{t("command.platformHealth")}</small><strong><i /> {c.operational}</strong><span>{c.databaseSnapshot}</span></div></section>

    <section className="kpi-grid"><KpiCard label={t("command.visitsToday")} value={String(snapshot.kpis.visitsToday)} detail={statusDetailFromAll(modality, c)}/><KpiCard label={t("command.activeDoctors")} value={String(snapshot.kpis.activeDoctors)} detail={t("command.allSpecialties")} tone="violet"/><KpiCard label={t("command.otherProviders")} value={String(snapshot.kpis.activeOtherProviders)} detail={t("command.doctorsExcluded")} tone="green"/><KpiCard label={t("command.urgentRequests")} value={String(snapshot.kpis.urgentRequests).padStart(2,"0")} detail={t("command.ambulanceQueue")} tone="rose"/></section>

    <section className="two-column"><article className="panel"><div className="panel-heading"><div><span>{t("command.liveDemand")}</span><h3>{t("command.visitsByModality")}</h3></div><Link className={styles.linkButton} href="/appointments">{c.openAppointments}</Link></div><div className="flow-list">{flow.map(([name,count,detail,tone])=><div className="flow-row" key={name}><i className={tone}/><div><strong>{name}</strong><span>{detail}</span></div><b>{count}</b></div>)}</div></article><article className="panel midnight"><div className="panel-heading"><div><span>{t("command.emergencyAmbulance")}</span><h3>{c.queue}</h3></div><span className="live-label">{t("common.live")}</span></div>{oldestEmergency ? <div className={styles.queue}><div className={styles.queueItem}><div><strong>CP-ER-{oldestEmergency.requestId.slice(0,8).toUpperCase()}</strong><span>{oldestEmergency.status} · {oldestEmergency.assignedProvider || c.unassigned}</span></div><div className={styles.queueMeta}><b>{elapsed(oldestEmergency.requestedAt)}</b><span>{oldestEmergency.etaMinutes === null ? "" : `${c.eta} ${oldestEmergency.etaMinutes}m`}</span></div></div>{snapshot.emergency.queue.slice(1).map((item)=><div className={styles.queueItem} key={item.requestId}><div><strong>CP-ER-{item.requestId.slice(0,8).toUpperCase()}</strong><span>{item.status} · {item.assignedProvider || c.unassigned}</span></div><div className={styles.queueMeta}><b>{elapsed(item.requestedAt)}</b></div></div>)}</div> : <div className={styles.empty}>{c.noEmergency}</div>}</article></section>

    <section className={styles.opsGrid}>
      <article className={styles.opsCard}><span>{c.governance}</span><strong>{snapshot.governance.doctors.totalOpen + snapshot.governance.otherProviders.totalOpen}</strong><p>{c.governanceText}</p><div className={styles.row}><div className={styles.rowMain}><strong>{t("command.doctorDomain")}</strong><span>{snapshot.governance.doctors.pendingReview} {c.pendingReview} · {snapshot.governance.doctors.requestChanges} {c.changesRequested}</span></div><b>{snapshot.governance.doctors.totalOpen}</b></div><div className={styles.row}><div className={styles.rowMain}><strong>{t("command.otherDomain")}</strong><span>{snapshot.governance.otherProviders.pendingReview} {c.pendingReview} · {snapshot.governance.otherProviders.requestChanges} {c.changesRequested}</span></div><b>{snapshot.governance.otherProviders.totalOpen}</b></div><div className={styles.linkRow}><Link className={styles.linkButton} href="/doctors">{c.openDoctors}</Link><Link className={styles.linkButton} href="/providers">{c.openProviders}</Link></div></article>

      <article className={styles.opsCard}><span>{c.transport}</span><strong>{snapshot.transport.ground.active + snapshot.transport.air.active}</strong><p>{c.transportText}</p><div className={styles.row}><div className={styles.rowMain}><strong>{c.ground}</strong><span>{transportDetail(snapshot.transport.ground.statuses)}</span></div><b>{snapshot.transport.ground.active}</b></div><div className={styles.row}><div className={styles.rowMain}><strong>{c.air}</strong><span>{transportDetail(snapshot.transport.air.statuses)}</span></div><b>{snapshot.transport.air.active}</b></div></article>

      <article className={styles.opsCard}><span>{c.finance}</span><strong>{snapshot.revenueCycle.attentionClaims}</strong><p>{c.financeText}</p><div className={styles.financeList}>{snapshot.finance.outstandingInvoices.map((item)=><div className={styles.row} key={`invoice-${item.currency}`}><div className={styles.rowMain}><strong>{c.outstanding}</strong><span>{item.count} · {item.currency}</span></div><b className={styles.money}>{formatMoney(item.balanceDueMinor || 0,item.currency,locale)}</b></div>)}{snapshot.finance.pendingPayouts.map((item)=><div className={styles.row} key={`payout-${item.currency}`}><div className={styles.rowMain}><strong>{c.payouts}</strong><span>{item.count} · {item.currency}</span></div><b className={styles.money}>{formatMoney(item.amountMinor || 0,item.currency,locale)}</b></div>)}</div><div className={styles.row}><div className={styles.rowMain}><strong>{c.claimsAttention}</strong><span>REVIEW_REQUIRED / DENIED</span></div><b>{snapshot.revenueCycle.attentionClaims}</b></div></article>

      <article className={styles.opsCard}><span>{c.security}</span><strong>{snapshot.security.deniedEventsLast24h}</strong><p>{c.securityText}</p>{snapshot.security.recentDeniedEvents.length ? snapshot.security.recentDeniedEvents.map((event,index)=><div className={styles.securityEvent} key={`${event.action}-${event.occurredAt}-${index}`}><div><strong>{event.action}</strong><span>{event.objectType}</span></div><time>{formatTime(event.occurredAt,locale)}</time></div>) : <div className={styles.empty}>{c.noSecurity}</div>}<div className={styles.linkRow}><Link className={styles.linkButton} href="/security">{c.openSecurity}</Link></div></article>
    </section>
  </>;
}

function statusDetail(statuses: Record<string, number>, c: Copy) {
  const parts = [["REQUESTED",c.requested],["CONFIRMED",c.confirmed],["COMPLETED",c.completed]] as const;
  const visible = parts.filter(([status]) => (statuses[status] || 0) > 0).map(([status,label]) => `${statuses[status]} ${label}`);
  return visible.length ? visible.join(" · ") : "—";
}

function statusDetailFromAll(modalities: CommandCenterSnapshot["appointments"]["byModality"], c: Copy) {
  const total = (status: string) => Object.values(modalities).reduce((sum,item)=>sum+(item.statuses[status] || 0),0);
  const parts = [[total("CONFIRMED"),c.confirmed],[total("COMPLETED"),c.completed]] as const;
  return parts.filter(([count])=>count>0).map(([count,label])=>`${count} ${label}`).join(" · ") || c.refreshed;
}

function transportDetail(statuses: Record<string, number>) {
  const entries = Object.entries(statuses).filter(([,count])=>count>0).sort(([a],[b])=>a.localeCompare(b));
  return entries.length ? entries.map(([status,count])=>`${count} ${status.replaceAll("_"," ").toLowerCase()}`).join(" · ") : "—";
}

function elapsed(value: string) {
  const seconds = Math.max(0,Math.floor((Date.now()-Date.parse(value))/1000));
  const hours = Math.floor(seconds/3600);
  const minutes = Math.floor((seconds%3600)/60);
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2,"0")}m` : `${minutes}m`;
}

function formatTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale,{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(date);
}

function formatMoney(minor: number, currency: string, locale: Locale) {
  try { return new Intl.NumberFormat(locale,{style:"currency",currency}).format(minor/100); }
  catch { return `${currency} ${(minor/100).toFixed(2)}`; }
}
