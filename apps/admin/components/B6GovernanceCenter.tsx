"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./B6GovernanceCenter.module.css";

export type B6Section =
  | "terminology"
  | "data-quality"
  | "patient-merge"
  | "notification-templates"
  | "feature-flags"
  | "localization";

type RecordValue = Record<string, any>;

const labels: Record<Locale, Record<string, string>> = {
  en: {
    refresh: "Refresh", save: "Save", create: "Create", publish: "Publish new version", search: "Search",
    loading: "Loading…", failed: "Request failed.", empty: "No records.", version: "Version", active: "Active",
    reason: "Reason code", system: "System", code: "Code", display: "Display", name: "Name", uri: "URI",
    status: "Status", actions: "Actions", runScan: "Run quality scan", severity: "Severity", rule: "Rule",
    acknowledge: "Acknowledge", resolve: "Resolve", dismiss: "Dismiss", sourcePatient: "Source patient ID",
    targetPatient: "Target patient ID", preview: "Preview merge", execute: "Execute merge", conflicts: "Blocking conflicts",
    domains: "Domains", records: "Records", reviewConfirm: "I reviewed the preview and all conflicts.",
    archiveConfirm: "I understand the source account will be archived and sessions revoked.",
    templateKey: "Template key", featureKey: "Feature key", defaultEnabled: "Default enabled",
    environment: "Environment", jurisdiction: "Jurisdiction", role: "Role", providerCategory: "Provider category ID",
    enabled: "Enabled", priority: "Priority", namespace: "Namespace", key: "Key", english: "English",
    arabic: "Arabic", french: "French", spanish: "Spanish", selectRecord: "Select a record to publish a new version.",
    current: "Current", catalogVersion: "Catalog version", recentRuns: "Recent runs", openIssues: "Issues",
  },
  ar: {
    refresh: "تحديث", save: "حفظ", create: "إنشاء", publish: "نشر إصدار جديد", search: "بحث",
    loading: "جارٍ التحميل…", failed: "فشل الطلب.", empty: "لا توجد سجلات.", version: "الإصدار", active: "نشط",
    reason: "رمز السبب", system: "النظام", code: "الرمز", display: "العرض", name: "الاسم", uri: "URI",
    status: "الحالة", actions: "الإجراءات", runScan: "تشغيل فحص الجودة", severity: "الشدة", rule: "القاعدة",
    acknowledge: "إقرار", resolve: "حل", dismiss: "استبعاد", sourcePatient: "معرّف المريض المصدر",
    targetPatient: "معرّف المريض الهدف", preview: "معاينة الدمج", execute: "تنفيذ الدمج", conflicts: "تعارضات مانعة",
    domains: "النطاقات", records: "السجلات", reviewConfirm: "راجعت المعاينة وجميع التعارضات.",
    archiveConfirm: "أفهم أنه سيتم أرشفة حساب المصدر وإلغاء جلساته.",
    templateKey: "مفتاح القالب", featureKey: "مفتاح الميزة", defaultEnabled: "مفعّل افتراضياً",
    environment: "البيئة", jurisdiction: "الولاية/الدولة", role: "الدور", providerCategory: "معرّف فئة مقدم الخدمة",
    enabled: "مفعّل", priority: "الأولوية", namespace: "النطاق", key: "المفتاح", english: "الإنجليزية",
    arabic: "العربية", french: "الفرنسية", spanish: "الإسبانية", selectRecord: "اختر سجلاً لنشر إصدار جديد.",
    current: "الحالي", catalogVersion: "إصدار الكتالوج", recentRuns: "آخر التشغيلات", openIssues: "المشكلات",
  },
  fr: {
    refresh: "Actualiser", save: "Enregistrer", create: "Créer", publish: "Publier une nouvelle version", search: "Rechercher",
    loading: "Chargement…", failed: "Échec de la requête.", empty: "Aucun enregistrement.", version: "Version", active: "Actif",
    reason: "Code motif", system: "Système", code: "Code", display: "Libellé", name: "Nom", uri: "URI",
    status: "Statut", actions: "Actions", runScan: "Lancer l’analyse qualité", severity: "Sévérité", rule: "Règle",
    acknowledge: "Accuser réception", resolve: "Résoudre", dismiss: "Classer", sourcePatient: "ID patient source",
    targetPatient: "ID patient cible", preview: "Prévisualiser la fusion", execute: "Exécuter la fusion", conflicts: "Conflits bloquants",
    domains: "Domaines", records: "Enregistrements", reviewConfirm: "J’ai examiné la prévisualisation et les conflits.",
    archiveConfirm: "Je comprends que le compte source sera archivé et ses sessions révoquées.",
    templateKey: "Clé du modèle", featureKey: "Clé de fonctionnalité", defaultEnabled: "Activé par défaut",
    environment: "Environnement", jurisdiction: "Juridiction", role: "Rôle", providerCategory: "ID catégorie prestataire",
    enabled: "Activé", priority: "Priorité", namespace: "Espace de noms", key: "Clé", english: "Anglais",
    arabic: "Arabe", french: "Français", spanish: "Espagnol", selectRecord: "Sélectionnez un enregistrement pour publier une nouvelle version.",
    current: "Actuel", catalogVersion: "Version catalogue", recentRuns: "Exécutions récentes", openIssues: "Problèmes",
  },
  es: {
    refresh: "Actualizar", save: "Guardar", create: "Crear", publish: "Publicar nueva versión", search: "Buscar",
    loading: "Cargando…", failed: "La solicitud falló.", empty: "Sin registros.", version: "Versión", active: "Activo",
    reason: "Código de motivo", system: "Sistema", code: "Código", display: "Texto", name: "Nombre", uri: "URI",
    status: "Estado", actions: "Acciones", runScan: "Ejecutar control de calidad", severity: "Severidad", rule: "Regla",
    acknowledge: "Reconocer", resolve: "Resolver", dismiss: "Descartar", sourcePatient: "ID paciente origen",
    targetPatient: "ID paciente destino", preview: "Previsualizar fusión", execute: "Ejecutar fusión", conflicts: "Conflictos bloqueantes",
    domains: "Dominios", records: "Registros", reviewConfirm: "He revisado la previsualización y todos los conflictos.",
    archiveConfirm: "Entiendo que la cuenta origen será archivada y sus sesiones revocadas.",
    templateKey: "Clave de plantilla", featureKey: "Clave de feature", defaultEnabled: "Activado por defecto",
    environment: "Entorno", jurisdiction: "Jurisdicción", role: "Rol", providerCategory: "ID categoría de proveedor",
    enabled: "Activado", priority: "Prioridad", namespace: "Namespace", key: "Clave", english: "Inglés",
    arabic: "Árabe", french: "Francés", spanish: "Español", selectRecord: "Selecciona un registro para publicar una nueva versión.",
    current: "Actual", catalogVersion: "Versión del catálogo", recentRuns: "Ejecuciones recientes", openIssues: "Incidencias",
  },
};

const sectionCopy: Record<B6Section, Record<Locale, { eyebrow: string; title: string; intro: string }>> = {
  terminology: {
    en:{eyebrow:"ADM-084 · TERMINOLOGY",title:"Clinical terminology catalog",intro:"Govern coding systems and versioned concepts without rewriting historical clinical records."},
    ar:{eyebrow:"ADM-084 · المصطلحات",title:"كتالوج المصطلحات السريرية",intro:"إدارة أنظمة الترميز والمفاهيم ذات الإصدارات دون تغيير السجلات السريرية التاريخية."},
    fr:{eyebrow:"ADM-084 · TERMINOLOGIE",title:"Catalogue de terminologie clinique",intro:"Gérez les systèmes de codage et concepts versionnés sans réécrire l’historique clinique."},
    es:{eyebrow:"ADM-084 · TERMINOLOGÍA",title:"Catálogo de terminología clínica",intro:"Gobierna sistemas de códigos y conceptos versionados sin reescribir registros clínicos históricos."},
  },
  "data-quality": {
    en:{eyebrow:"ADM-088 · DATA QUALITY",title:"Patient data quality",intro:"Detect reproducible quality issues and route remediation without automatically changing clinical source data."},
    ar:{eyebrow:"ADM-088 · جودة البيانات",title:"جودة بيانات المريض",intro:"اكتشاف مشكلات جودة قابلة للتكرار وتوجيه المعالجة دون تعديل البيانات السريرية تلقائياً."},
    fr:{eyebrow:"ADM-088 · QUALITÉ DES DONNÉES",title:"Qualité des données patient",intro:"Détectez des problèmes reproductibles et pilotez la remédiation sans correction automatique des données cliniques."},
    es:{eyebrow:"ADM-088 · CALIDAD DE DATOS",title:"Calidad de datos del paciente",intro:"Detecta problemas reproducibles y gestiona la remediación sin modificar automáticamente los datos clínicos."},
  },
  "patient-merge": {
    en:{eyebrow:"ADM-090 · CONTROLLED MERGE",title:"Controlled patient merge",intro:"Preview structural conflicts before any identity merge. Execution is blocked on unsafe domains or plan drift."},
    ar:{eyebrow:"ADM-090 · دمج مضبوط",title:"دمج المرضى بشكل مضبوط",intro:"معاينة التعارضات البنيوية قبل دمج الهوية. يُمنع التنفيذ عند وجود نطاقات غير آمنة أو تغير الخطة."},
    fr:{eyebrow:"ADM-090 · FUSION CONTRÔLÉE",title:"Fusion contrôlée des patients",intro:"Prévisualisez les conflits structurels avant toute fusion. L’exécution est bloquée en cas de domaine dangereux ou dérive du plan."},
    es:{eyebrow:"ADM-090 · FUSIÓN CONTROLADA",title:"Fusión controlada de pacientes",intro:"Previsualiza conflictos estructurales antes de fusionar identidades. La ejecución se bloquea ante dominios inseguros o cambios del plan."},
  },
  "notification-templates": {
    en:{eyebrow:"ADM-100 · NOTIFICATIONS",title:"Versioned multichannel templates",intro:"Publish PHI-safe static text for push, email, SMS and in-app delivery in EN/AR/FR/ES."},
    ar:{eyebrow:"ADM-100 · الإشعارات",title:"قوالب متعددة القنوات بإصدارات",intro:"نشر نص ثابت آمن من PHI لقنوات push والبريد وSMS وداخل التطبيق بأربع لغات."},
    fr:{eyebrow:"ADM-100 · NOTIFICATIONS",title:"Modèles multicanaux versionnés",intro:"Publiez du texte statique sans PHI pour push, email, SMS et in-app en EN/AR/FR/ES."},
    es:{eyebrow:"ADM-100 · NOTIFICACIONES",title:"Plantillas multicanal versionadas",intro:"Publica texto estático sin PHI para push, email, SMS e in-app en EN/AR/FR/ES."},
  },
  "feature-flags": {
    en:{eyebrow:"ADM-101 · FEATURE GOVERNANCE",title:"Clinical feature flags",intro:"Control rollout by environment, jurisdiction, role or provider category. Backend enforcement remains authoritative."},
    ar:{eyebrow:"ADM-101 · حوكمة الميزات",title:"أعلام الميزات السريرية",intro:"تحكم في الإطلاق حسب البيئة والولاية والدور وفئة مقدم الخدمة مع بقاء فرض الخادم هو المرجع."},
    fr:{eyebrow:"ADM-101 · GOUVERNANCE DES FEATURES",title:"Feature flags cliniques",intro:"Contrôlez le déploiement par environnement, juridiction, rôle ou catégorie; le backend reste l’autorité."},
    es:{eyebrow:"ADM-101 · GOBERNANZA DE FEATURES",title:"Clinical feature flags",intro:"Controla rollout por entorno, jurisdicción, rol o categoría; el backend sigue siendo la autoridad."},
  },
  localization: {
    en:{eyebrow:"ADM-110 · LOCALIZATION",title:"Dynamic clinical localization",intro:"Version configurable EN/AR/FR/ES content without requiring a mobile or web application release."},
    ar:{eyebrow:"ADM-110 · الترجمة",title:"إدارة المحتوى متعدد اللغات",intro:"إدارة إصدارات EN/AR/FR/ES الديناميكية دون الحاجة إلى إصدار جديد للتطبيق."},
    fr:{eyebrow:"ADM-110 · LOCALISATION",title:"Localisation clinique dynamique",intro:"Versionnez le contenu EN/AR/FR/ES sans nouvelle version mobile ou web."},
    es:{eyebrow:"ADM-110 · LOCALIZACIÓN",title:"Localización clínica dinámica",intro:"Versiona contenido EN/AR/FR/ES sin requerir un nuevo release web o móvil."},
  },
};

export function B6GovernanceCenter({ section }: { section: B6Section }) {
  const { locale } = useI18n();
  const c = labels[locale];
  const hero = sectionCopy[section][locale];
  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <span>{hero.eyebrow}</span>
        <h2>{hero.title}</h2>
        <p>{hero.intro}</p>
      </section>
      {section === "terminology" ? <Terminology locale={locale} c={c} /> : null}
      {section === "data-quality" ? <DataQuality locale={locale} c={c} /> : null}
      {section === "patient-merge" ? <PatientMerge c={c} /> : null}
      {section === "notification-templates" ? <NotificationTemplates c={c} /> : null}
      {section === "feature-flags" ? <FeatureFlags c={c} /> : null}
      {section === "localization" ? <Localization c={c} /> : null}
    </div>
  );
}

function Terminology({ locale, c }: { locale: Locale; c: Record<string,string> }) {
  const [systems,setSystems]=useState<RecordValue[]>([]);
  const [concepts,setConcepts]=useState<RecordValue[]>([]);
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<RecordValue|null>(null);
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    setLoading(true);
    try {
      const [s,search]=await Promise.all([
        api("/terminology/systems"),
        api("/terminology/search?limit=100"),
      ]);
      setSystems(list(s));
      setConcepts(list(search));
    } catch(e){ setMessage(errorText(e,c.failed)); }
    finally { setLoading(false); }
  },[c.failed]);
  useEffect(()=>{void load();},[load]);

  async function search(e:FormEvent){e.preventDefault(); try {
    const data=await api(`/terminology/search?q=${encodeURIComponent(query)}&limit=100`);
    setConcepts(list(data)); setMessage("");
  } catch(err){setMessage(errorText(err,c.failed));}}

  async function createSystem(e:FormEvent<HTMLFormElement>){e.preventDefault(); const fd=new FormData(e.currentTarget); try{
    await api("/terminology/systems",{method:"POST",body:{uri:text(fd,"uri"),name:text(fd,"name")}});
    e.currentTarget.reset(); setMessage("OK"); await load();
  }catch(err){setMessage(errorText(err,c.failed));}}

  async function createConcept(e:FormEvent<HTMLFormElement>){e.preventDefault(); const fd=new FormData(e.currentTarget); try{
    await api("/terminology/concepts",{method:"POST",body:{system:text(fd,"system"),code:text(fd,"code"),display:text(fd,"display"),status:"ACTIVE"}});
    e.currentTarget.reset(); setMessage("OK"); await load();
  }catch(err){setMessage(errorText(err,c.failed));}}

  async function publish(e:FormEvent<HTMLFormElement>){e.preventDefault(); if(!selected)return; const fd=new FormData(e.currentTarget); try{
    await api(`/terminology/concepts/${encodeURIComponent(String(selected.id))}/versions`,{method:"POST",body:{
      expectedVersion:Number(selected.contentVersion),display:text(fd,"display"),status:text(fd,"status")||"ACTIVE"
    }});
    setSelected(null); setMessage("OK"); await load();
  }catch(err){setMessage(errorText(err,c.failed));}}

  return <><Toolbar loading={loading} message={message} onRefresh={load} c={c}/>
    <div className={styles.columns}>
      <form className={styles.panel} onSubmit={createSystem}><h3>{c.system}</h3>
        <Field name="uri" label={c.uri} required/><Field name="name" label={c.name} required/>
        <button className={styles.primary}>{c.create}</button>
      </form>
      <form className={styles.panel} onSubmit={createConcept}><h3>{c.create} · {c.display}</h3>
        <label>{c.system}<select name="system" required>{systems.map(s=><option key={s.id} value={String(s.uri)}>{String(s.name)} · {String(s.uri)}</option>)}</select></label>
        <Field name="code" label={c.code} required/><Field name="display" label={c.display} required/>
        <button className={styles.primary}>{c.create}</button>
      </form>
    </div>
    <form className={styles.searchBar} onSubmit={search}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={c.search}/><button>{c.search}</button></form>
    <section className={styles.panel}><Table headers={[c.system,c.code,c.display,c.version,c.status,c.actions]}>
      {concepts.map(row=><tr key={String(row.id)}><td>{String(row.system)}</td><td>{String(row.code)}</td><td>{String(row.display)}</td><td>{String(row.contentVersion)}</td><td>{String(row.status)}</td><td><button className={styles.linkButton} onClick={()=>setSelected(row)}>{c.publish}</button></td></tr>)}
    </Table></section>
    {selected?<form className={styles.panel} onSubmit={publish}><h3>{c.publish}: {String(selected.code)}</h3>
      <Field name="display" label={c.display} defaultValue={String(selected.display ?? "")} required/>
      <label>{c.status}<select name="status" defaultValue={String(selected.status ?? "ACTIVE")}><option>ACTIVE</option><option>INACTIVE</option></select></label>
      <button className={styles.primary}>{c.publish}</button>
    </form>:null}
  </>;
}

function DataQuality({ locale, c }: { locale: Locale; c: Record<string,string> }) {
  const [rules,setRules]=useState<RecordValue[]>([]);
  const [runs,setRuns]=useState<RecordValue[]>([]);
  const [issues,setIssues]=useState<RecordValue[]>([]);
  const [reason,setReason]=useState("ADMIN_REVIEW");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    setLoading(true); try{
      const [r,ru,i]=await Promise.all([api("/data-quality/rules"),api("/data-quality/runs?limit=20"),api("/data-quality/issues?limit=200")]);
      setRules(list(r)); setRuns(list(ru)); setIssues(list(i));
    }catch(e){setMessage(errorText(e,c.failed));}finally{setLoading(false);}
  },[c.failed]);
  useEffect(()=>{void load();},[load]);

  async function run(){try{await api("/data-quality/run",{method:"POST",body:{}});setMessage("OK");await load();}catch(e){setMessage(errorText(e,c.failed));}}
  async function act(row:RecordValue,status:string){try{
    await api(`/data-quality/issues/${encodeURIComponent(String(row.id))}/status`,{method:"POST",body:{expectedVersion:Number(row.version),status,reasonCode:reason}});
    setMessage("OK"); await load();
  }catch(e){setMessage(errorText(e,c.failed));}}

  return <><Toolbar loading={loading} message={message} onRefresh={load} c={c}>
    <button className={styles.primary} onClick={run}>{c.runScan}</button>
  </Toolbar>
  <div className={styles.metrics}><Metric label={c.rule} value={rules.length}/><Metric label={c.recentRuns} value={runs.length}/><Metric label={c.openIssues} value={issues.filter(x=>x.status==="OPEN").length}/></div>
  <div className={styles.panel}><label>{c.reason}<input value={reason} onChange={e=>setReason(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"").slice(0,80))}/></label></div>
  <section className={styles.panel}><Table headers={[c.rule,c.severity,c.status,c.version,c.actions]}>
    {issues.map(row=><tr key={String(row.id)}><td><strong>{String(row.rule?.code ?? "")}</strong><small>{String(row.sourceEntityType ?? "")}</small></td><td>{String(row.severity ?? "")}</td><td>{String(row.status)}</td><td>{String(row.version)}</td><td className={styles.actions}>
      {row.status==="OPEN"?<button onClick={()=>void act(row,"ACKNOWLEDGED")}>{c.acknowledge}</button>:null}
      {!["RESOLVED","DISMISSED"].includes(String(row.status))?<><button onClick={()=>void act(row,"RESOLVED")}>{c.resolve}</button><button onClick={()=>void act(row,"DISMISSED")}>{c.dismiss}</button></>:null}
    </td></tr>)}
  </Table></section>
  <section className={styles.panel}><h3>{c.recentRuns}</h3><Table headers={["ID",c.status,c.rule,c.openIssues]}>
    {runs.map(row=><tr key={String(row.id)}><td>{short(String(row.id))}</td><td>{String(row.status)}</td><td>{String(row.ruleCount ?? 0)}</td><td>{String(row.issueCount ?? 0)}</td></tr>)}
  </Table></section></>;
}

function PatientMerge({ c }: { c: Record<string,string> }) {
  const [preview,setPreview]=useState<RecordValue|null>(null);
  const [message,setMessage]=useState("");
  const [reviewed,setReviewed]=useState(false);
  const [archive,setArchive]=useState(false);
  async function makePreview(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);try{
    const data=await api("/patient-merge/preview",{method:"POST",body:{sourcePatientId:text(fd,"source"),targetPatientId:text(fd,"target")}});
    setPreview(asRecord(data)); setReviewed(false);setArchive(false);setMessage("");
  }catch(err){setMessage(errorText(err,c.failed));}}
  async function execute(){if(!preview||!reviewed||!archive)return;try{
    const data=await api(`/patient-merge/${encodeURIComponent(String(preview.id))}/execute`,{method:"POST",body:{planDigest:String(preview.planDigest)}});
    setPreview(asRecord(data));setMessage("OK");
  }catch(err){setMessage(errorText(err,c.failed));}}
  return <>
    {message?<div className={styles.notice}>{message}</div>:null}
    <form className={styles.panel} onSubmit={makePreview}><div className={styles.columns}>
      <Field name="source" label={c.sourcePatient} required/><Field name="target" label={c.targetPatient} required/>
    </div><button className={styles.primary}>{c.preview}</button></form>
    {preview?<section className={styles.panel}>
      <div className={styles.metrics}><Metric label={c.domains} value={Number(preview.domainCount ?? 0)}/><Metric label={c.records} value={Number(preview.recordCount ?? preview.movedRecords ?? 0)}/><Metric label={c.conflicts} value={Number(preview.blockingConflictCount ?? 0)}/></div>
      {Array.isArray(preview.domains)?<Table headers={["Domain","Source","Target",c.status]}>{preview.domains.map((d:RecordValue)=><tr key={String(d.tableName)}><td>{String(d.tableName)}</td><td>{String(d.sourceCount)}</td><td>{String(d.targetCount)}</td><td>{String(d.action)}</td></tr>)}</Table>:null}
      {preview.state==="PREVIEWED"?<div className={styles.confirm}>
        <label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{c.reviewConfirm}</label>
        <label><input type="checkbox" checked={archive} onChange={e=>setArchive(e.target.checked)}/>{c.archiveConfirm}</label>
        <button className={styles.danger} disabled={!reviewed||!archive||preview.executionAllowed===false} onClick={()=>void execute()}>{c.execute}</button>
      </div>:<div className={styles.notice}>{c.status}: {String(preview.state ?? "EXECUTED")}</div>}
    </section>:null}
  </>;
}

function NotificationTemplates({ c }: { c: Record<string,string> }) {
  const [items,setItems]=useState<RecordValue[]>([]);
  const [selected,setSelected]=useState<RecordValue|null>(null);
  const [message,setMessage]=useState("");
  const load=useCallback(async()=>{try{setItems(list(await api("/notification-templates")));}catch(e){setMessage(errorText(e,c.failed));}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const translations={en:text(fd,"en"),ar:text(fd,"ar"),fr:text(fd,"fr"),es:text(fd,"es")};try{
    if(selected) await api(`/notification-templates/${encodeURIComponent(String(selected.id))}/versions`,{method:"POST",body:{expectedVersion:Number(selected.currentVersion),translations}});
    else await api("/notification-templates",{method:"POST",body:{key:text(fd,"key"),translations}});
    setSelected(null);e.currentTarget.reset();setMessage("OK");await load();
  }catch(err){setMessage(errorText(err,c.failed));}}
  const current=asRecord(selected?.currentTranslations);
  return <><Toolbar message={message} onRefresh={load} c={c}/><div className={styles.columns}>
    <section className={styles.panel}><Table headers={[c.templateKey,c.version,c.actions]}>{items.map(row=><tr key={String(row.id)}><td>{String(row.key)}</td><td>{String(row.currentVersion)}</td><td><button onClick={()=>setSelected(row)}>{c.publish}</button></td></tr>)}</Table></section>
    <form className={styles.panel} onSubmit={submit}><h3>{selected?c.publish:c.create}</h3>
      {!selected?<Field name="key" label={c.templateKey} required/>:<div className={styles.notice}>{String(selected.key)} · v{String(selected.currentVersion)}</div>}
      <Field name="en" label={c.english} defaultValue={String(current.en ?? "")} required/>
      <Field name="ar" label={c.arabic} defaultValue={String(current.ar ?? "")} required/>
      <Field name="fr" label={c.french} defaultValue={String(current.fr ?? "")} required/>
      <Field name="es" label={c.spanish} defaultValue={String(current.es ?? "")} required/>
      <button className={styles.primary}>{selected?c.publish:c.create}</button>
    </form>
  </div></>;
}

function FeatureFlags({ c }: { c: Record<string,string> }) {
  const [items,setItems]=useState<RecordValue[]>([]);
  const [selected,setSelected]=useState<RecordValue|null>(null);
  const [message,setMessage]=useState("");
  const load=useCallback(async()=>{try{setItems(list(await api("/feature-flags")));}catch(e){setMessage(errorText(e,c.failed));}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);
    const assignmentPresent=["environment","jurisdiction","role","providerCategory"].some(k=>text(fd,k));
    const assignments=assignmentPresent?[{
      environment:text(fd,"environment")||null,jurisdiction:text(fd,"jurisdiction")||null,role:text(fd,"role")||null,
      providerCategoryId:text(fd,"providerCategory")||null,enabled:fd.get("assignmentEnabled")==="on",priority:Number(text(fd,"priority")||"0")
    }]:[];
    const defaultEnabled=fd.get("defaultEnabled")==="on";
    const reasonCode=text(fd,"reason")||"ADMIN_CONFIGURATION";
    try{
      if(selected) await api(`/feature-flags/${encodeURIComponent(String(selected.id))}/versions`,{method:"POST",body:{expectedVersion:Number(selected.currentVersion),defaultEnabled,reasonCode,assignments}});
      else await api("/feature-flags",{method:"POST",body:{key:text(fd,"key"),defaultEnabled,reasonCode,assignments}});
      setSelected(null);e.currentTarget.reset();setMessage("OK");await load();
    }catch(err){setMessage(errorText(err,c.failed));}
  }
  const current=asRecord(selected?.version);
  const firstAssignment=Array.isArray(current.assignments)?asRecord(current.assignments[0]):{};
  return <><Toolbar message={message} onRefresh={load} c={c}/><div className={styles.columns}>
    <section className={styles.panel}><Table headers={[c.featureKey,c.version,c.defaultEnabled,c.actions]}>{items.map(row=><tr key={String(row.id)}><td>{String(row.key)}</td><td>{String(row.currentVersion)}</td><td>{String(row.version?.defaultEnabled ?? false)}</td><td><button onClick={()=>setSelected(row)}>{c.publish}</button></td></tr>)}</Table></section>
    <form className={styles.panel} onSubmit={submit}><h3>{selected?c.publish:c.create}</h3>
      {!selected?<Field name="key" label={c.featureKey} required/>:<div className={styles.notice}>{String(selected.key)} · v{String(selected.currentVersion)}</div>}
      <label className={styles.check}><input name="defaultEnabled" type="checkbox" defaultChecked={Boolean(current.defaultEnabled)}/>{c.defaultEnabled}</label>
      <Field name="reason" label={c.reason} defaultValue={String(current.reasonCode ?? "ADMIN_CONFIGURATION")} required/>
      <h4>Target assignment</h4>
      <div className={styles.grid2}><Field name="environment" label={c.environment} defaultValue={String(firstAssignment.environment ?? "")}/><Field name="jurisdiction" label={c.jurisdiction} defaultValue={String(firstAssignment.jurisdiction ?? "")}/><Field name="role" label={c.role} defaultValue={String(firstAssignment.role ?? "")}/><Field name="providerCategory" label={c.providerCategory} defaultValue={String(firstAssignment.providerCategoryId ?? "")}/><Field name="priority" label={c.priority} defaultValue={String(firstAssignment.priority ?? "0")} type="number"/></div>
      <label className={styles.check}><input name="assignmentEnabled" type="checkbox" defaultChecked={firstAssignment.enabled!==false}/>{c.enabled}</label>
      <button className={styles.primary}>{selected?c.publish:c.create}</button>
    </form>
  </div></>;
}

function Localization({ c }: { c: Record<string,string> }) {
  const [items,setItems]=useState<RecordValue[]>([]);
  const [catalogVersion,setCatalogVersion]=useState(0);
  const [selected,setSelected]=useState<RecordValue|null>(null);
  const [message,setMessage]=useState("");
  const load=useCallback(async()=>{try{const data=asRecord(await api("/localization"));setItems(list(data));setCatalogVersion(Number(data.catalogVersion??0));}catch(e){setMessage(errorText(e,c.failed));}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const body={
    textEn:text(fd,"en"),textAr:text(fd,"ar")||null,textFr:text(fd,"fr")||null,textEs:text(fd,"es")||null,reasonCode:text(fd,"reason")||"ADMIN_CONFIGURATION"
  };try{
    if(selected) await api(`/localization/keys/${encodeURIComponent(String(selected.id))}/versions`,{method:"POST",body:{...body,expectedVersion:Number(selected.currentVersion)}});
    else await api("/localization/keys",{method:"POST",body:{key:text(fd,"key"),namespace:text(fd,"namespace")||undefined,...body}});
    setSelected(null);e.currentTarget.reset();setMessage("OK");await load();
  }catch(err){setMessage(errorText(err,c.failed));}}
  const version=asRecord(selected?.version);
  return <><Toolbar message={message} onRefresh={load} c={c}><span className={styles.badge}>{c.catalogVersion}: {catalogVersion}</span></Toolbar><div className={styles.columns}>
    <section className={styles.panel}><Table headers={[c.key,c.namespace,c.version,c.actions]}>{items.map(row=><tr key={String(row.id)}><td>{String(row.key)}</td><td>{String(row.namespace)}</td><td>{String(row.currentVersion)}</td><td><button onClick={()=>setSelected(row)}>{c.publish}</button></td></tr>)}</Table></section>
    <form className={styles.panel} onSubmit={submit}><h3>{selected?c.publish:c.create}</h3>
      {!selected?<><Field name="key" label={c.key} required/><Field name="namespace" label={c.namespace}/></>:<div className={styles.notice}>{String(selected.key)} · v{String(selected.currentVersion)}</div>}
      <Field name="en" label={c.english} defaultValue={String(version.textEn ?? "")} required/>
      <Field name="ar" label={c.arabic} defaultValue={String(version.textAr ?? "")}/>
      <Field name="fr" label={c.french} defaultValue={String(version.textFr ?? "")}/>
      <Field name="es" label={c.spanish} defaultValue={String(version.textEs ?? "")}/>
      <Field name="reason" label={c.reason} defaultValue={String(version.reasonCode ?? "ADMIN_CONFIGURATION")} required/>
      <button className={styles.primary}>{selected?c.publish:c.create}</button>
    </form>
  </div></>;
}

function Toolbar({loading=false,message,onRefresh,c,children}:{loading?:boolean;message?:string;onRefresh:()=>void|Promise<void>;c:Record<string,string>;children?:React.ReactNode}) {
  return <div className={styles.toolbar}><div>{message?<span className={styles.notice}>{message}</span>:null}{loading?<span>{c.loading}</span>:null}</div><div className={styles.actions}>{children}<button onClick={()=>void onRefresh()}>{c.refresh}</button></div></div>;
}
function Metric({label,value}:{label:string;value:string|number}){return <article><span>{label}</span><strong>{value}</strong></article>;}
function Field({name,label,required=false,defaultValue="",type="text"}:{name:string;label:string;required?:boolean;defaultValue?:string;type?:string}){return <label>{label}<input name={name} type={type} required={required} defaultValue={defaultValue}/></label>;}
function Table({headers,children}:{headers:string[];children:React.ReactNode}){return <div className={styles.tableWrap}><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}

async function api(path:string,options?:{method?:"POST";body?:unknown}) {
  const response=await fetch(`/api/admin/b6${path}`,{
    method:options?.method??"GET",cache:"no-store",
    headers:options?.body!==undefined?{"content-type":"application/json"}:undefined,
    body:options?.body!==undefined?JSON.stringify(options.body):undefined,
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(typeof payload?.message==="string"?payload.message:`HTTP ${response.status}`);
  return payload;
}
function list(value:any):RecordValue[]{if(Array.isArray(value))return value.map(asRecord);if(Array.isArray(value?.items))return value.items.map(asRecord);return [];}
function asRecord(value:any):RecordValue{return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function text(fd:FormData,key:string){return String(fd.get(key)??"").trim();}
function errorText(value:unknown,fallback:string){return value instanceof Error?value.message:fallback;}
function short(value:string){return value.length>14?`${value.slice(0,8)}…${value.slice(-4)}`:value;}
