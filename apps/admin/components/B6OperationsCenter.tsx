"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./B6GovernanceCenter.module.css";

export type B6OperationsSection = "duplicates" | "integrations" | "audit-exports" | "clinical-operations";
type Row = Record<string, any>;

type Copy = {
  refresh:string; loading:string; failed:string; empty:string; score:string; reasons:string; review:string;
  patientA:string; patientB:string; connector:string; health:string; configured:string; credentials:string;
  lastSync:string; lastError:string; createExport:string; from:string; to:string; action:string; objectType:string;
  result:string; status:string; expires:string; digest:string; download:string; generated:string;
  questionnaires:string; plans:string; alerts:string; results:string; orphanTasks:string; methodology:string;
  yes:string; no:string; limit:string;
};

const copy: Record<Locale, Copy> = {
  en:{refresh:"Refresh",loading:"Loading…",failed:"Request failed.",empty:"No records.",score:"Score",reasons:"Evidence",review:"Review merge",patientA:"Patient A",patientB:"Patient B",connector:"Connector",health:"Health",configured:"Configured",credentials:"Credential references",lastSync:"Last sync",lastError:"Last error",createExport:"Create signed export",from:"From",to:"To",action:"Action",objectType:"Object type",result:"Result",status:"Status",expires:"Expires",digest:"SHA-256",download:"Download",generated:"Generated",questionnaires:"Overdue questionnaires",plans:"Plans without review",alerts:"Open RPM alerts",results:"Pending lab results",orphanTasks:"Orphan tasks",methodology:"Reproducible methodology",yes:"Yes",no:"No",limit:"Limit"},
  ar:{refresh:"تحديث",loading:"جارٍ التحميل…",failed:"فشل الطلب.",empty:"لا توجد سجلات.",score:"الدرجة",reasons:"الدليل",review:"مراجعة الدمج",patientA:"المريض أ",patientB:"المريض ب",connector:"الموصل",health:"الحالة",configured:"مهيأ",credentials:"مراجع بيانات الاعتماد",lastSync:"آخر مزامنة",lastError:"آخر خطأ",createExport:"إنشاء تصدير موقع",from:"من",to:"إلى",action:"الإجراء",objectType:"نوع الكائن",result:"النتيجة",status:"الحالة",expires:"ينتهي",digest:"SHA-256",download:"تنزيل",generated:"تم الإنشاء",questionnaires:"استبيانات متأخرة",plans:"خطط دون مراجعة",alerts:"تنبيهات RPM مفتوحة",results:"نتائج مختبر معلقة",orphanTasks:"مهام يتيمة",methodology:"منهجية قابلة لإعادة الإنتاج",yes:"نعم",no:"لا",limit:"الحد"},
  fr:{refresh:"Actualiser",loading:"Chargement…",failed:"Échec de la requête.",empty:"Aucun enregistrement.",score:"Score",reasons:"Preuves",review:"Examiner la fusion",patientA:"Patient A",patientB:"Patient B",connector:"Connecteur",health:"Santé",configured:"Configuré",credentials:"Références d’identifiants",lastSync:"Dernière synchro",lastError:"Dernière erreur",createExport:"Créer export signé",from:"Du",to:"Au",action:"Action",objectType:"Type d’objet",result:"Résultat",status:"Statut",expires:"Expire",digest:"SHA-256",download:"Télécharger",generated:"Généré",questionnaires:"Questionnaires en retard",plans:"Plans sans revue",alerts:"Alertes RPM ouvertes",results:"Résultats labo en attente",orphanTasks:"Tâches orphelines",methodology:"Méthodologie reproductible",yes:"Oui",no:"Non",limit:"Limite"},
  es:{refresh:"Actualizar",loading:"Cargando…",failed:"La solicitud falló.",empty:"Sin registros.",score:"Puntuación",reasons:"Evidencia",review:"Revisar fusión",patientA:"Paciente A",patientB:"Paciente B",connector:"Conector",health:"Salud",configured:"Configurado",credentials:"Referencias de credenciales",lastSync:"Última sincronización",lastError:"Último error",createExport:"Crear exportación firmada",from:"Desde",to:"Hasta",action:"Acción",objectType:"Tipo de objeto",result:"Resultado",status:"Estado",expires:"Expira",digest:"SHA-256",download:"Descargar",generated:"Generado",questionnaires:"Cuestionarios vencidos",plans:"Planes sin revisión",alerts:"Alertas RPM abiertas",results:"Resultados de laboratorio pendientes",orphanTasks:"Tareas huérfanas",methodology:"Metodología reproducible",yes:"Sí",no:"No",limit:"Límite"},
};

const hero: Record<B6OperationsSection, Record<Locale,{eyebrow:string;title:string;intro:string}>> = {
  duplicates:{
    en:{eyebrow:"ADM-089 · DATA QUALITY",title:"Duplicate patient candidates",intro:"Deterministic, minimized matching evidence for human review. CarePoint never merges these candidates automatically."},
    ar:{eyebrow:"ADM-089 · جودة البيانات",title:"مرشحو المرضى المكررين",intro:"دليل مطابقة حتمي ومختصر للمراجعة البشرية. لا يقوم CarePoint بالدمج تلقائياً."},
    fr:{eyebrow:"ADM-089 · QUALITÉ DES DONNÉES",title:"Candidats patients en doublon",intro:"Preuves déterministes et minimisées pour revue humaine. Aucun rapprochement automatique."},
    es:{eyebrow:"ADM-089 · CALIDAD DE DATOS",title:"Candidatos de pacientes duplicados",intro:"Evidencia determinista y minimizada para revisión humana. CarePoint nunca fusiona automáticamente."},
  },
  integrations:{
    en:{eyebrow:"ADM-102 · INTEGRATIONS",title:"Integration Center",intro:"Connector configuration references, operational health and recent error state without returning secret values."},
    ar:{eyebrow:"ADM-102 · التكاملات",title:"مركز التكامل",intro:"مراجع الإعداد والحالة التشغيلية والأخطاء الأخيرة دون إرجاع أي قيم سرية."},
    fr:{eyebrow:"ADM-102 · INTÉGRATIONS",title:"Centre d’intégration",intro:"Références de configuration, santé et erreurs sans exposer de valeurs secrètes."},
    es:{eyebrow:"ADM-102 · INTEGRACIONES",title:"Integration Center",intro:"Referencias de configuración, salud operativa y errores sin revelar valores secretos."},
  },
  "audit-exports":{
    en:{eyebrow:"ADM-111 · AUDIT",title:"Signed audit exports",intro:"Asynchronous encrypted compliance exports with SHA-256 integrity, expiry and audited generation/download."},
    ar:{eyebrow:"ADM-111 · التدقيق",title:"تصدير تدقيق موقع",intro:"تصدير امتثال مشفر وغير متزامن مع SHA-256 وانتهاء صلاحية وتدقيق الإنشاء والتنزيل."},
    fr:{eyebrow:"ADM-111 · AUDIT",title:"Exports d’audit signés",intro:"Exports conformité asynchrones et chiffrés avec SHA-256, expiration et traçabilité des téléchargements."},
    es:{eyebrow:"ADM-111 · AUDITORÍA",title:"Exportaciones de auditoría firmadas",intro:"Exportaciones cifradas asíncronas con SHA-256, expiración y auditoría de generación/descarga."},
  },
  "clinical-operations":{
    en:{eyebrow:"ADM-112 · CONTINUITY",title:"Clinical continuity operations",intro:"Reproducible continuity KPIs across questionnaires, care plans, RPM alerts, lab results and orphan tasks."},
    ar:{eyebrow:"ADM-112 · الاستمرارية",title:"عمليات الاستمرارية السريرية",intro:"مؤشرات قابلة لإعادة الإنتاج للاستبيانات وخطط الرعاية وتنبيهات RPM والنتائج والمهام."},
    fr:{eyebrow:"ADM-112 · CONTINUITÉ",title:"Opérations de continuité clinique",intro:"KPI reproductibles pour questionnaires, plans, alertes RPM, résultats et tâches orphelines."},
    es:{eyebrow:"ADM-112 · CONTINUIDAD",title:"Operaciones de continuidad clínica",intro:"KPIs reproducibles de questionnaires, planes, alertas RPM, resultados y tareas huérfanas."},
  },
};

export function B6OperationsCenter({section}:{section:B6OperationsSection}) {
  const {locale}=useI18n();
  const c=copy[locale];
  const h=hero[section][locale];
  return <div className={styles.workspace}>
    <section className={styles.hero}><span>{h.eyebrow}</span><h2>{h.title}</h2><p>{h.intro}</p></section>
    {section==="duplicates"?<Duplicates c={c}/>:null}
    {section==="integrations"?<Integrations c={c}/>:null}
    {section==="audit-exports"?<AuditExports locale={locale} c={c}/>:null}
    {section==="clinical-operations"?<ClinicalOperations locale={locale} c={c}/>:null}
  </div>;
}

function Duplicates({c}:{c:Copy}) {
  const [data,setData]=useState<Row|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{setData(asRow(await api("/patient-duplicates?limit=150")));setError("");}catch(e){setError(message(e,c.failed));}finally{setLoading(false);}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  const items=list(data);
  return <><Toolbar c={c} loading={loading} error={error} load={load}/>
    <section className={styles.panel}>
      <div className={styles.notice}>{String(data?.algorithm??"DETERMINISTIC_IDENTITY_MATCH_V1")} · autoMerge=false</div>
      <Table headers={[c.patientA,c.patientB,c.score,c.reasons,c.review]}>
        {items.map(row=><tr key={String(row.id)}>
          <td><strong>{String(row.left?.displayName??"")}</strong><small>{String(row.left?.patientId??"")}</small></td>
          <td><strong>{String(row.right?.displayName??"")}</strong><small>{String(row.right?.patientId??"")}</small></td>
          <td>{String(row.score??"")}</td><td>{Array.isArray(row.reasons)?row.reasons.join(" · "):""}</td>
          <td><Link href={"/data-quality/merge?source="+encodeURIComponent(String(row.left?.patientId??""))+"&target="+encodeURIComponent(String(row.right?.patientId??""))}>{c.review}</Link></td>
        </tr>)}
      </Table>
      {!loading&&items.length===0?<p>{c.empty}</p>:null}
    </section></>;
}

function Integrations({c}:{c:Copy}) {
  const [data,setData]=useState<Row|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{setData(asRow(await api("/integrations")));setError("");}catch(e){setError(message(e,c.failed));}finally{setLoading(false);}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  const items=list(data);
  return <><Toolbar c={c} loading={loading} error={error} load={load}/>
    <section className={styles.panel}>
      <div className={styles.notice}>secretsExposed={String(data?.secretsExposed??false)}</div>
      <div className={styles.actions}>
        <Link href="/integrations/fhir">FHIR Gateway · ADM-103</Link>
        <Link href="/integrations/labs">External Labs · ADM-104</Link>
        <Link href="/integrations/devices">Device Integrations · ADM-105</Link>
      </div>
      <Table headers={[c.connector,c.health,c.configured,c.credentials,c.lastSync,c.lastError]}>
        {items.map(row=><tr key={String(row.key)}><td><strong>{String(row.label)}</strong><small>{String(row.key)}</small></td><td>{String(row.state)}</td><td>{row.configured?c.yes:c.no}</td><td>{Array.isArray(row.credentialReferences)&&row.credentialReferences.length?row.credentialReferences.join(" · "):"—"}</td><td>{fmt(row.lastSyncAt)}</td><td>{String(row.lastErrorCode??"—")}</td></tr>)}
      </Table>
    </section></>;
}

function AuditExports({locale,c}:{locale:Locale;c:Copy}) {
  const [items,setItems]=useState<Row[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{setItems(list(await api("/audit-exports?limit=50")));setError("");}catch(e){setError(message(e,c.failed));}finally{setLoading(false);}},[c.failed]);
  useEffect(()=>{void load();},[load]);

  async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);try{
    await api("/audit-exports",{method:"POST",body:{from:iso(fd.get("from")),to:iso(fd.get("to")),action:txt(fd,"action"),objectType:txt(fd,"objectType"),result:txt(fd,"result")}});
    e.currentTarget.reset();await load();
  }catch(err){setError(message(err,c.failed));}}

  async function download(row:Row){try{
    const grant=asRow(await api("/audit-exports/"+encodeURIComponent(String(row.id))+"/download-token",{method:"POST",body:{}}));
    const signed=String(grant.signedUrl??"");
    const prefix="/api/v1/admin/audit-exports/";
    if(!signed.startsWith(prefix)) throw new Error("Invalid signed export URL.");
    const proxy="/api/admin/b6/audit-exports/"+signed.slice(prefix.length);
    window.location.assign(proxy);
  }catch(err){setError(message(err,c.failed));}}

  return <><Toolbar c={c} loading={loading} error={error} load={load}/>
    <form className={styles.panel} onSubmit={create}>
      <div className={styles.grid2}>
        <Field name="from" label={c.from} type="datetime-local"/><Field name="to" label={c.to} type="datetime-local"/>
        <Field name="action" label={c.action}/><Field name="objectType" label={c.objectType}/><Field name="result" label={c.result}/>
      </div><button className={styles.primary}>{c.createExport}</button>
    </form>
    <section className={styles.panel}><Table headers={["ID",c.status,c.generated,c.expires,c.digest,c.download]}>
      {items.map(row=><tr key={String(row.id)}><td><small>{String(row.id)}</small></td><td>{String(row.status)}</td><td>{date(row.createdAt,locale)}</td><td>{date(row.expiresAt,locale)}</td><td><small>{String(row.contentDigest??"—")}</small></td><td>{row.status==="READY"?<button onClick={()=>void download(row)}>{c.download}</button>:"—"}</td></tr>)}
    </Table></section></>;
}

function ClinicalOperations({locale,c}:{locale:Locale;c:Copy}) {
  const [data,setData]=useState<Row|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{setData(asRow(await api("/clinical-operations?limit=50")));setError("");}catch(e){setError(message(e,c.failed));}finally{setLoading(false);}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  const k=asRow(data?.kpis), d=asRow(data?.drillDown), methods=asRow(data?.methodology);
  return <><Toolbar c={c} loading={loading} error={error} load={load}/>
    <section className={styles.metrics}><Metric label={c.questionnaires} value={Number(k.questionnairesOverdue??0)}/><Metric label={c.plans} value={Number(k.plansWithoutReview??0)}/><Metric label={c.alerts} value={Number(k.rpmAlertsOpen??0)}/><Metric label={c.results} value={Number(k.pendingResults??0)}/><Metric label={c.orphanTasks} value={Number(k.orphanTasks??0)}/></section>
    <section className={styles.panel}><h3>{c.methodology}</h3>{Object.entries(methods).map(([key,value])=><div key={key}><strong>{key}</strong><small>{String(value)}</small></div>)}</section>
    <section className={styles.panel}><h3>{c.plans}</h3><Table headers={["ID","Patient","Provider","Review"]}>{asList(d.plansWithoutReview).map(row=><tr key={String(row.id)}><td>{String(row.id)}</td><td>{String(row.patientId)}</td><td>{String(row.ownerProviderId)}</td><td>{date(row.reviewAt,locale)}</td></tr>)}</Table></section>
    <section className={styles.panel}><h3>{c.alerts}</h3><Table headers={["ID","Patient","Severity",c.status,c.generated]}>{asList(d.rpmAlerts).map(row=><tr key={String(row.id)}><td>{String(row.id)}</td><td>{String(row.patientId)}</td><td>{String(row.severity)}</td><td>{String(row.status)}</td><td>{date(row.createdAt,locale)}</td></tr>)}</Table></section>
    <section className={styles.panel}><h3>{c.results}</h3><Table headers={["Order","Patient","Provider",c.status]}>{asList(d.pendingResults).map(row=><tr key={String(row.id)}><td>{String(row.id)}</td><td>{String(row.patientId)}</td><td>{String(row.providerId)}</td><td>{String(row.labResult?.status??"NO_RESULT")}</td></tr>)}</Table></section>
    <section className={styles.panel}><h3>{c.orphanTasks}</h3><Table headers={["Task","Plan","Provider","Due"]}>{asList(d.orphanTasks).map(row=><tr key={String(row.id)}><td>{String(row.id)}</td><td>{String(row.carePlanId)}</td><td>{String(row.ownerProviderId)}</td><td>{date(row.dueAt,locale)}</td></tr>)}</Table></section>
  </>;
}

function Toolbar({c,loading,error,load}:{c:Copy;loading:boolean;error:string;load:()=>Promise<void>}){return <div className={styles.toolbar}><div>{loading?<span>{c.loading}</span>:null}{error?<span className={styles.notice}>{error}</span>:null}</div><button onClick={()=>void load()}>{c.refresh}</button></div>;}
function Metric({label,value}:{label:string;value:number}){return <article><span>{label}</span><strong>{value}</strong></article>;}
function Field({name,label,type="text"}:{name:string;label:string;type?:string}){return <label>{label}<input name={name} type={type}/></label>;}
function Table({headers,children}:{headers:string[];children:ReactNode}){return <div className={styles.tableWrap}><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}

async function api(path:string,options?:{method?:"POST";body?:unknown}) {
  const init:RequestInit={method:options?.method??"GET",cache:"no-store"};
  if(options?.body!==undefined){init.headers={"content-type":"application/json"};init.body=JSON.stringify(options.body);}
  const response=await fetch("/api/admin/b6"+path,init);
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof payload?.message==="string"?payload.message:"HTTP "+response.status);
  return payload;
}
function asRow(value:any):Row{return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function list(value:any):Row[]{return Array.isArray(value)?value.map(asRow):Array.isArray(value?.items)?value.items.map(asRow):[];}
function asList(value:any):Row[]{return Array.isArray(value)?value.map(asRow):[];}
function txt(fd:FormData,key:string){return String(fd.get(key)??"").trim()||undefined;}
function iso(value:FormDataEntryValue|null){const s=String(value??"").trim();if(!s)return undefined;const d=new Date(s);return Number.isFinite(d.getTime())?d.toISOString():undefined;}
function fmt(value:any){return value?String(value):"—";}
function date(value:any,locale:Locale){if(!value)return "—";const d=new Date(String(value));return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(d):"—";}
function message(value:unknown,fallback:string){return value instanceof Error?value.message:fallback;}
