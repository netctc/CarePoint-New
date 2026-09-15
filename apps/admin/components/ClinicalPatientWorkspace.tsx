"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n";
import styles from "./ClinicalWorkspace.module.css";

type RosterPatient = { id: string; firstName: string; lastName: string; lastInteractionAt: string; relationshipSource: string };
type RosterResponse = { viewer: { providerId: string; displayName: string; class: string }; items: RosterPatient[] };
type Section = { state: "AVAILABLE" | "RESTRICTED"; accessBasis?: string; items: unknown[] };
type Encounter = { appointment?: Record<string, unknown>; accessBasis?: string; latestRecord?: { revision?: number; createdAt?: string; data?: Record<string, unknown> } | null; finalized?: boolean };
type Workspace = {
  patient: { id: string; firstName: string; lastName: string };
  viewer: { providerId: string; displayName: string; class: string };
  accessBasis: string;
  timeline: Encounter[];
  orders: Section;
  documents: Section;
  diagnosticReports: Section;
  riskAlerts: Array<{ source: string; label: string; flag: string; orderId: string }>;
  security: { encryptedClinicalRecords: boolean; auditedAccess: boolean; serverSideAccessBasisEnforced: boolean; automatedClinicalRiskInference: boolean };
};

const copy = {
  en: { eyebrow:"AUTHORIZED CLINICAL WORKSPACE", title:"Patient Clinical Workspace", subtitle:"Longitudinal timeline and clinical snapshot", patients:"Patients", select:"Select an authorized patient", emptyRoster:"No patients are available from your own treatment or authorship context.", loading:"Loading authorized clinical context…", accessDenied:"Access denied for this patient or clinical domain.", retry:"Retry", signOut:"Sign out", patientIdentity:"Patient identity", viewer:"Viewing provider", access:"Access basis", security:"Security context", encrypted:"Encrypted clinical records", audited:"Audited access", enforced:"Server-side access basis", noAi:"No autonomous clinical risk inference", snapshot:"Clinical snapshot", diagnoses:"Diagnoses", medications:"Medications", vitals:"Latest vitals", alerts:"Clinical / risk flags", noAlerts:"No system-generated clinical flags are present.", timeline:"Longitudinal timeline", orders:"Orders & laboratory", documents:"Clinical documents", reports:"Diagnostic reports", restricted:"Restricted by domain-specific authorization", noData:"No data available", finalized:"Finalized", active:"Open encounter", latest:"Latest record", assessment:"Assessment", plan:"Plan", complaint:"Chief complaint", provider:"Provider", service:"Service", status:"Status", date:"Date", type:"Type", labResult:"Lab result", document:"Document", report:"Report", release:"Release state" },
  ar: { eyebrow:"مساحة سريرية مصرح بها", title:"مساحة المريض السريرية", subtitle:"خط زمني طولي وملخص سريري", patients:"المرضى", select:"اختر مريضاً مصرحاً به", emptyRoster:"لا يوجد مرضى متاحون من سياق العلاج أو التأليف الخاص بك.", loading:"جارٍ تحميل السياق السريري المصرح به…", accessDenied:"تم رفض الوصول إلى هذا المريض أو النطاق السريري.", retry:"إعادة المحاولة", signOut:"تسجيل الخروج", patientIdentity:"هوية المريض", viewer:"مقدم الرعاية المشاهد", access:"أساس الوصول", security:"سياق الأمان", encrypted:"سجلات سريرية مشفرة", audited:"وصول مدقق", enforced:"أساس وصول مفروض على الخادم", noAi:"لا يوجد استدلال آلي مستقل للمخاطر السريرية", snapshot:"الملخص السريري", diagnoses:"التشخيصات", medications:"الأدوية", vitals:"أحدث العلامات الحيوية", alerts:"الإشارات / المخاطر السريرية", noAlerts:"لا توجد إشارات سريرية منشأة من النظام.", timeline:"الخط الزمني السريري", orders:"الطلبات والمختبر", documents:"المستندات السريرية", reports:"التقارير التشخيصية", restricted:"مقيّد حسب صلاحية النطاق", noData:"لا توجد بيانات", finalized:"مغلق نهائياً", active:"مواجهة مفتوحة", latest:"أحدث سجل", assessment:"التقييم", plan:"الخطة", complaint:"الشكوى الرئيسية", provider:"مقدم الخدمة", service:"الخدمة", status:"الحالة", date:"التاريخ", type:"النوع", labResult:"نتيجة المختبر", document:"مستند", report:"تقرير", release:"حالة الإتاحة" },
  fr: { eyebrow:"ESPACE CLINIQUE AUTORISÉ", title:"Espace clinique patient", subtitle:"Chronologie longitudinale et synthèse clinique", patients:"Patients", select:"Sélectionner un patient autorisé", emptyRoster:"Aucun patient n’est disponible depuis votre propre contexte de traitement ou d’auteur.", loading:"Chargement du contexte clinique autorisé…", accessDenied:"Accès refusé pour ce patient ou ce domaine clinique.", retry:"Réessayer", signOut:"Déconnexion", patientIdentity:"Identité patient", viewer:"Prestataire consultant", access:"Base d’accès", security:"Contexte de sécurité", encrypted:"Dossiers cliniques chiffrés", audited:"Accès audité", enforced:"Base d’accès imposée côté serveur", noAi:"Aucune inférence autonome du risque clinique", snapshot:"Synthèse clinique", diagnoses:"Diagnostics", medications:"Médicaments", vitals:"Dernières constantes", alerts:"Alertes / signaux cliniques", noAlerts:"Aucun signal clinique généré par le système.", timeline:"Chronologie longitudinale", orders:"Prescriptions et laboratoire", documents:"Documents cliniques", reports:"Rapports diagnostiques", restricted:"Restreint par l’autorisation du domaine", noData:"Aucune donnée", finalized:"Finalisé", active:"Consultation ouverte", latest:"Dernier dossier", assessment:"Évaluation", plan:"Plan", complaint:"Motif principal", provider:"Prestataire", service:"Service", status:"Statut", date:"Date", type:"Type", labResult:"Résultat de laboratoire", document:"Document", report:"Rapport", release:"État de diffusion" },
  es: { eyebrow:"ESPACIO CLÍNICO AUTORIZADO", title:"Patient Clinical Workspace", subtitle:"Cronología longitudinal y resumen clínico", patients:"Pacientes", select:"Selecciona un paciente autorizado", emptyRoster:"No hay pacientes disponibles desde tu propio contexto de tratamiento o autoría.", loading:"Cargando contexto clínico autorizado…", accessDenied:"Acceso denegado para este paciente o dominio clínico.", retry:"Reintentar", signOut:"Cerrar sesión", patientIdentity:"Identidad del paciente", viewer:"Proveedor que consulta", access:"Base de acceso", security:"Contexto de seguridad", encrypted:"Registros clínicos cifrados", audited:"Acceso auditado", enforced:"Base de acceso aplicada en servidor", noAi:"Sin inferencia clínica autónoma de riesgo", snapshot:"Resumen clínico", diagnoses:"Diagnósticos", medications:"Medicaciones", vitals:"Últimas constantes", alerts:"Alertas / señales clínicas", noAlerts:"No hay señales clínicas generadas por el sistema.", timeline:"Cronología longitudinal", orders:"Órdenes y laboratorio", documents:"Documentos clínicos", reports:"Informes diagnósticos", restricted:"Restringido por autorización específica del dominio", noData:"Sin datos disponibles", finalized:"Finalizado", active:"Encuentro abierto", latest:"Último registro", assessment:"Evaluación", plan:"Plan", complaint:"Motivo principal", provider:"Proveedor", service:"Servicio", status:"Estado", date:"Fecha", type:"Tipo", labResult:"Resultado de laboratorio", document:"Documento", report:"Informe", release:"Estado de liberación" },
} as const;

type ClinicalCopy = { [K in keyof typeof copy.en]: string };

export function ClinicalPatientWorkspace() {
  const { locale, direction } = useI18n();
  const t: ClinicalCopy = copy[locale];
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadRoster() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/clinical/roster", { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/clinical/login"); return; }
      const payload = await response.json().catch(() => ({})) as RosterResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || t.accessDenied);
      setRoster(payload);
    } catch (value) { setError(value instanceof Error ? value.message : t.accessDenied); }
    finally { setBusy(false); }
  }

  useEffect(() => { void loadRoster(); }, []);

  async function openPatient(patientId: string) {
    setSelected(patientId); setWorkspace(null); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/clinical/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId }),
        cache: "no-store",
      });
      if (response.status === 401) { window.location.replace("/clinical/login"); return; }
      const payload = await response.json().catch(() => ({})) as Workspace & { message?: string };
      if (!response.ok) throw new Error(payload.message || t.accessDenied);
      setWorkspace(payload);
    } catch (value) { setError(value instanceof Error ? value.message : t.accessDenied); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await fetch("/api/clinical/auth/logout", { method: "POST", cache: "no-store" }).catch(() => undefined);
    window.location.replace("/clinical/login");
  }

  const latestData = useMemo(() => workspace?.timeline.find((item)=>item.latestRecord?.data)?.latestRecord?.data ?? {}, [workspace]);
  const diagnoses = objectList(latestData.diagnoses);
  const medications = objectList(latestData.medications);
  const vitals = objectValue(latestData.vitals);

  return <main className={styles.workspaceShell} dir={direction}>
    <header className={styles.clinicalHeader}>
      <div><p className={styles.eyebrow}>{t.eyebrow}</p><h1>{t.title}</h1><p>{t.subtitle}</p></div>
      <div className={styles.headerActions}><LanguageSwitcher /><button className={styles.secondaryButton} onClick={signOut}>{t.signOut}</button></div>
    </header>

    <div className={styles.workspaceGrid}>
      <aside className={styles.rosterPanel} aria-label={t.patients}>
        <div className={styles.sectionHeading}><h2>{t.patients}</h2><button className={styles.textButton} onClick={()=>void loadRoster()}>{t.retry}</button></div>
        {roster?.viewer ? <div className={styles.viewerCard}><strong>{roster.viewer.displayName}</strong><span>{roster.viewer.class}</span></div> : null}
        {busy && !roster ? <p className={styles.stateText}>{t.loading}</p> : null}
        {roster && roster.items.length === 0 ? <p className={styles.stateText}>{t.emptyRoster}</p> : null}
        <div className={styles.rosterList}>{roster?.items.map((patient)=><button key={patient.id} className={selected===patient.id ? styles.patientButtonActive : styles.patientButton} aria-pressed={selected===patient.id} onClick={()=>void openPatient(patient.id)}><strong>{patient.firstName} {patient.lastName}</strong><span>{formatDate(patient.lastInteractionAt, locale)} · {patient.relationshipSource.replaceAll("_", " ")}</span></button>)}</div>
      </aside>

      <section className={styles.clinicalMain} aria-live="polite">
        {error ? <div className={styles.errorBox} role="alert"><strong>{t.accessDenied}</strong><span>{error}</span></div> : null}
        {busy && selected ? <div className={styles.stateCard}>{t.loading}</div> : null}
        {!selected && !busy ? <div className={styles.stateCard}>{t.select}</div> : null}
        {workspace && !busy ? <>
          <section className={styles.identityCard} aria-labelledby="patient-identity-title">
            <div><p className={styles.cardLabel} id="patient-identity-title">{t.patientIdentity}</p><h2>{workspace.patient.firstName} {workspace.patient.lastName}</h2><code>{workspace.patient.id}</code></div>
            <div className={styles.contextGrid}><Context label={t.viewer} value={`${workspace.viewer.displayName} · ${workspace.viewer.class}`} /><Context label={t.access} value={workspace.accessBasis.replaceAll("_", " ")} /></div>
          </section>

          <section className={styles.securityCard}><p className={styles.cardLabel}>{t.security}</p><div className={styles.badgeRow}><Badge text={t.encrypted} ok={workspace.security.encryptedClinicalRecords}/><Badge text={t.audited} ok={workspace.security.auditedAccess}/><Badge text={t.enforced} ok={workspace.security.serverSideAccessBasisEnforced}/><Badge text={t.noAi} ok={!workspace.security.automatedClinicalRiskInference}/></div></section>

          <h2 className={styles.majorHeading}>{t.snapshot}</h2>
          <div className={styles.snapshotGrid}>
            <ClinicalListCard title={t.diagnoses} empty={t.noData} items={diagnoses.map((item)=>[firstText(item.display,item.code,"—"), firstText(item.status,"—")])}/>
            <ClinicalListCard title={t.medications} empty={t.noData} items={medications.map((item)=>[firstText(item.name,"—"), [firstText(item.dose,""),firstText(item.frequency,"")].filter(Boolean).join(" · ") || "—"])}/>
            <section className={styles.dataCard}><h3>{t.vitals}</h3>{Object.keys(vitals).length ? <dl className={styles.vitalsGrid}>{Object.entries(vitals).map(([key,value])=><div key={key}><dt>{humanize(key)}</dt><dd>{firstText(value,"—")}</dd></div>)}</dl> : <p>{t.noData}</p>}</section>
            <section className={styles.dataCard}><h3>{t.alerts}</h3>{workspace.riskAlerts.length ? <ul className={styles.clinicalList}>{workspace.riskAlerts.map((alert,index)=><li key={`${alert.orderId}-${index}`}><strong>{alert.label}</strong><span>⚠ {alert.flag}</span></li>)}</ul> : <p>{t.noAlerts}</p>}</section>
          </div>

          <section className={styles.dataCard}><h2>{t.timeline}</h2>{workspace.timeline.length ? <div className={styles.timelineList}>{workspace.timeline.map((encounter,index)=><EncounterCard key={`${textValue(encounter.appointment?.id)}-${index}`} encounter={encounter} t={t} locale={locale}/>)}</div> : <p>{t.noData}</p>}</section>

          <div className={styles.detailGrid}>
            <SectionCard title={t.orders} section={workspace.orders} restricted={t.restricted} empty={t.noData}>{workspace.orders.items.map((item,index)=><OrderRow key={index} item={item} t={t}/>)}</SectionCard>
            <SectionCard title={t.documents} section={workspace.documents} restricted={t.restricted} empty={t.noData}>{workspace.documents.items.map((item,index)=><DocumentRow key={index} item={item} t={t}/>)}</SectionCard>
            <SectionCard title={t.reports} section={workspace.diagnosticReports} restricted={t.restricted} empty={t.noData}>{workspace.diagnosticReports.items.map((item,index)=><ReportRow key={index} item={item} t={t}/>)}</SectionCard>
          </div>
        </> : null}
      </section>
    </div>
  </main>;
}

function Context({label,value}:{label:string;value:string}) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Badge({text,ok}:{text:string;ok:boolean}) { return <span className={styles.securityBadge}>{ok ? "✓" : "•"} {text}</span>; }
function ClinicalListCard({title,empty,items}:{title:string;empty:string;items:Array<[string,string]>}) { return <section className={styles.dataCard}><h3>{title}</h3>{items.length?<ul className={styles.clinicalList}>{items.map(([primary,secondary],index)=><li key={index}><strong>{primary}</strong><span>{secondary}</span></li>)}</ul>:<p>{empty}</p>}</section>; }
function EncounterCard({encounter,t,locale}:{encounter:Encounter;t:ClinicalCopy;locale:string}) { const appointment=objectValue(encounter.appointment); const provider=objectValue(appointment.provider); const service=objectValue(appointment.service); const record=encounter.latestRecord?.data ?? {}; return <article className={styles.timelineItem}><div className={styles.timelineMarker} aria-hidden="true">●</div><div><div className={styles.rowBetween}><strong>{formatDate(textValue(appointment.startsAt),locale)}</strong><span className={styles.statusBadge}>{encounter.finalized ? `✓ ${t.finalized}` : `● ${t.active}`}</span></div><p>{firstText(service.name,"—")} · {firstText(provider.displayName,"—")}</p>{Object.keys(record).length?<div className={styles.recordSummary}><p><b>{t.complaint}:</b> {firstText(record.chiefComplaint,"—")}</p><p><b>{t.assessment}:</b> {firstText(record.assessment,"—")}</p><p><b>{t.plan}:</b> {firstText(record.plan,"—")}</p></div>:null}</div></article>; }
function SectionCard({title,section,restricted,empty,children}:{title:string;section:Section;restricted:string;empty:string;children:ReactNode}) { return <section className={styles.dataCard}><div className={styles.rowBetween}><h2>{title}</h2><span className={styles.sectionState}>{section.state === "AVAILABLE" ? `✓ ${section.accessBasis?.replaceAll("_"," ") ?? "AVAILABLE"}` : `⛔ ${restricted}`}</span></div>{section.state === "RESTRICTED"?<p>{restricted}</p>:section.items.length?children:<p>{empty}</p>}</section>; }
function OrderRow({item,t}:{item:unknown;t:ClinicalCopy}) { const row=objectValue(item); const data=objectValue(row.data); const medication=objectValue(data.medication); const lab=objectValue(row.labResult); return <article className={styles.compactRow}><strong>{firstText(row.type,t.type)} · {firstText(row.status,"—")}</strong><span>{firstText(medication.name,data.reason,"—")}</span>{Object.keys(lab).length?<span>{t.labResult}: {firstText(lab.status,"—")}</span>:null}</article>; }
function DocumentRow({item,t}:{item:unknown;t:ClinicalCopy}) { const row=objectValue(item); const metadata=objectValue(row.metadata); return <article className={styles.compactRow}><strong>{firstText(metadata.title,metadata.fileName,t.document)}</strong><span>{firstText(row.kind,"—")} · {firstText(row.status,"—")}</span><span>{t.release}: {row.releasedToPatient === true ? "✓" : "—"}</span></article>; }
function ReportRow({item,t}:{item:unknown;t:ClinicalCopy}) { const row=objectValue(item); const data=objectValue(row.data); return <article className={styles.compactRow}><strong>{firstText(row.type,t.report)} · {firstText(row.status,"—")}</strong><span>{firstText(data.impression,data.findings,"—")}</span></article>; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function objectList(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(objectValue).filter((item)=>Object.keys(item).length>0) : []; }
function textValue(value: unknown): string { if (typeof value === "string") return value; if (typeof value === "number") return String(value); if (value instanceof Date) return value.toISOString(); return ""; }
function firstText(...values: unknown[]): string { for (const value of values) { const text=textValue(value).trim(); if (text) return text; } return ""; }
function humanize(value:string):string { return value.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ").replace(/^./,(character)=>character.toUpperCase()); }
function formatDate(value:string,locale:string):string { const date=new Date(value); return Number.isNaN(date.getTime()) ? value || "—" : new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(date); }
