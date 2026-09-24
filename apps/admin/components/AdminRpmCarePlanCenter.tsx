"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./B6GovernanceCenter.module.css";

type Section = "rpm-dashboard" | "rpm-alerts" | "care-plan-templates";
type Row = Record<string, any>;

type Copy = {
  refresh:string; loading:string; failed:string; empty:string; status:string; metric:string; severity:string;
  owner:string; assignee:string; created:string; open:string; acknowledged:string; escalated:string; resolved:string;
  critical:string; privacy:string; template:string; code:string; english:string; arabic:string; french:string; spanish:string;
  create:string; select:string; version:string; activate:string; blueprint:string; clinicianReview:string; draftOnly:string;
  goals:string; tasks:string; noIdentity:string; active:string;
};

const copy:Record<Locale,Copy>={
  en:{refresh:"Refresh",loading:"Loading…",failed:"Request failed.",empty:"No records.",status:"Status",metric:"Metric",severity:"Severity",owner:"Owner provider",assignee:"Assignee",created:"Created",open:"Open",acknowledged:"Acknowledged",escalated:"Escalated",resolved:"Resolved",critical:"Critical open",privacy:"Aggregate operational view. Patient identity is not returned.",template:"Care Plan template",code:"Code",english:"English",arabic:"Arabic",french:"French",spanish:"Spanish",create:"Create",select:"Select",version:"Version",activate:"Activate",blueprint:"Validated goal/task blueprint JSON",clinicianReview:"Templates provide reusable structure only. A clinician must review and confirm before use for a patient.",draftOnly:"Only DRAFT versions can be activated; activating one retires the previous active version.",goals:"Goals",tasks:"Tasks",noIdentity:"Patient identity included",active:"Active"},
  ar:{refresh:"تحديث",loading:"جارٍ التحميل…",failed:"فشل الطلب.",empty:"لا توجد سجلات.",status:"الحالة",metric:"المقياس",severity:"الشدة",owner:"مقدم الخدمة المسؤول",assignee:"المكلّف",created:"تاريخ الإنشاء",open:"مفتوح",acknowledged:"تم الإقرار",escalated:"تم التصعيد",resolved:"تم الحل",critical:"حرج مفتوح",privacy:"عرض تشغيلي مجمع. لا يتم إرجاع هوية المريض.",template:"قالب خطة الرعاية",code:"الرمز",english:"الإنجليزية",arabic:"العربية",french:"الفرنسية",spanish:"الإسبانية",create:"إنشاء",select:"اختيار",version:"الإصدار",activate:"تفعيل",blueprint:"JSON مُتحقق لبنية الأهداف/المهام",clinicianReview:"القوالب توفر بنية قابلة لإعادة الاستخدام فقط، ويجب على المختص مراجعتها وتأكيدها قبل استخدامها للمريض.",draftOnly:"يمكن تفعيل إصدار DRAFT فقط؛ التفعيل يُحيل الإصدار النشط السابق إلى RETIRED.",goals:"الأهداف",tasks:"المهام",noIdentity:"هوية المريض مضمنة",active:"نشط"},
  fr:{refresh:"Actualiser",loading:"Chargement…",failed:"Échec de la requête.",empty:"Aucun enregistrement.",status:"Statut",metric:"Métrique",severity:"Sévérité",owner:"Prestataire responsable",assignee:"Assigné",created:"Créé",open:"Ouvert",acknowledged:"Acquitté",escalated:"Escaladé",resolved:"Résolu",critical:"Critique ouvert",privacy:"Vue opérationnelle agrégée. L’identité patient n’est pas retournée.",template:"Modèle de Care Plan",code:"Code",english:"Anglais",arabic:"Arabe",french:"Français",spanish:"Espagnol",create:"Créer",select:"Sélectionner",version:"Version",activate:"Activer",blueprint:"JSON validé des objectifs/tâches",clinicianReview:"Les modèles fournissent uniquement une structure réutilisable. Un clinicien doit les revoir et confirmer avant usage patient.",draftOnly:"Seules les versions DRAFT peuvent être activées; l’activation retire la version active précédente.",goals:"Objectifs",tasks:"Tâches",noIdentity:"Identité patient incluse",active:"Actif"},
  es:{refresh:"Actualizar",loading:"Cargando…",failed:"La solicitud falló.",empty:"Sin registros.",status:"Estado",metric:"Métrica",severity:"Severidad",owner:"Proveedor responsable",assignee:"Asignado",created:"Creado",open:"Abierta",acknowledged:"Reconocida",escalated:"Escalada",resolved:"Resuelta",critical:"Crítica abierta",privacy:"Vista operativa agregada. No se devuelve identidad del paciente.",template:"Plantilla de Care Plan",code:"Código",english:"Inglés",arabic:"Árabe",french:"Francés",spanish:"Español",create:"Crear",select:"Seleccionar",version:"Versión",activate:"Activar",blueprint:"JSON validado de objetivos/tareas",clinicianReview:"Las plantillas aportan únicamente estructura reutilizable. Un profesional debe revisarlas y confirmarlas antes de usarlas con un paciente.",draftOnly:"Solo versiones DRAFT pueden activarse; al activar una se retira la versión activa anterior.",goals:"Objetivos",tasks:"Tareas",noIdentity:"Identidad del paciente incluida",active:"Activa"},
};

const hero:Record<Section,Record<Locale,{eyebrow:string;title:string;intro:string}>>={
  "rpm-dashboard":{
    en:{eyebrow:"ADM-081 · RPM",title:"Remote monitoring operations",intro:"Aggregate RPM workload and alert-state counts without patient-level identity."},
    ar:{eyebrow:"ADM-081 · RPM",title:"عمليات المراقبة عن بُعد",intro:"حجم عمل RPM وحالات التنبيه بشكل مجمع دون هوية على مستوى المريض."},
    fr:{eyebrow:"ADM-081 · RPM",title:"Opérations de suivi à distance",intro:"Charge RPM agrégée et états d’alertes sans identité patient."},
    es:{eyebrow:"ADM-081 · RPM",title:"Operaciones de monitorización remota",intro:"Carga RPM y estados de alertas agregados sin identidad del paciente."},
  },
  "rpm-alerts":{
    en:{eyebrow:"ADM-082 · RPM",title:"Unreviewed alert queue",intro:"Open operational alerts ordered by server severity/age, with owner and assignment state but no patient identity."},
    ar:{eyebrow:"ADM-082 · RPM",title:"قائمة التنبيهات غير المراجعة",intro:"تنبيهات تشغيلية مفتوحة مرتبة من الخادم حسب الشدة/العمر مع المسؤول دون هوية المريض."},
    fr:{eyebrow:"ADM-082 · RPM",title:"File des alertes non revues",intro:"Alertes ouvertes ordonnées par sévérité/ancienneté côté serveur, avec responsable mais sans identité patient."},
    es:{eyebrow:"ADM-082 · RPM",title:"Cola de alertas sin revisar",intro:"Alertas abiertas ordenadas por severidad/antigüedad en servidor, con responsable pero sin identidad del paciente."},
  },
  "care-plan-templates":{
    en:{eyebrow:"ADM-083 · CARE PLANS",title:"Versioned Care Plan templates",intro:"Govern reusable goal/task blueprints while preserving clinician review before patient use."},
    ar:{eyebrow:"ADM-083 · خطط الرعاية",title:"قوالب خطط الرعاية ذات الإصدارات",intro:"إدارة بنى أهداف/مهام قابلة لإعادة الاستخدام مع بقاء مراجعة المختص إلزامية."},
    fr:{eyebrow:"ADM-083 · CARE PLANS",title:"Modèles de Care Plan versionnés",intro:"Gérez des objectifs/tâches réutilisables tout en imposant la revue du clinicien."},
    es:{eyebrow:"ADM-083 · CARE PLANS",title:"Plantillas versionadas de Care Plan",intro:"Gobierna objetivos/tareas reutilizables manteniendo la revisión profesional antes del uso."},
  },
};

export function AdminRpmCarePlanCenter({section}:{section:Section}) {
  const {locale}=useI18n(); const c=copy[locale]; const h=hero[section][locale];
  return <div className={styles.workspace}>
    <section className={styles.hero}><span>{h.eyebrow}</span><h2>{h.title}</h2><p>{h.intro}</p></section>
    {section==="rpm-dashboard"?<RpmDashboard locale={locale} c={c}/>:null}
    {section==="rpm-alerts"?<RpmAlerts locale={locale} c={c}/>:null}
    {section==="care-plan-templates"?<CarePlanTemplates locale={locale} c={c}/>:null}
  </div>;
}

function RpmDashboard({locale,c}:{locale:Locale;c:Copy}) {
  const [data,setData]=useState<Row|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{setData(asRow(await api("/rpm/workspace")));setError("");}catch(e){setError(message(e,c.failed));}finally{setLoading(false);}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  const counts=asRow(data?.counts);
  return <><Toolbar c={c} loading={loading} error={error} load={load}/>
    <div className={styles.notice}>{c.privacy} · aggregateOnly={String(data?.aggregateOnly===true)}</div>
    <section className={styles.statusGrid}>
      <Metric label={c.open} value={counts.open}/><Metric label={c.acknowledged} value={counts.acknowledged}/>
      <Metric label={c.escalated} value={counts.escalated}/><Metric label={c.resolved} value={counts.resolved}/>
      <Metric label={c.critical} value={counts.criticalOpen}/>
    </section>
    <section className={styles.panel}><small>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date())}</small><strong>{c.privacy}</strong></section>
  </>;
}

function RpmAlerts({locale,c}:{locale:Locale;c:Copy}) {
  const [items,setItems]=useState<Row[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{setItems(list(await api("/rpm/alerts")));setError("");}catch(e){setError(message(e,c.failed));}finally{setLoading(false);}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  return <><Toolbar c={c} loading={loading} error={error} load={load}/>
    <div className={styles.notice}>{c.privacy}</div>
    <section className={styles.panel}>
      <Table headers={["ID",c.severity,c.status,c.metric,c.owner,c.assignee,c.created,c.noIdentity]}>
        {items.map(row=><tr key={String(row.id)}>
          <td><small>{short(String(row.id))}</small></td><td>{String(row.severity??"")}</td><td>{String(row.status??"")}</td>
          <td>{String(row.metricCode??"")}</td><td><small>{short(String(row.ownerProviderId??""))}</small></td>
          <td><small>{row.assigneeProviderId?short(String(row.assigneeProviderId)):"—"}</small></td>
          <td>{date(row.createdAt,locale)}</td><td>{String(row.patientIdentityIncluded===true)}</td>
        </tr>)}
      </Table>
      {!loading&&items.length===0?<p>{c.empty}</p>:null}
    </section>
  </>;
}

const starterBlueprint=JSON.stringify({
  goals:[{metricCode:null,data:{kind:"QUALITATIVE",label:"Review agreed care goal",criterion:"Clinician confirms patient-specific target before activation"}}],
  tasks:[{assigneeType:"PATIENT",recurrence:{frequency:"DAILY",interval:1},data:{kind:"OTHER",label:"Complete agreed care task",instructions:"Clinician personalizes instructions before patient use"}}]
},null,2);

function CarePlanTemplates({locale,c}:{locale:Locale;c:Copy}) {
  const [items,setItems]=useState<Row[]>([]),[selectedId,setSelectedId]=useState<string|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{setItems(list(await api("/care-plan-templates")));setError("");}catch(e){setError(message(e,c.failed));}finally{setLoading(false);}},[c.failed]);
  useEffect(()=>{void load();},[load]);
  const selected=items.find(x=>String(x.id)===selectedId)??null;

  async function createDefinition(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);try{
    await api("/care-plan-templates",{method:"POST",body:{code:txt(fd,"code").toUpperCase(),labels:{en:txt(fd,"en"),ar:txt(fd,"ar"),fr:txt(fd,"fr"),es:txt(fd,"es")}}});
    e.currentTarget.reset();await load();
  }catch(err){setError(message(err,c.failed));}}

  async function createVersion(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!selected)return;const fd=new FormData(e.currentTarget);try{
    const schema=JSON.parse(txt(fd,"schema"));
    if(!schema||typeof schema!=="object"||Array.isArray(schema))throw new Error("Blueprint JSON must be an object.");
    await api("/care-plan-templates/"+encodeURIComponent(String(selected.id))+"/versions",{method:"POST",body:{schema}});
    await load();
  }catch(err){setError(message(err,c.failed));}}

  async function activate(templateId:string,version:number){try{
    await api("/care-plan-templates/"+encodeURIComponent(templateId)+"/versions/"+version+"/activate",{method:"POST",body:{}});
    await load();
  }catch(err){setError(message(err,c.failed));}}

  return <><Toolbar c={c} loading={loading} error={error} load={load}/>
    <div className={styles.notice}>{c.clinicianReview}</div>
    <div className={styles.columns}>
      <form className={styles.panel} onSubmit={createDefinition}>
        <h3>{c.create} · {c.template}</h3>
        <Field name="code" label={c.code} required/>
        <Field name="en" label={c.english} required/><Field name="ar" label={c.arabic} required/>
        <Field name="fr" label={c.french} required/><Field name="es" label={c.spanish} required/>
        <button className={styles.primary}>{c.create}</button>
      </form>
      <section className={styles.panel}>
        <h3>{c.template}</h3>
        <Table headers={[c.code,c.active,c.version,c.select]}>
          {items.map(row=>{const versions=asList(row.versions);const current=versions[0];return <tr key={String(row.id)}>
            <td><strong>{localized(row.labels,locale,String(row.code))}</strong><small>{String(row.code)}</small></td>
            <td>{String(row.active!==false)}</td><td>{current?"v"+String(current.version)+" · "+String(current.status):"—"}</td>
            <td><button onClick={()=>setSelectedId(String(row.id))}>{c.select}</button></td>
          </tr>;})}
        </Table>
      </section>
    </div>
    {selected?<div className={styles.columns}>
      <form className={styles.panel} onSubmit={createVersion}>
        <h3>{c.create} · {c.version} · {String(selected.code)}</h3>
        <label>{c.blueprint}<textarea name="schema" defaultValue={starterBlueprint} required/></label>
        <div className={styles.notice}>{c.clinicianReview}</div>
        <button className={styles.primary}>{c.create}</button>
      </form>
      <section className={styles.panel}>
        <h3>{String(selected.code)} · {c.version}</h3>
        <p>{c.draftOnly}</p>
        <Table headers={[c.version,c.status,c.goals,c.tasks,c.activate]}>
          {asList(selected.versions).map(v=>{const schema=asRow(v.schema);return <tr key={String(v.id)}>
            <td>{String(v.version)}</td><td>{String(v.status)}</td>
            <td>{String(asList(schema.goals).length)}</td><td>{String(asList(schema.tasks).length)}</td>
            <td>{v.status==="DRAFT"?<button onClick={()=>void activate(String(selected.id),Number(v.version))}>{c.activate}</button>:"—"}</td>
          </tr>;})}
        </Table>
      </section>
    </div>:null}
  </>;
}

function Toolbar({c,loading,error,load}:{c:Copy;loading:boolean;error:string;load:()=>Promise<void>}){return <div className={styles.toolbar}><div>{loading?<span>{c.loading}</span>:null}{error?<span className={styles.notice}>{error}</span>:null}</div><button onClick={()=>void load()}>{c.refresh}</button></div>;}
function Metric({label,value}:{label:string;value:any}){return <article><span>{label}</span><strong>{String(value??0)}</strong></article>;}
function Field({name,label,required=false}:{name:string;label:string;required?:boolean}){return <label>{label}<input name={name} required={required}/></label>;}
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
function asList(value:any):Row[]{return Array.isArray(value)?value.map(asRow):[];}
function list(value:any):Row[]{return Array.isArray(value)?value.map(asRow):Array.isArray(value?.items)?value.items.map(asRow):[];}
function txt(fd:FormData,key:string){return String(fd.get(key)??"").trim();}
function localized(value:any,locale:Locale,fallback:string){const row=asRow(value);return String(row[locale]??row.en??fallback);}
function short(value:string){return value.length>14?value.slice(0,8)+"…"+value.slice(-4):value;}
function date(value:any,locale:Locale){if(!value)return "—";const d=new Date(String(value));return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(d):"—";}
function message(value:unknown,fallback:string){return value instanceof Error?value.message:fallback;}
