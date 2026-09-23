"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./AlertPolicyManager.module.css";

type Labels={en?:string;ar?:string;fr?:string;es?:string};
type Metric={id:string;code:string;labels:Labels;active:boolean};
type PolicyConfig={
  schemaVersion:1;
  metricCodes:string[];
  severities:string[];
  patientActionKeys:string[];
  thresholdBounds:Array<{metricCode:string;min:number;max:number}>;
};
type PolicyVersion={id:string;version:number;status:"DRAFT"|"ACTIVE"|"RETIRED";config:PolicyConfig;activatedAt:string|null;retiredAt:string|null};
type Policy={id:string;code:string;labels:Labels;active:boolean;versions:PolicyVersion[]};
type PolicyPayload=Policy[]|{items?:Policy[];message?:string};
type MetricPayload={metrics?:Metric[];message?:string};

const severityOptions=["INFO","WARNING","CRITICAL"] as const;
const defaultActions=["REVIEW_CARE_PLAN","CONTACT_CARE_TEAM"] as const;

const copy={
  en:{notice:"Policies constrain professional alert rules. They do not diagnose, prescribe or generate thresholds automatically.",refresh:"Refresh",newPolicy:"New policy",code:"Code",labels:"Labels",create:"Create",versions:"Versions",newVersion:"New version",metrics:"Allowed metrics",severities:"Allowed severities",actions:"Patient action keys",bounds:"Safety threshold bounds",min:"Min",max:"Max",activate:"Activate",draft:"DRAFT",active:"ACTIVE",retired:"RETIRED",empty:"No alert policies configured.",select:"Select a policy",error:"Request failed.",version:"Version",addAction:"Add action key",actionHint:"Uppercase tokens, comma-separated"},
  ar:{notice:"تقيّد السياسات قواعد التنبيه المهنية ولا تشخّص أو تصف علاجاً أو تولّد حدوداً تلقائياً.",refresh:"تحديث",newPolicy:"سياسة جديدة",code:"الرمز",labels:"التسميات",create:"إنشاء",versions:"الإصدارات",newVersion:"إصدار جديد",metrics:"المقاييس المسموحة",severities:"درجات الشدة المسموحة",actions:"إجراءات المريض",bounds:"حدود الأمان",min:"الحد الأدنى",max:"الحد الأعلى",activate:"تفعيل",draft:"مسودة",active:"نشط",retired:"متقاعد",empty:"لا توجد سياسات تنبيه.",select:"اختر سياسة",error:"فشل الطلب.",version:"الإصدار",addAction:"إضافة مفتاح إجراء",actionHint:"رموز بأحرف كبيرة مفصولة بفواصل"},
  fr:{notice:"Les politiques encadrent les règles d’alerte professionnelles. Elles ne diagnostiquent pas et ne génèrent pas de seuils automatiquement.",refresh:"Actualiser",newPolicy:"Nouvelle politique",code:"Code",labels:"Libellés",create:"Créer",versions:"Versions",newVersion:"Nouvelle version",metrics:"Métriques autorisées",severities:"Sévérités autorisées",actions:"Actions patient",bounds:"Bornes de sécurité",min:"Min",max:"Max",activate:"Activer",draft:"BROUILLON",active:"ACTIVE",retired:"RETIRÉE",empty:"Aucune politique configurée.",select:"Sélectionner une politique",error:"Échec de la requête.",version:"Version",addAction:"Ajouter une action",actionHint:"Jetons majuscules séparés par des virgules"},
  es:{notice:"Las políticas limitan las reglas profesionales de alertas. No diagnostican, prescriben ni generan umbrales automáticamente.",refresh:"Actualizar",newPolicy:"Nueva política",code:"Código",labels:"Etiquetas",create:"Crear",versions:"Versiones",newVersion:"Nueva versión",metrics:"Métricas permitidas",severities:"Severidades permitidas",actions:"Acciones para paciente",bounds:"Límites de seguridad",min:"Mín",max:"Máx",activate:"Activar",draft:"BORRADOR",active:"ACTIVA",retired:"RETIRADA",empty:"No hay políticas configuradas.",select:"Selecciona una política",error:"La solicitud falló.",version:"Versión",addAction:"Añadir acción",actionHint:"Tokens en mayúsculas separados por comas"},
} as const;

function label(labels:Labels,locale:Locale,fallback:string){return labels?.[locale]?.trim()||labels?.en?.trim()||fallback}
function labels(en:string,ar:string,fr:string,es:string){return{en:en.trim(),ar:ar.trim(),fr:fr.trim(),es:es.trim()}}
function tokenList(raw:string){return [...new Set(raw.split(",").map(v=>v.trim().toUpperCase()).filter(Boolean))]}

export function AlertPolicyManager(){
  const {locale}=useI18n();const t=copy[locale];
  const [policies,setPolicies]=useState<Policy[]>([]);const [metrics,setMetrics]=useState<Metric[]>([]);
  const [selectedId,setSelectedId]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const [code,setCode]=useState("");const [en,setEn]=useState("");const [ar,setAr]=useState("");const [fr,setFr]=useState("");const [es,setEs]=useState("");
  const [metricCodes,setMetricCodes]=useState<Set<string>>(new Set());
  const [severities,setSeverities]=useState<Set<string>>(new Set(["WARNING","CRITICAL"]));
  const [actionKeys,setActionKeys]=useState("REVIEW_CARE_PLAN, CONTACT_CARE_TEAM");
  const [bounds,setBounds]=useState<Record<string,{min:string;max:string}>>({});

  const selected=useMemo(()=>policies.find(p=>p.id===selectedId)??null,[policies,selectedId]);

  const load=useCallback(async()=>{
    setError("");
    try{
      const [p,m]=await Promise.all([
        fetch("/api/admin/rpm/policies",{cache:"no-store"}),
        fetch("/api/admin/clinical-metrics",{cache:"no-store"}),
      ]);
      const pp=await p.json() as PolicyPayload;const mp=await m.json() as MetricPayload;
      if(!p.ok)throw new Error((pp as {message?:string}).message||t.error);
      if(!m.ok)throw new Error(mp.message||t.error);
      const next=Array.isArray(pp)?pp:(pp.items??[]);
      setPolicies(next);setMetrics((mp.metrics??[]).filter(item=>item.active));
      setSelectedId(current=>current||next[0]?.id||"");
    }catch(value){setError(value instanceof Error?value.message:t.error)}
  },[t.error]);
  useEffect(()=>{void load()},[load]);

  async function post(path:string,body:unknown){
    setBusy(true);setError("");
    try{
      const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json() as {message?:string};
      if(!response.ok)throw new Error(payload.message||t.error);
      await load();return true;
    }catch(value){setError(value instanceof Error?value.message:t.error);return false}
    finally{setBusy(false)}
  }

  async function createPolicy(){
    if(await post("/api/admin/rpm/policies",{code:code.trim().toUpperCase(),labels:labels(en,ar,fr,es)})){
      setCode("");setEn("");setAr("");setFr("");setEs("");
    }
  }

  function toggleMetric(metricCode:string,active:boolean){
    setMetricCodes(current=>{const next=new Set(current);active?next.add(metricCode):next.delete(metricCode);return next});
    setBounds(current=>active?{...current,[metricCode]:current[metricCode]??{min:"",max:""}}:Object.fromEntries(Object.entries(current).filter(([key])=>key!==metricCode)));
  }

  async function createVersion(){
    if(!selected)return;
    const metricList=[...metricCodes];
    const actionList=tokenList(actionKeys);
    const thresholdBounds=metricList.map(metricCode=>({
      metricCode,
      min:Number(bounds[metricCode]?.min),
      max:Number(bounds[metricCode]?.max),
    }));
    if(!metricList.length||!severities.size||!actionList.length||thresholdBounds.some(item=>!Number.isFinite(item.min)||!Number.isFinite(item.max)||item.max<=item.min)){
      setError(t.error);return;
    }
    await post(`/api/admin/rpm/policies/${encodeURIComponent(selected.id)}/versions`,{
      config:{metricCodes:metricList,severities:[...severities],patientActionKeys:actionList,thresholdBounds},
    });
  }

  async function activate(policyId:string,version:number){
    await post(`/api/admin/rpm/policies/${encodeURIComponent(policyId)}/versions/${version}/activate`,{});
  }

  return <div className={styles.stack}>
    <div className={styles.notice}>{t.notice}</div>
    {error?<div className={styles.error}>{error}</div>:null}
    <div className={styles.toolbar}><button disabled={busy} onClick={()=>void load()}>{t.refresh}</button></div>

    <div className={styles.grid}>
      <section className={styles.card}>
        <h2>{t.newPolicy}</h2>
        <div className={styles.form}>
          <input value={code} onChange={e=>setCode(e.target.value)} placeholder={t.code}/>
          <input value={en} onChange={e=>setEn(e.target.value)} placeholder="Label EN"/>
          <input value={ar} onChange={e=>setAr(e.target.value)} placeholder="Label AR"/>
          <input value={fr} onChange={e=>setFr(e.target.value)} placeholder="Label FR"/>
          <input value={es} onChange={e=>setEs(e.target.value)} placeholder="Label ES"/>
        </div>
        <button className={styles.primary} disabled={busy||!code.trim()||!en.trim()} onClick={()=>void createPolicy()}>{t.create}</button>
        <div className={styles.policyList}>
          {policies.map(policy=><button key={policy.id} className={selectedId===policy.id?styles.selected:styles.policy} onClick={()=>setSelectedId(policy.id)}>
            <strong>{label(policy.labels,locale,policy.code)}</strong><small>{policy.code} · {policy.versions.length} {t.versions}</small>
          </button>)}
          {!policies.length?<div className={styles.empty}>{t.empty}</div>:null}
        </div>
      </section>

      <section className={styles.card}>
        <h2>{selected?label(selected.labels,locale,selected.code):t.select}</h2>
        {selected?<div className={styles.versions}>
          {selected.versions.map(version=><div className={styles.version} key={version.id}>
            <div><strong>{t.version} {version.version}</strong><span data-state={version.status}>{version.status}</span></div>
            <small>{version.config.metricCodes.join(", ")} · {version.config.severities.join(", ")}</small>
            {version.status==="DRAFT"?<button disabled={busy} onClick={()=>void activate(selected.id,version.version)}>{t.activate}</button>:null}
          </div>)}
        </div>:null}
      </section>
    </div>

    {selected?<section className={styles.card}>
      <h2>{t.newVersion}</h2>
      <h3>{t.metrics}</h3>
      <div className={styles.metricGrid}>{metrics.map(metric=><label key={metric.id} className={styles.metric}>
        <input type="checkbox" checked={metricCodes.has(metric.code)} onChange={e=>toggleMetric(metric.code,e.target.checked)}/>
        <span><strong>{label(metric.labels,locale,metric.code)}</strong><small>{metric.code}</small></span>
        {metricCodes.has(metric.code)?<span className={styles.bound}>
          <input type="number" step="any" value={bounds[metric.code]?.min??""} onChange={e=>setBounds(current=>({...current,[metric.code]:{min:e.target.value,max:current[metric.code]?.max??""}}))} placeholder={t.min}/>
          <input type="number" step="any" value={bounds[metric.code]?.max??""} onChange={e=>setBounds(current=>({...current,[metric.code]:{min:current[metric.code]?.min??"",max:e.target.value}}))} placeholder={t.max}/>
        </span>:null}
      </label>)}</div>

      <h3>{t.severities}</h3>
      <div className={styles.checks}>{severityOptions.map(value=><label key={value}><input type="checkbox" checked={severities.has(value)} onChange={e=>setSeverities(current=>{const next=new Set(current);e.target.checked?next.add(value):next.delete(value);return next})}/>{value}</label>)}</div>

      <h3>{t.actions}</h3>
      <input className={styles.wideInput} value={actionKeys} onChange={e=>setActionKeys(e.target.value)} placeholder={t.actionHint}/>
      <div className={styles.hint}>{defaultActions.join(" · ")}</div>
      <button className={styles.primary} disabled={busy} onClick={()=>void createVersion()}>{t.create}</button>
    </section>:null}
  </div>;
}
