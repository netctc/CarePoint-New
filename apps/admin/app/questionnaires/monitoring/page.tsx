"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";

type Counts = {
  assigned:number; completed:number; pending:number; expired:number; abandoned:number; completionRatePct:number;
};
type Metrics = {
  generatedAt:string;
  filters:{from:string;to:string;source:string;questionnaireCode:string|null;abandonAfterHours:number};
  definitions:Record<string,string>;
  totals:Counts;
  sources:{TRIGGER:Counts;DOCTOR_REQUEST:Counts};
  breakdown:Array<{code:string}&Counts>;
  privacy:{patientIdentifiersIncluded:false;answerPayloadsIncluded:false;minBreakdownGroupSize:number;suppressedQuestionnaireGroups:number};
};
type Copy = {
  title:string;eyebrow:string;subtitle:string;period:string;source:string;all:string;trigger:string;doctor:string;code:string;
  reload:string;assigned:string;completed:string;pending:string;expired:string;abandoned:string;completion:string;
  breakdown:string;privacy:string;suppressed:string;definition:string;error:string;builder:string;
};
const copy:Record<Locale,Copy>={
  en:{title:"Questionnaire compliance monitor",eyebrow:"P1 · ADM-077",subtitle:"Aggregate operational completion metrics without reading questionnaire answers.",period:"Period",source:"Source",all:"All",trigger:"Automated triggers",doctor:"Doctor requests",code:"Questionnaire code",reload:"Reload",assigned:"Assigned",completed:"Completed",pending:"Pending",expired:"Expired",abandoned:"Abandoned",completion:"Completion",breakdown:"Questionnaire breakdown",privacy:"Privacy",suppressed:"Small questionnaire groups suppressed",definition:"Operational definitions",error:"Request failed.",builder:"Questionnaire Builder"},
  ar:{title:"مراقبة استكمال الاستبيانات",eyebrow:"P1 · ADM-077",subtitle:"مقاييس تشغيلية مجمعة دون قراءة إجابات الاستبيانات.",period:"الفترة",source:"المصدر",all:"الكل",trigger:"مشغلات آلية",doctor:"طلبات الطبيب",code:"رمز الاستبيان",reload:"تحديث",assigned:"مُسند",completed:"مكتمل",pending:"قيد الانتظار",expired:"منتهي",abandoned:"متروك",completion:"نسبة الإكمال",breakdown:"تفصيل الاستبيانات",privacy:"الخصوصية",suppressed:"تم إخفاء مجموعات الاستبيانات الصغيرة",definition:"تعريفات تشغيلية",error:"فشل الطلب.",builder:"منشئ الاستبيانات"},
  fr:{title:"Suivi de complétion des questionnaires",eyebrow:"P1 · ADM-077",subtitle:"Métriques opérationnelles agrégées sans lecture des réponses.",period:"Période",source:"Source",all:"Tous",trigger:"Déclencheurs automatiques",doctor:"Demandes médecin",code:"Code questionnaire",reload:"Actualiser",assigned:"Assignés",completed:"Terminés",pending:"En attente",expired:"Expirés",abandoned:"Abandonnés",completion:"Complétion",breakdown:"Détail par questionnaire",privacy:"Confidentialité",suppressed:"Petits groupes masqués",definition:"Définitions opérationnelles",error:"Échec de la requête.",builder:"Créateur de questionnaires"},
  es:{title:"Monitor de cumplimiento de cuestionarios",eyebrow:"P1 · ADM-077",subtitle:"Métricas operativas agregadas sin leer respuestas clínicas.",period:"Periodo",source:"Origen",all:"Todos",trigger:"Triggers automáticos",doctor:"Solicitudes del médico",code:"Código de cuestionario",reload:"Actualizar",assigned:"Asignados",completed:"Completados",pending:"Pendientes",expired:"Vencidos",abandoned:"Abandonados",completion:"Finalización",breakdown:"Desglose por cuestionario",privacy:"Privacidad",suppressed:"Grupos pequeños ocultados",definition:"Definiciones operativas",error:"Error en la solicitud.",builder:"Constructor de cuestionarios"}
};

const emptyCounts:Counts={assigned:0,completed:0,pending:0,expired:0,abandoned:0,completionRatePct:0};

export default function QuestionnaireMonitoringPage(){
  const {locale}=useI18n(), t=copy[locale];
  const [days,setDays]=useState(30);
  const [source,setSource]=useState("ALL");
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState("");
  const [data,setData]=useState<Metrics|null>(null);

  const range=useMemo(()=>{
    const to=new Date();
    const from=new Date(to.getTime()-days*86400000);
    return {from:from.toISOString(),to:to.toISOString()};
  },[days]);

  async function load(){
    setBusy(true);setError("");
    try{
      const params=new URLSearchParams({from:range.from,to:range.to,source});
      if(code.trim())params.set("questionnaireCode",code.trim().toUpperCase());
      const response=await fetch("/api/admin/questionnaires/metrics?"+params.toString(),{cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(typeof body?.message==="string"?body.message:t.error);
      setData(body as Metrics);
    }catch(value){setError(String(value));}
    finally{setBusy(false);}
  }
  useEffect(()=>{void load();},[range.from,range.to,source]);

  const totals=data?.totals??emptyCounts;
  const cards:Array<[string,string|number]>=[
    [t.assigned,totals.assigned],[t.completed,totals.completed],[t.pending,totals.pending],
    [t.expired,totals.expired],[t.abandoned,totals.abandoned],[t.completion,totals.completionRatePct.toFixed(2)+"%"],
  ];

  return <AppShell active="22" eyebrow={t.eyebrow} title={t.title}>
    <section className="notice-card">
      <div><span>{t.subtitle}</span><p>{error}</p></div>
      <a className="secondary-button" href="/questionnaires">{t.builder}</a>
    </section>

    <section style={{background:"#fff",border:"1px solid #dbe4ee",borderRadius:16,padding:16,display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:12}}>
      <label>{t.period}<select value={days} onChange={(event)=>setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option></select></label>
      <label>{t.source}<select value={source} onChange={(event)=>setSource(event.target.value)}><option value="ALL">{t.all}</option><option value="TRIGGER">{t.trigger}</option><option value="DOCTOR_REQUEST">{t.doctor}</option></select></label>
      <label>{t.code}<input value={code} onChange={(event)=>setCode(event.target.value)} placeholder="INTAKE_GENERAL"/></label>
      <button className="primary-button" onClick={()=>void load()} disabled={busy}>{t.reload}</button>
    </section>

    <section style={{display:"grid",gridTemplateColumns:"repeat(6,minmax(0,1fr))",gap:12,marginTop:16}}>
      {cards.map(([label,value])=><article key={label} style={{background:"#fff",border:"1px solid #dbe4ee",borderRadius:16,padding:16}}><small>{label}</small><strong style={{display:"block",fontSize:28,marginTop:8}}>{value}</strong></article>)}
    </section>

    <section style={{background:"#fff",border:"1px solid #dbe4ee",borderRadius:16,padding:16,marginTop:16}}>
      <h2>{t.breakdown}</h2>
      {busy?<p>Loading…</p>:<table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr><th>Code</th><th>{t.assigned}</th><th>{t.completed}</th><th>{t.pending}</th><th>{t.expired}</th><th>{t.abandoned}</th><th>{t.completion}</th></tr></thead>
        <tbody>{(data?.breakdown??[]).map((row)=><tr key={row.code}><td><strong>{row.code}</strong></td><td>{row.assigned}</td><td>{row.completed}</td><td>{row.pending}</td><td>{row.expired}</td><td>{row.abandoned}</td><td>{row.completionRatePct.toFixed(2)}%</td></tr>)}</tbody>
      </table>}
    </section>

    <section style={{background:"#f8fafc",border:"1px solid #dbe4ee",borderRadius:16,padding:16,marginTop:16}}>
      <h3>{t.privacy}</h3>
      <p>patientIdentifiersIncluded = {String(data?.privacy?.patientIdentifiersIncluded??false)} · answerPayloadsIncluded = {String(data?.privacy?.answerPayloadsIncluded??false)}</p>
      <p>{t.suppressed}: {data?.privacy?.suppressedQuestionnaireGroups??0} · minimum group: {data?.privacy?.minBreakdownGroupSize??3}</p>
      <h3>{t.definition}</h3>
      <ul>{Object.entries(data?.definitions??{}).map(([key,value])=><li key={key}><strong>{key}</strong>: {value}</li>)}</ul>
    </section>
  </AppShell>;
}
