"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./PatientAdministration.module.css";

type PatientDetail = {
  privacy: {
    administrativeViewOnly: boolean;
    clinicalHealthProfileExcluded: boolean;
    diagnosesExcluded: boolean;
    medicationsExcluded: boolean;
    questionnaireAnswersExcluded: boolean;
    observationsExcluded: boolean;
  };
  patient: {
    patientId: string;
    patientRef: string;
    firstName: string;
    lastName: string;
    displayName: string;
    contact: { email: string; phone: string | null };
    account: {
      status: string;
      mfaEnabled: boolean;
      lockedUntil: string | null;
      failedLoginCount: number;
      operationalFlags: string[];
      createdAt: string;
      updatedAt: string;
    };
    profileCreatedAt: string;
    profileUpdatedAt: string;
  };
  dependents: Array<{
    relationRef: string;
    perspective: string;
    relatedPatientRef: string | null;
    guardianAccountRef: string;
    relationshipType: string;
    status: string;
    validFrom: string;
    validUntil: string | null;
    verifiedAt: string | null;
    revokedAt: string | null;
    updatedAt: string;
  }>;
  consents: Array<{
    consentRef: string;
    providerRef: string | null;
    scope: string;
    purpose: string | null;
    version: string;
    state: string;
    grantedAt: string;
    revokedAt: string | null;
    expiresAt: string | null;
  }>;
  insurance: Array<{
    coverageRef: string;
    payerCode: string;
    payerName: string;
    displayLabel: string | null;
    policyReference: string;
    status: string;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    updatedAt: string;
  }>;
  incidents: Array<{
    incidentRef: string;
    action: string;
    result: string;
    occurredAt: string;
  }>;
};

type Copy = {
  back: string;
  privacyTitle: string;
  privacyText: string;
  loading: string;
  loadError: string;
  account: string;
  contact: string;
  patientRef: string;
  status: string;
  mfa: string;
  enabled: string;
  notEnabled: string;
  lockedUntil: string;
  failedLogins: string;
  email: string;
  phone: string;
  updated: string;
  operationalFlags: string;
  none: string;
  dependents: string;
  dependentsMeta: string;
  perspective: string;
  relationship: string;
  validUntil: string;
  consents: string;
  consentsMeta: string;
  purpose: string;
  provider: string;
  expires: string;
  insurance: string;
  insuranceMeta: string;
  policy: string;
  effective: string;
  incidents: string;
  incidentsMeta: string;
  noRecords: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    back: "← Patient directory",
    privacyTitle: "Administrative boundary enforced",
    privacyText: "This workspace intentionally excludes health profile content, diagnoses, medications, questionnaire answers and clinical observations. Clinical data must be accessed only through an authorized clinical workflow.",
    loading: "Loading administrative patient record…",
    loadError: "The administrative patient record could not be loaded.",
    account: "Account & operational status",
    contact: "Administrative contact",
    patientRef: "Patient reference",
    status: "Status",
    mfa: "MFA",
    enabled: "Enabled",
    notEnabled: "Not enabled",
    lockedUntil: "Locked until",
    failedLogins: "Failed login count",
    email: "Email",
    phone: "Phone",
    updated: "Updated",
    operationalFlags: "Operational flags",
    none: "None",
    dependents: "Dependents & legal relationships",
    dependentsMeta: "Administrative relationship status only; no clinical information is exposed.",
    perspective: "Perspective",
    relationship: "Relationship",
    validUntil: "Valid until",
    consents: "Consent administration",
    consentsMeta: "Consent scope and lifecycle are visible without returning the underlying clinical data.",
    purpose: "Purpose",
    provider: "Provider reference",
    expires: "Expires",
    insurance: "Insurance coverage",
    insuranceMeta: "Policy identifiers are masked in the administrative view.",
    policy: "Policy",
    effective: "Effective",
    incidents: "Operational incidents",
    incidentsMeta: "Security and account incidents only.",
    noRecords: "No records.",
  },
  ar: {
    back: "← دليل المرضى",
    privacyTitle: "الحد الإداري مفعّل",
    privacyText: "تستبعد هذه المساحة عمداً ملف الصحة والتشخيصات والأدوية وإجابات الاستبيانات والملاحظات السريرية. يجب الوصول إلى البيانات السريرية فقط عبر مسار سريري مخوّل.",
    loading: "جارٍ تحميل السجل الإداري للمريض…",
    loadError: "تعذر تحميل السجل الإداري للمريض.",
    account: "الحساب والحالة التشغيلية",
    contact: "بيانات الاتصال الإدارية",
    patientRef: "مرجع المريض",
    status: "الحالة",
    mfa: "MFA",
    enabled: "مفعّل",
    notEnabled: "غير مفعّل",
    lockedUntil: "مقفل حتى",
    failedLogins: "عدد محاولات الدخول الفاشلة",
    email: "البريد الإلكتروني",
    phone: "الهاتف",
    updated: "آخر تحديث",
    operationalFlags: "علامات تشغيلية",
    none: "لا يوجد",
    dependents: "المعالون والعلاقات القانونية",
    dependentsMeta: "تظهر حالة العلاقة الإدارية فقط دون معلومات سريرية.",
    perspective: "الصفة",
    relationship: "العلاقة",
    validUntil: "صالح حتى",
    consents: "إدارة الموافقات",
    consentsMeta: "يظهر نطاق الموافقة ودورة حياتها دون إرجاع البيانات السريرية نفسها.",
    purpose: "الغرض",
    provider: "مرجع مقدم الخدمة",
    expires: "ينتهي",
    insurance: "التغطية التأمينية",
    insuranceMeta: "يتم إخفاء معرفات البوليصة في العرض الإداري.",
    policy: "البوليصة",
    effective: "السريان",
    incidents: "الحوادث التشغيلية",
    incidentsMeta: "حوادث الحساب والأمان فقط.",
    noRecords: "لا توجد سجلات.",
  },
  fr: {
    back: "← Annuaire patients",
    privacyTitle: "Frontière administrative appliquée",
    privacyText: "Cet espace exclut volontairement le profil de santé, les diagnostics, médicaments, réponses aux questionnaires et observations cliniques. Les données cliniques ne doivent être consultées que dans un flux clinique autorisé.",
    loading: "Chargement de la fiche administrative…",
    loadError: "Impossible de charger la fiche administrative du patient.",
    account: "Compte et statut opérationnel",
    contact: "Contact administratif",
    patientRef: "Référence patient",
    status: "Statut",
    mfa: "MFA",
    enabled: "Activé",
    notEnabled: "Non activé",
    lockedUntil: "Verrouillé jusqu’au",
    failedLogins: "Échecs de connexion",
    email: "E-mail",
    phone: "Téléphone",
    updated: "Mis à jour",
    operationalFlags: "Indicateurs opérationnels",
    none: "Aucun",
    dependents: "Personnes à charge et liens juridiques",
    dependentsMeta: "Seul le statut administratif du lien est visible; aucune donnée clinique.",
    perspective: "Perspective",
    relationship: "Relation",
    validUntil: "Valide jusqu’au",
    consents: "Administration des consentements",
    consentsMeta: "Le périmètre et le cycle de vie du consentement sont visibles sans exposer les données cliniques.",
    purpose: "Finalité",
    provider: "Référence prestataire",
    expires: "Expire",
    insurance: "Couverture d’assurance",
    insuranceMeta: "Les identifiants de police sont masqués dans la vue administrative.",
    policy: "Police",
    effective: "Période",
    incidents: "Incidents opérationnels",
    incidentsMeta: "Incidents de sécurité et de compte uniquement.",
    noRecords: "Aucun enregistrement.",
  },
  es: {
    back: "← Directorio de pacientes",
    privacyTitle: "Límite administrativo aplicado",
    privacyText: "Este espacio excluye deliberadamente el perfil de salud, diagnósticos, medicación, respuestas de cuestionarios y observaciones clínicas. Los datos clínicos sólo deben consultarse mediante un flujo clínico autorizado.",
    loading: "Cargando ficha administrativa del paciente…",
    loadError: "No se pudo cargar la ficha administrativa del paciente.",
    account: "Cuenta y estado operativo",
    contact: "Contacto administrativo",
    patientRef: "Referencia del paciente",
    status: "Estado",
    mfa: "MFA",
    enabled: "Activado",
    notEnabled: "No activado",
    lockedUntil: "Bloqueada hasta",
    failedLogins: "Intentos fallidos",
    email: "Correo",
    phone: "Teléfono",
    updated: "Actualizado",
    operationalFlags: "Indicadores operativos",
    none: "Ninguno",
    dependents: "Dependientes y relaciones legales",
    dependentsMeta: "Sólo se muestra el estado administrativo de la relación; no se expone información clínica.",
    perspective: "Perspectiva",
    relationship: "Relación",
    validUntil: "Válido hasta",
    consents: "Administración de consentimientos",
    consentsMeta: "Se muestran alcance y ciclo de vida del consentimiento sin devolver los datos clínicos subyacentes.",
    purpose: "Finalidad",
    provider: "Referencia del proveedor",
    expires: "Vence",
    insurance: "Cobertura de seguro",
    insuranceMeta: "Los identificadores de póliza se enmascaran en la vista administrativa.",
    policy: "Póliza",
    effective: "Vigencia",
    incidents: "Incidencias operativas",
    incidentsMeta: "Sólo incidencias de seguridad y cuenta.",
    noRecords: "Sin registros.",
  },
};

function message(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload && typeof (payload as { message?: unknown }).message === "string") {
    return (payload as { message: string }).message;
  }
  return fallback;
}

export function PatientAdminDetail({ patientId }: Readonly<{ patientId: string }>) {
  const { locale } = useI18n();
  const text = copy[locale];
  const [data, setData] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/admin/patients/${encodeURIComponent(patientId)}`, {
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
        if (!response.ok) throw new Error(message(payload, text.loadError));
        return payload as PatientDetail;
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
  }, [patientId, text.loadError]);

  if (loading && !data) return <div className={styles.loading}>{text.loading}</div>;
  if (error && !data) return <div className={styles.error} role="alert">{error}</div>;
  if (!data) return null;

  const patient = data.patient;
  return <>
    <div className={styles.detailHeader}>
      <div>
        <Link className={styles.back} href="/patients">{text.back}</Link>
        <h2>{patient.displayName}</h2>
        <p>{patient.patientRef}</p>
      </div>
      <span className={styles.status} data-status={patient.account.status}>{patient.account.status}</span>
    </div>

    <div className={styles.privacy}>
      <strong>{text.privacyTitle}</strong>
      {text.privacyText}
    </div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}

    <div className={styles.grid}>
      <section className={styles.card}>
        <h3>{text.account}</h3>
        <dl className={styles.kv}>
          <dt>{text.patientRef}</dt><dd>{patient.patientRef}</dd>
          <dt>{text.status}</dt><dd>{patient.account.status}</dd>
          <dt>{text.mfa}</dt><dd>{patient.account.mfaEnabled ? text.enabled : text.notEnabled}</dd>
          <dt>{text.lockedUntil}</dt><dd>{patient.account.lockedUntil ? formatter.format(new Date(patient.account.lockedUntil)) : text.none}</dd>
          <dt>{text.failedLogins}</dt><dd>{patient.account.failedLoginCount}</dd>
          <dt>{text.updated}</dt><dd>{formatter.format(new Date(patient.account.updatedAt))}</dd>
          <dt>{text.operationalFlags}</dt><dd>{patient.account.operationalFlags.length ? <div className={styles.flagList}>{patient.account.operationalFlags.map((flag) => <span className={styles.flag} key={flag}>{flag}</span>)}</div> : text.none}</dd>
        </dl>
      </section>

      <section className={styles.card}>
        <h3>{text.contact}</h3>
        <dl className={styles.kv}>
          <dt>{text.email}</dt><dd>{patient.contact.email}</dd>
          <dt>{text.phone}</dt><dd>{patient.contact.phone || text.none}</dd>
          <dt>{text.updated}</dt><dd>{formatter.format(new Date(patient.profileUpdatedAt))}</dd>
        </dl>
      </section>

      <section className={`${styles.card} ${styles.cardWide}`}>
        <h3>{text.dependents}</h3>
        <div className={styles.sectionMeta}>{text.dependentsMeta}</div>
        <div className={styles.list}>
          {data.dependents.map((relation) => <div className={styles.listItem} key={relation.relationRef}>
            <div className={styles.listItemHeader}><strong>{relation.relationshipType}</strong><span className={styles.status} data-status={relation.status}>{relation.status}</span></div>
            <p>{text.perspective}: {relation.perspective} · {text.relationship}: {relation.relationRef} · {text.validUntil}: {relation.validUntil || text.none}</p>
          </div>)}
          {data.dependents.length === 0 ? <div className={styles.empty}>{text.noRecords}</div> : null}
        </div>
      </section>

      <section className={styles.card}>
        <h3>{text.consents}</h3>
        <div className={styles.sectionMeta}>{text.consentsMeta}</div>
        <div className={styles.list}>
          {data.consents.map((consent) => <div className={styles.listItem} key={consent.consentRef}>
            <div className={styles.listItemHeader}><strong>{consent.scope}</strong><span className={styles.status} data-status={consent.state}>{consent.state}</span></div>
            <p>{text.purpose}: {consent.purpose || text.none} · {text.provider}: {consent.providerRef || text.none} · {text.expires}: {consent.expiresAt || text.none}</p>
          </div>)}
          {data.consents.length === 0 ? <div className={styles.empty}>{text.noRecords}</div> : null}
        </div>
      </section>

      <section className={styles.card}>
        <h3>{text.insurance}</h3>
        <div className={styles.sectionMeta}>{text.insuranceMeta}</div>
        <div className={styles.list}>
          {data.insurance.map((coverage) => <div className={styles.listItem} key={coverage.coverageRef}>
            <div className={styles.listItemHeader}><strong>{coverage.payerName}</strong><span className={styles.status} data-status={coverage.status}>{coverage.status}</span></div>
            <p>{text.policy}: {coverage.policyReference} · {text.effective}: {coverage.effectiveFrom || text.none} — {coverage.effectiveUntil || text.none}</p>
          </div>)}
          {data.insurance.length === 0 ? <div className={styles.empty}>{text.noRecords}</div> : null}
        </div>
      </section>

      <section className={`${styles.card} ${styles.cardWide}`}>
        <h3>{text.incidents}</h3>
        <div className={styles.sectionMeta}>{text.incidentsMeta}</div>
        <div className={styles.list}>
          {data.incidents.map((incident) => <div className={styles.listItem} key={incident.incidentRef}>
            <div className={styles.listItemHeader}><strong>{incident.action}</strong><span className={styles.status} data-status={incident.result}>{incident.result}</span></div>
            <p>{incident.incidentRef} · {formatter.format(new Date(incident.occurredAt))}</p>
          </div>)}
          {data.incidents.length === 0 ? <div className={styles.empty}>{text.noRecords}</div> : null}
        </div>
      </section>
    </div>
  </>;
}
