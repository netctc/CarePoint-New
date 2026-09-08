"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./AppointmentsOperations.module.css";

type AppointmentStatus = "REQUESTED" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
type AppointmentModality = "CLINIC" | "TELEMEDICINE" | "HOME_VISIT";
type ProviderOption = { id: string; class: "DOCTOR" | "OTHER_PROVIDER"; displayName: string };
type Summary = { total: number; statuses: Record<string, number> };
type AppointmentItem = {
  appointmentId: string;
  status: AppointmentStatus;
  modality: AppointmentModality;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  provider: ProviderOption;
  service: { id: string; name: string };
  telehealth: { status: string } | null;
  operations: { canCancel: boolean; canComplete: boolean; canNoShow: boolean };
};
type AppointmentSnapshot = {
  generatedAt: string;
  window: { from: string; to: string; timezoneOffsetMinutes: number };
  filters: { modality: AppointmentModality | null; status: AppointmentStatus | null; providerId: string | null; providers: ProviderOption[] };
  total: number;
  truncated: boolean;
  summary: Record<AppointmentModality, Summary>;
  items: AppointmentItem[];
};

type Copy = {
  live: string; refresh: string; refreshing: string; unavailable: string; date: string; modality: string; status: string; provider: string;
  allModalities: string; allStatuses: string; allProviders: string; total: string; showing: string; truncated: string; noAppointments: string;
  clinic: string; telemedicine: string; homeVisit: string; appointment: string; providerLabel: string; service: string; schedule: string;
  telehealthStatus: string; operations: string; selectHint: string; cancel: string; complete: string; noShow: string; reason: string;
  patientRequest: string; providerUnavailable: string; operationsReason: string; duplicate: string; other: string; confirmCancel: string;
  confirmComplete: string; confirmNoShow: string; actionSuccess: string; actionFailed: string; operationalRef: string; noPatientData: string;
  requested: string; confirmed: string; cancelled: string; completed: string; noShowStatus: string; lastUpdated: string;
};

const copy: Record<Locale, Copy> = {
  en: { live:"LIVE APPOINTMENT OPERATIONS",refresh:"Refresh",refreshing:"Refreshing…",unavailable:"Appointment operations are temporarily unavailable.",date:"Date",modality:"Modality",status:"Status",provider:"Provider",allModalities:"All modalities",allStatuses:"All statuses",allProviders:"All providers",total:"Appointments",showing:"Showing",truncated:"Result limited to the first 250 appointments.",noAppointments:"No appointments match the selected operational filters.",clinic:"Clinic",telemedicine:"Telemedicine",homeVisit:"Home visit",appointment:"Appointment",providerLabel:"Provider",service:"Service",schedule:"Schedule",telehealthStatus:"Telehealth status",operations:"Operational intervention",selectHint:"Select an appointment to inspect its PHI-neutral operational details.",cancel:"Cancel appointment",complete:"Mark completed",noShow:"Mark no-show",reason:"Cancellation reason",patientRequest:"Patient request",providerUnavailable:"Provider unavailable",operationsReason:"Operations",duplicate:"Duplicate",other:"Other",confirmCancel:"Cancel this appointment? This changes operational state and may affect slot inventory.",confirmComplete:"Mark this appointment completed?",confirmNoShow:"Mark this appointment as no-show?",actionSuccess:"Appointment state updated.",actionFailed:"The appointment could not be updated.",operationalRef:"Operational reference",noPatientData:"Patient identity and clinical content are intentionally excluded from this workspace.",requested:"Requested",confirmed:"Confirmed",cancelled:"Cancelled",completed:"Completed",noShowStatus:"No-show",lastUpdated:"Last updated" },
  ar: { live:"عمليات المواعيد المباشرة",refresh:"تحديث",refreshing:"جارٍ التحديث…",unavailable:"عمليات المواعيد غير متاحة مؤقتاً.",date:"التاريخ",modality:"النمط",status:"الحالة",provider:"مقدم الخدمة",allModalities:"كل الأنماط",allStatuses:"كل الحالات",allProviders:"كل مقدمي الخدمة",total:"المواعيد",showing:"المعروض",truncated:"النتائج محدودة بأول 250 موعداً.",noAppointments:"لا توجد مواعيد مطابقة للفلاتر التشغيلية المحددة.",clinic:"عيادة",telemedicine:"طب عن بُعد",homeVisit:"زيارة منزلية",appointment:"الموعد",providerLabel:"مقدم الخدمة",service:"الخدمة",schedule:"الجدول",telehealthStatus:"حالة الطب عن بُعد",operations:"تدخل تشغيلي",selectHint:"اختر موعداً لعرض تفاصيله التشغيلية الخالية من هوية المريض.",cancel:"إلغاء الموعد",complete:"تحديد كمكتمل",noShow:"تحديد كغياب",reason:"سبب الإلغاء",patientRequest:"طلب المريض",providerUnavailable:"مقدم الخدمة غير متاح",operationsReason:"العمليات",duplicate:"مكرر",other:"أخرى",confirmCancel:"إلغاء هذا الموعد؟ سيؤدي ذلك إلى تغيير الحالة التشغيلية وقد يؤثر على سعة الموعد.",confirmComplete:"تحديد هذا الموعد كمكتمل؟",confirmNoShow:"تحديد هذا الموعد كغياب؟",actionSuccess:"تم تحديث حالة الموعد.",actionFailed:"تعذر تحديث الموعد.",operationalRef:"مرجع تشغيلي",noPatientData:"تم استبعاد هوية المريض والمحتوى السريري عمداً من مساحة العمل هذه.",requested:"مطلوب",confirmed:"مؤكد",cancelled:"ملغى",completed:"مكتمل",noShowStatus:"غياب",lastUpdated:"آخر تحديث" },
  fr: { live:"OPÉRATIONS RENDEZ-VOUS EN DIRECT",refresh:"Actualiser",refreshing:"Actualisation…",unavailable:"Les opérations de rendez-vous sont temporairement indisponibles.",date:"Date",modality:"Modalité",status:"Statut",provider:"Prestataire",allModalities:"Toutes modalités",allStatuses:"Tous statuts",allProviders:"Tous prestataires",total:"Rendez-vous",showing:"Affichés",truncated:"Résultat limité aux 250 premiers rendez-vous.",noAppointments:"Aucun rendez-vous ne correspond aux filtres opérationnels.",clinic:"Clinique",telemedicine:"Télémédecine",homeVisit:"Visite à domicile",appointment:"Rendez-vous",providerLabel:"Prestataire",service:"Service",schedule:"Horaire",telehealthStatus:"Statut télémédecine",operations:"Intervention opérationnelle",selectHint:"Sélectionnez un rendez-vous pour consulter ses détails opérationnels sans PHI.",cancel:"Annuler le rendez-vous",complete:"Marquer terminé",noShow:"Marquer absent",reason:"Motif d’annulation",patientRequest:"Demande patient",providerUnavailable:"Prestataire indisponible",operationsReason:"Opérations",duplicate:"Doublon",other:"Autre",confirmCancel:"Annuler ce rendez-vous ? Cela modifie l’état opérationnel et peut affecter l’inventaire du créneau.",confirmComplete:"Marquer ce rendez-vous comme terminé ?",confirmNoShow:"Marquer ce rendez-vous comme absent ?",actionSuccess:"État du rendez-vous mis à jour.",actionFailed:"Le rendez-vous n’a pas pu être mis à jour.",operationalRef:"Référence opérationnelle",noPatientData:"L’identité du patient et le contenu clinique sont volontairement exclus de cet espace.",requested:"Demandé",confirmed:"Confirmé",cancelled:"Annulé",completed:"Terminé",noShowStatus:"Absent",lastUpdated:"Dernière mise à jour" },
  es: { live:"OPERACIONES DE CITAS EN VIVO",refresh:"Actualizar",refreshing:"Actualizando…",unavailable:"Las operaciones de citas no están disponibles temporalmente.",date:"Fecha",modality:"Modalidad",status:"Estado",provider:"Proveedor",allModalities:"Todas las modalidades",allStatuses:"Todos los estados",allProviders:"Todos los proveedores",total:"Citas",showing:"Mostrando",truncated:"Resultado limitado a las primeras 250 citas.",noAppointments:"No hay citas que coincidan con los filtros operativos seleccionados.",clinic:"Clínica",telemedicine:"Telemedicina",homeVisit:"Visita domiciliaria",appointment:"Cita",providerLabel:"Proveedor",service:"Servicio",schedule:"Horario",telehealthStatus:"Estado telemedicina",operations:"Intervención operativa",selectHint:"Selecciona una cita para revisar sus detalles operativos sin PHI.",cancel:"Cancelar cita",complete:"Marcar completada",noShow:"Marcar no-show",reason:"Motivo de cancelación",patientRequest:"Solicitud del paciente",providerUnavailable:"Proveedor no disponible",operationsReason:"Operaciones",duplicate:"Duplicada",other:"Otro",confirmCancel:"¿Cancelar esta cita? Cambiará el estado operativo y puede afectar al inventario del slot.",confirmComplete:"¿Marcar esta cita como completada?",confirmNoShow:"¿Marcar esta cita como no-show?",actionSuccess:"Estado de la cita actualizado.",actionFailed:"No se pudo actualizar la cita.",operationalRef:"Referencia operativa",noPatientData:"La identidad del paciente y el contenido clínico están excluidos intencionadamente de este espacio.",requested:"Solicitada",confirmed:"Confirmada",cancelled:"Cancelada",completed:"Completada",noShowStatus:"No-show",lastUpdated:"Última actualización" },
};

const statuses: AppointmentStatus[] = ["REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];
const modalities: AppointmentModality[] = ["CLINIC", "TELEMEDICINE", "HOME_VISIT"];
const cancellationReasons = ["PATIENT_REQUEST", "PROVIDER_UNAVAILABLE", "OPERATIONS", "DUPLICATE", "OTHER"] as const;

export function AppointmentsOperations() {
  const { locale } = useI18n();
  const c = copy[locale];
  const [date, setDate] = useState(todayInput());
  const [modality, setModality] = useState("");
  const [status, setStatus] = useState("");
  const [providerId, setProviderId] = useState("");
  const [snapshot, setSnapshot] = useState<AppointmentSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<(typeof cancellationReasons)[number]>("OPERATIONS");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const params = new URLSearchParams({
        from: start.toISOString(),
        to: end.toISOString(),
        tzOffsetMinutes: String(-new Date().getTimezoneOffset()),
      });
      if (modality) params.set("modality", modality);
      if (status) params.set("status", status);
      if (providerId) params.set("providerId", providerId);
      const response = await fetch(`/api/admin/operations/appointments?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : c.unavailable);
      const next = payload as AppointmentSnapshot;
      setSnapshot(next);
      setError(null);
      setSelectedId((current) => current && next.items.some((item) => item.appointmentId === current) ? current : next.items[0]?.appointmentId ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c.unavailable);
    } finally {
      setLoading(false);
    }
  }, [c.unavailable, date, modality, providerId, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const selected = useMemo(() => snapshot?.items.find((item) => item.appointmentId === selectedId) ?? null, [selectedId, snapshot]);

  async function runAction(action: "CANCEL" | "COMPLETE" | "NO_SHOW") {
    if (!selected) return;
    const confirmation = action === "CANCEL" ? c.confirmCancel : action === "COMPLETE" ? c.confirmComplete : c.confirmNoShow;
    if (!window.confirm(confirmation)) return;
    setMutating(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/operations/appointments/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentId: selected.appointmentId, action, ...(action === "CANCEL" ? { reasonCode } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : c.actionFailed);
      setMessage(c.actionSuccess);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c.actionFailed);
    } finally {
      setMutating(false);
    }
  }

  const providerOptions = snapshot?.filters.providers ?? [];
  return <>
    <div className={styles.toolbar}>
      <div><span className={styles.live}>{c.live}</span>{snapshot ? <small>{c.lastUpdated}: {formatDateTime(snapshot.generatedAt, locale)}</small> : null}</div>
      <button className={styles.refresh} disabled={loading || mutating} onClick={() => void load()}>{loading ? c.refreshing : c.refresh}</button>
    </div>

    <section className={styles.filters}>
      <label>{c.date}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label>{c.modality}<select value={modality} onChange={(event) => setModality(event.target.value)}><option value="">{c.allModalities}</option>{modalities.map((item) => <option value={item} key={item}>{modalityLabel(item, c)}</option>)}</select></label>
      <label>{c.status}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{c.allStatuses}</option>{statuses.map((item) => <option value={item} key={item}>{statusLabel(item, c)}</option>)}</select></label>
      <label>{c.provider}<select value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">{c.allProviders}</option>{providerOptions.map((item) => <option value={item.id} key={item.id}>{item.displayName} · {item.class}</option>)}</select></label>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}
    {message ? <div className={styles.success}>{message}</div> : null}

    <section className={styles.modalityGrid}>
      {modalities.map((item) => <button className={modality === item ? styles.modalityActive : styles.modalityCard} onClick={() => setModality((current) => current === item ? "" : item)} key={item}><span>{modalityLabel(item, c)}</span><strong>{snapshot?.summary[item].total ?? 0}</strong><small>{summaryText(snapshot?.summary[item], c)}</small></button>)}
    </section>

    <div className={styles.resultMeta}><strong>{c.total}: {snapshot?.total ?? 0}</strong><span>{c.showing}: {snapshot?.items.length ?? 0}</span>{snapshot?.truncated ? <span>{c.truncated}</span> : null}</div>

    <section className={styles.workspace}>
      <article className={styles.listPanel}>
        {!snapshot && loading ? <div className={styles.empty}>{c.refreshing}</div> : null}
        {snapshot?.items.length === 0 ? <div className={styles.empty}>{c.noAppointments}</div> : null}
        {snapshot?.items.map((item) => <button className={item.appointmentId === selectedId ? styles.rowActive : styles.row} key={item.appointmentId} onClick={() => setSelectedId(item.appointmentId)}>
          <time>{formatTime(item.startsAt, locale)}</time><i className={styles.dot}/><div><strong>{item.provider.displayName}</strong><span>{item.service.name} · {modalityLabel(item.modality, c)}</span></div><em data-status={item.status}>{statusLabel(item.status, c)}</em>
        </button>)}
      </article>

      <aside className={styles.detailPanel}>
        {!selected ? <div className={styles.empty}>{c.selectHint}</div> : <>
          <div className={styles.detailHeading}><div><span>{c.appointment}</span><h3>{shortReference(selected.appointmentId)}</h3></div><em data-status={selected.status}>{statusLabel(selected.status, c)}</em></div>
          <div className={styles.privacy}>{c.noPatientData}</div>
          <dl className={styles.detailGrid}>
            <div><dt>{c.operationalRef}</dt><dd>{shortReference(selected.appointmentId)}</dd></div>
            <div><dt>{c.providerLabel}</dt><dd>{selected.provider.displayName}<small>{selected.provider.class}</small></dd></div>
            <div><dt>{c.service}</dt><dd>{selected.service.name}</dd></div>
            <div><dt>{c.schedule}</dt><dd>{formatDateTime(selected.startsAt, locale)}<small>→ {formatTime(selected.endsAt, locale)}</small></dd></div>
            <div><dt>{c.modality}</dt><dd>{modalityLabel(selected.modality, c)}</dd></div>
            <div><dt>{c.telehealthStatus}</dt><dd>{selected.telehealth?.status ?? "—"}</dd></div>
          </dl>
          <div className={styles.actions}>
            <span>{c.operations}</span>
            {selected.operations.canCancel ? <label>{c.reason}<select value={reasonCode} disabled={mutating} onChange={(event) => setReasonCode(event.target.value as (typeof cancellationReasons)[number])}>{cancellationReasons.map((item) => <option value={item} key={item}>{reasonLabel(item, c)}</option>)}</select></label> : null}
            <div className={styles.actionButtons}>
              <button disabled={mutating || !selected.operations.canCancel} onClick={() => void runAction("CANCEL")}>{c.cancel}</button>
              <button disabled={mutating || !selected.operations.canComplete} onClick={() => void runAction("COMPLETE")}>{c.complete}</button>
              <button disabled={mutating || !selected.operations.canNoShow} onClick={() => void runAction("NO_SHOW")}>{c.noShow}</button>
            </div>
          </div>
        </>}
      </aside>
    </section>
  </>;
}

function todayInput() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
function shortReference(id: string) { return `CP-AP-${id.slice(0, 8).toUpperCase()}`; }
function formatTime(value: string, locale: Locale) { return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatDateTime(value: string, locale: Locale) { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function modalityLabel(value: AppointmentModality, c: Copy) { return value === "CLINIC" ? c.clinic : value === "TELEMEDICINE" ? c.telemedicine : c.homeVisit; }
function statusLabel(value: AppointmentStatus, c: Copy) { return value === "REQUESTED" ? c.requested : value === "CONFIRMED" ? c.confirmed : value === "CANCELLED" ? c.cancelled : value === "COMPLETED" ? c.completed : c.noShowStatus; }
function reasonLabel(value: (typeof cancellationReasons)[number], c: Copy) { return value === "PATIENT_REQUEST" ? c.patientRequest : value === "PROVIDER_UNAVAILABLE" ? c.providerUnavailable : value === "OPERATIONS" ? c.operationsReason : value === "DUPLICATE" ? c.duplicate : c.other; }
function summaryText(summary: Summary | undefined, c: Copy) {
  if (!summary) return "—";
  const parts = [summary.statuses.CONFIRMED ? `${summary.statuses.CONFIRMED} ${c.confirmed}` : "", summary.statuses.COMPLETED ? `${summary.statuses.COMPLETED} ${c.completed}` : "", summary.statuses.NO_SHOW ? `${summary.statuses.NO_SHOW} ${c.noShowStatus}` : ""].filter(Boolean);
  return parts.join(" · ") || "—";
}
