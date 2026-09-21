"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./PatientAdministration.module.css";

type PatientRow = {
  patientId: string;
  patientRef: string;
  displayName: string;
  accountStatus: string;
  verification: { mfaEnabled: boolean; accountActive: boolean };
  operationalFlags: string[];
  hasActiveConsent: boolean;
  appointmentCount: number;
  createdAt: string;
  updatedAt: string;
};

type DirectoryResponse = {
  privacy: {
    phiMinimized: boolean;
    clinicalHealthProfileExcluded: boolean;
    diagnosesExcluded: boolean;
    medicationsExcluded: boolean;
    rawEmailExcluded: boolean;
    rawPhoneExcluded: boolean;
  };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  items: PatientRow[];
};

type Copy = {
  privacyTitle: string;
  privacyText: string;
  search: string;
  searchPlaceholder: string;
  status: string;
  all: string;
  apply: string;
  loading: string;
  loadError: string;
  patient: string;
  account: string;
  verification: string;
  flags: string;
  activity: string;
  updated: string;
  actions: string;
  mfaOn: string;
  mfaOff: string;
  activeConsent: string;
  noConsent: string;
  appointments: string;
  noFlags: string;
  open: string;
  empty: string;
  showing: string;
  previous: string;
  next: string;
  page: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    privacyTitle: "Administrative patient view",
    privacyText: "This directory is PHI-minimized. Diagnoses, medications, health-profile content, questionnaire answers and observations are not returned here.",
    search: "Search",
    searchPlaceholder: "Name or account email",
    status: "Account status",
    all: "All",
    apply: "Apply",
    loading: "Loading patient directory…",
    loadError: "The patient directory could not be loaded.",
    patient: "Patient",
    account: "Account",
    verification: "Verification",
    flags: "Operational flags",
    activity: "Activity",
    updated: "Updated",
    actions: "Actions",
    mfaOn: "MFA enabled",
    mfaOff: "MFA not enabled",
    activeConsent: "Active consent",
    noConsent: "No active consent",
    appointments: "appointments",
    noFlags: "No operational flags",
    open: "Open administrative record",
    empty: "No patients match the current filters.",
    showing: "patients",
    previous: "Previous",
    next: "Next",
    page: "Page",
  },
  ar: {
    privacyTitle: "عرض إداري للمريض",
    privacyText: "هذا الدليل يقلل بيانات PHI إلى الحد الأدنى. لا يتم إرجاع التشخيصات أو الأدوية أو ملف الصحة أو إجابات الاستبيانات أو القياسات السريرية هنا.",
    search: "بحث",
    searchPlaceholder: "الاسم أو بريد الحساب",
    status: "حالة الحساب",
    all: "الكل",
    apply: "تطبيق",
    loading: "جارٍ تحميل دليل المرضى…",
    loadError: "تعذر تحميل دليل المرضى.",
    patient: "المريض",
    account: "الحساب",
    verification: "التحقق",
    flags: "علامات تشغيلية",
    activity: "النشاط",
    updated: "آخر تحديث",
    actions: "الإجراءات",
    mfaOn: "MFA مفعّل",
    mfaOff: "MFA غير مفعّل",
    activeConsent: "موافقة نشطة",
    noConsent: "لا توجد موافقة نشطة",
    appointments: "مواعيد",
    noFlags: "لا توجد علامات تشغيلية",
    open: "فتح السجل الإداري",
    empty: "لا يوجد مرضى يطابقون عوامل التصفية الحالية.",
    showing: "مرضى",
    previous: "السابق",
    next: "التالي",
    page: "صفحة",
  },
  fr: {
    privacyTitle: "Vue administrative patient",
    privacyText: "Cet annuaire minimise les PHI. Les diagnostics, médicaments, données du profil de santé, réponses aux questionnaires et observations cliniques ne sont pas renvoyés ici.",
    search: "Rechercher",
    searchPlaceholder: "Nom ou e-mail du compte",
    status: "Statut du compte",
    all: "Tous",
    apply: "Appliquer",
    loading: "Chargement de l’annuaire patients…",
    loadError: "Impossible de charger l’annuaire patients.",
    patient: "Patient",
    account: "Compte",
    verification: "Vérification",
    flags: "Indicateurs opérationnels",
    activity: "Activité",
    updated: "Mis à jour",
    actions: "Actions",
    mfaOn: "MFA activé",
    mfaOff: "MFA non activé",
    activeConsent: "Consentement actif",
    noConsent: "Aucun consentement actif",
    appointments: "rendez-vous",
    noFlags: "Aucun indicateur opérationnel",
    open: "Ouvrir la fiche administrative",
    empty: "Aucun patient ne correspond aux filtres actuels.",
    showing: "patients",
    previous: "Précédent",
    next: "Suivant",
    page: "Page",
  },
  es: {
    privacyTitle: "Vista administrativa del paciente",
    privacyText: "Este directorio minimiza PHI. Aquí no se devuelven diagnósticos, medicación, contenido del perfil de salud, respuestas de cuestionarios ni observaciones clínicas.",
    search: "Buscar",
    searchPlaceholder: "Nombre o correo de la cuenta",
    status: "Estado de cuenta",
    all: "Todos",
    apply: "Aplicar",
    loading: "Cargando directorio de pacientes…",
    loadError: "No se pudo cargar el directorio de pacientes.",
    patient: "Paciente",
    account: "Cuenta",
    verification: "Verificación",
    flags: "Indicadores operativos",
    activity: "Actividad",
    updated: "Actualizado",
    actions: "Acciones",
    mfaOn: "MFA activado",
    mfaOff: "MFA no activado",
    activeConsent: "Consentimiento activo",
    noConsent: "Sin consentimiento activo",
    appointments: "citas",
    noFlags: "Sin indicadores operativos",
    open: "Abrir ficha administrativa",
    empty: "Ningún paciente coincide con los filtros actuales.",
    showing: "pacientes",
    previous: "Anterior",
    next: "Siguiente",
    page: "Página",
  },
};

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload && typeof (payload as { message?: unknown }).message === "string") {
    return (payload as { message: string }).message;
  }
  return fallback;
}

export function PatientAdminDirectory() {
  const { locale } = useI18n();
  const text = copy[locale];
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (search) params.set("q", search);
    if (status !== "ALL") params.set("status", status);
    return params.toString();
  }, [page, search, status]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/admin/patients?${query}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as unknown;
        if (response.status === 401) {
          window.location.assign("/login");
          return null;
        }
        if (!response.ok) throw new Error(errorMessage(payload, text.loadError));
        return payload as DirectoryResponse;
      })
      .then((payload) => {
        if (payload) setData(payload);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : text.loadError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, text.loadError]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(draftSearch.trim());
  }

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  return <>
    <div className={styles.privacy}>
      <strong>{text.privacyTitle}</strong>
      {text.privacyText}
    </div>

    <div className={styles.toolbar}>
      <form className={styles.searchGroup} onSubmit={submit}>
        <label className={styles.field}>
          <span>{text.search}</span>
          <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} maxLength={120} placeholder={text.searchPlaceholder} />
        </label>
        <label className={styles.field}>
          <span>{text.status}</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="ALL">{text.all}</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </label>
        <button className={styles.button} type="submit" disabled={loading}>{text.apply}</button>
      </form>
      <div className={styles.summary}>
        <strong>{data?.pagination.total ?? 0}</strong> {text.showing}
      </div>
    </div>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {loading && !data ? <div className={styles.loading}>{text.loading}</div> : null}

    {data ? <>
      <div className={styles.tableWrap} aria-busy={loading}>
        <table>
          <thead><tr>
            <th>{text.patient}</th>
            <th>{text.account}</th>
            <th>{text.verification}</th>
            <th>{text.flags}</th>
            <th>{text.activity}</th>
            <th>{text.updated}</th>
            <th>{text.actions}</th>
          </tr></thead>
          <tbody>
            {data.items.map((patient) => <tr key={patient.patientId}>
              <td><strong>{patient.displayName}</strong><span className={styles.muted}>{patient.patientRef}</span></td>
              <td><span className={styles.status} data-status={patient.accountStatus}>{patient.accountStatus}</span></td>
              <td>
                <span className={patient.verification.mfaEnabled ? styles.ok : styles.flag}>{patient.verification.mfaEnabled ? text.mfaOn : text.mfaOff}</span>
                <span className={styles.muted}>{patient.hasActiveConsent ? text.activeConsent : text.noConsent}</span>
              </td>
              <td>{patient.operationalFlags.length ? <div className={styles.flagList}>{patient.operationalFlags.map((flag) => <span className={styles.flag} key={flag}>{flag}</span>)}</div> : <span className={styles.muted}>{text.noFlags}</span>}</td>
              <td><strong>{patient.appointmentCount}</strong><span className={styles.muted}>{text.appointments}</span></td>
              <td>{formatter.format(new Date(patient.updatedAt))}</td>
              <td><Link className={styles.linkButton} href={`/patients/${encodeURIComponent(patient.patientId)}`}>{text.open}</Link></td>
            </tr>)}
            {data.items.length === 0 ? <tr><td colSpan={7}><div className={styles.empty}>{text.empty}</div></td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className={styles.pager}>
        <span>{text.page} {data.pagination.page} / {data.pagination.totalPages}</span>
        <div>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || data.pagination.page <= 1}>{text.previous}</button>
          <button type="button" onClick={() => setPage((value) => Math.min(data.pagination.totalPages, value + 1))} disabled={loading || data.pagination.page >= data.pagination.totalPages}>{text.next}</button>
        </div>
      </div>
    </> : null}
  </>;
}
