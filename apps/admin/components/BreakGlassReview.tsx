"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./BreakGlassReview.module.css";

type Grant = {
  id:string; patientId:string; providerId:string; actorId:string; scope:string; purpose:string; reasonCode:string;
  status:string; ttlMinutes:number; grantedAt:string; expiresAt:string; revokedAt:string|null; reviewStatus:string;
  reviewedAt:string|null; reviewOutcome:string|null;
  accessSummary:{accessed:boolean;usageCount:number;firstUsedAt:string|null;lastUsedAt:string|null;accessedScopes:string[]};
};
type Draft={outcome:string;reasonCode:string};
type Copy={intro:string;pending:string;reviewed:string;refresh:string;loading:string;empty:string;patient:string;provider:string;scope:string;reason:string;ttl:string;granted:string;expires:string;usage:string;neverUsed:string;usedTimes:string;lastUsed:string;review:string;failed:string;appropriate:string;inappropriate:string;followUp:string};

const copy:Record<Locale,Copy>={
  en:{intro:"Review every governed break-glass grant, its bounded duration and audited use before closing the security exception.",pending:"Pending review",reviewed:"Reviewed",refresh:"Refresh",loading:"Loading…",empty:"No grants in this queue.",patient:"Patient",provider:"Provider",scope:"Scope",reason:"Reason",ttl:"TTL",granted:"Granted",expires:"Expires",usage:"Audited use",neverUsed:"Not used",usedTimes:"uses",lastUsed:"Last use",review:"Close review",failed:"Emergency-access review failed.",appropriate:"Appropriate",inappropriate:"Inappropriate",followUp:"Needs follow-up"},
  ar:{intro:"راجع كل صلاحية وصول طارئ محكومة ومدتها المحدودة واستخدامها المدقق قبل إغلاق الاستثناء الأمني.",pending:"بانتظار المراجعة",reviewed:"تمت المراجعة",refresh:"تحديث",loading:"جارٍ التحميل…",empty:"لا توجد صلاحيات في هذه القائمة.",patient:"المريض",provider:"مقدم الخدمة",scope:"النطاق",reason:"السبب",ttl:"المدة",granted:"تاريخ المنح",expires:"الانتهاء",usage:"الاستخدام المدقق",neverUsed:"لم تُستخدم",usedTimes:"استخدامات",lastUsed:"آخر استخدام",review:"إغلاق المراجعة",failed:"فشلت مراجعة الوصول الطارئ.",appropriate:"مناسب",inappropriate:"غير مناسب",followUp:"يحتاج متابعة"},
  fr:{intro:"Examinez chaque accès d’urgence gouverné, sa durée limitée et son usage audité avant de clôturer l’exception de sécurité.",pending:"À revoir",reviewed:"Révisés",refresh:"Actualiser",loading:"Chargement…",empty:"Aucun accès dans cette file.",patient:"Patient",provider:"Prestataire",scope:"Périmètre",reason:"Motif",ttl:"TTL",granted:"Accordé",expires:"Expire",usage:"Usage audité",neverUsed:"Non utilisé",usedTimes:"utilisations",lastUsed:"Dernier usage",review:"Clôturer la revue",failed:"Échec de la revue d’accès d’urgence.",appropriate:"Approprié",inappropriate:"Inapproprié",followUp:"Suivi requis"},
  es:{intro:"Revisa cada acceso break-glass gobernado, su duración limitada y su uso auditado antes de cerrar la excepción de seguridad.",pending:"Pendientes",reviewed:"Revisados",refresh:"Actualizar",loading:"Cargando…",empty:"No hay grants en esta cola.",patient:"Paciente",provider:"Proveedor",scope:"Ámbito",reason:"Motivo",ttl:"TTL",granted:"Concedido",expires:"Expira",usage:"Uso auditado",neverUsed:"No utilizado",usedTimes:"usos",lastUsed:"Último uso",review:"Cerrar revisión",failed:"Falló la revisión del acceso de emergencia.",appropriate:"Apropiado",inappropriate:"Inapropiado",followUp:"Requiere seguimiento"}
};

const reasons=["POLICY_CONFORMANT","PATIENT_SAFETY_JUSTIFIED","INSUFFICIENT_JUSTIFICATION","SCOPE_EXCESSIVE","FOLLOW_UP_REQUIRED"];

export function BreakGlassReview(){
  const {locale}=useI18n(); const c=copy[locale];
  const [status,setStatus]=useState<"PENDING"|"REVIEWED">("PENDING");
  const [items,setItems]=useState<Grant[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const [drafts,setDrafts]=useState<Record<string,Draft>>({}); const [busy,setBusy]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");try{const r=await fetch(`/api/admin/break-glass?status=${status}`,{cache:"no-store"});const p=await r.json();if(!r.ok)throw new Error(p?.message||`HTTP ${r.status}`);setItems(Array.isArray(p?.items)?p.items:[]);}catch(e){setError(e instanceof Error?e.message:c.failed);}finally{setLoading(false);}},[status,c.failed]);
  useEffect(()=>{void load();},[load]);

  function draft(id:string):Draft{return drafts[id]??{outcome:"APPROPRIATE",reasonCode:"POLICY_CONFORMANT"};}
  async function review(id:string){const d=draft(id);setBusy(id);setError("");try{const r=await fetch(`/api/admin/break-glass/${encodeURIComponent(id)}/review`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(typeof p.message==="string"?p.message:`HTTP ${r.status}`);await load();}catch(e){setError(e instanceof Error?e.message:c.failed);}finally{setBusy("");}}
  const tag=locale==="ar"?"ar-SA":locale==="fr"?"fr-FR":locale==="es"?"es-ES":"en-US"; const dt=(v:string|null)=>v?new Intl.DateTimeFormat(tag,{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";
  return <div className={styles.workspace}>
    <section className={styles.hero}><div><h2>Break-glass · ADM-094</h2><p>{c.intro}</p></div><button onClick={()=>void load()} disabled={loading}>{c.refresh}</button></section>
    <div className={styles.tabs}><button className={status==="PENDING"?styles.active:""} onClick={()=>setStatus("PENDING")}>{c.pending}</button><button className={status==="REVIEWED"?styles.active:""} onClick={()=>setStatus("REVIEWED")}>{c.reviewed}</button></div>
    {error?<div className={styles.error}>{error}</div>:null}
    {loading?<div>{c.loading}</div>:items.length===0?<div className={styles.empty}>{c.empty}</div>:<section className={styles.grid}>{items.map(g=>{const d=draft(g.id);return <article className={styles.card} key={g.id}>
      <div className={styles.top}><div><strong>{g.id}</strong><small>{g.reviewStatus} · {g.reasonCode}</small></div><span className={styles.status}>{g.status}</span></div>
      <div className={styles.facts}><span><b>{c.patient}</b>{g.patientId}</span><span><b>{c.provider}</b>{g.providerId}</span><span><b>{c.scope}</b>{g.scope}</span><span><b>{c.ttl}</b>{g.ttlMinutes} min</span><span><b>{c.granted}</b>{dt(g.grantedAt)}</span><span><b>{c.expires}</b>{dt(g.expiresAt)}</span></div>
      <div className={styles.usage}><b>{c.usage}</b>{g.accessSummary?.accessed?<><span>{g.accessSummary.usageCount} {c.usedTimes}</span><small>{c.lastUsed}: {dt(g.accessSummary.lastUsedAt)}</small></>:<span>{c.neverUsed}</span>}</div>
      {g.reviewStatus==="PENDING"?<div className={styles.review}>
        <select value={d.outcome} onChange={e=>setDrafts(s=>({...s,[g.id]:{...d,outcome:e.target.value}}))}><option value="APPROPRIATE">{c.appropriate}</option><option value="INAPPROPRIATE">{c.inappropriate}</option><option value="NEEDS_FOLLOW_UP">{c.followUp}</option></select>
        <select value={d.reasonCode} onChange={e=>setDrafts(s=>({...s,[g.id]:{...d,reasonCode:e.target.value}}))}>{reasons.map(r=><option key={r} value={r}>{r.replaceAll("_"," ")}</option>)}</select>
        <button onClick={()=>void review(g.id)} disabled={busy!==""}>{busy===g.id?"…":c.review}</button>
      </div>:<div>{g.reviewOutcome??"REVIEWED"} · {dt(g.reviewedAt)}</div>}
    </article>;})}</section>}
  </div>;
}
