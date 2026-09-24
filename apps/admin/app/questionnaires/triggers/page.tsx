"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";

type TriggerType = "ONBOARDING" | "PERIODIC" | "POST_INTERVENTION" | "PRE_VISIT" | "MANUAL";
type Labels = { en?: string; ar?: string; fr?: string; es?: string };
type TriggerVersion = {
  id:string; version:number; status:string; questionnaireVersionId:string; triggerType:TriggerType;
  config:Record<string,unknown>; lastSimulatedAt?:string|null; simulationDigest?:string|null;
};
type TriggerRule = { id:string; code:string; labels:Labels; active:boolean; versions:TriggerVersion[] };
type QuestionnaireVersion = { id:string; version:number; status:string };
type Questionnaire = { id:string; code:string; labels:Labels; versions:QuestionnaireVersion[] };

const TYPES:TriggerType[]=["ONBOARDING","PERIODIC","POST_INTERVENTION","PRE_VISIT","MANUAL"];
const copy:Record<Locale,Record<string,string>>={
  en:{title:"Questionnaire activation rules",eyebrow:"P0 · ADM-076",subtitle:"Simulate deterministic onboarding, periodic, intervention, pre-visit and manual triggers before activation.",rules:"Rules",newRule:"New rule",code:"Code",labels:"Labels",create:"Create rule",version:"Rule version",questionnaire:"Questionnaire version",type:"Trigger type",config:"Configuration",draft:"Create DRAFT version",simulate:"Simulate",activate:"Activate",simulation:"Simulation result",empty:"No trigger rules yet.",select:"Select a trigger rule.",reload:"Reload",saved:"Saved.",error:"Request failed.",immutable:"ACTIVE versions are immutable. A new activation retires the previous ACTIVE rule version.",dedupe:"Dispatches are deduplicated by rule version + patient + event.",manual:"Manual dispatch",patientId:"Patient ID",eventId:"Event ID",dispatch:"Dispatch",due:"Due"},
  ar:{title:"قواعد تفعيل الاستبيانات",eyebrow:"P0 · ADM-076",subtitle:"محاكاة قواعد بدء الاستخدام والدورية وما بعد التدخل وما قبل الزيارة والطلب اليدوي قبل التفعيل.",rules:"القواعد",newRule:"قاعدة جديدة",code:"الرمز",labels:"التسميات",create:"إنشاء القاعدة",version:"إصدار القاعدة",questionnaire:"إصدار الاستبيان",type:"نوع المشغل",config:"الإعدادات",draft:"إنشاء إصدار مسودة",simulate:"محاكاة",activate:"تفعيل",simulation:"نتيجة المحاكاة",empty:"لا توجد قواعد تفعيل.",select:"اختر قاعدة تفعيل.",reload:"تحديث",saved:"تم الحفظ.",error:"فشل الطلب.",immutable:"الإصدارات النشطة غير قابلة للتعديل، وتفعيل إصدار جديد يسحب السابق.",dedupe:"يتم منع التكرار حسب إصدار القاعدة والمريض والحدث.",manual:"تشغيل يدوي",patientId:"معرّف المريض",eventId:"معرّف الحدث",dispatch:"تشغيل",due:"الاستحقاق"},
  fr:{title:"Règles d’activation des questionnaires",eyebrow:"P0 · ADM-076",subtitle:"Simuler les déclencheurs onboarding, périodiques, post-intervention, pré-consultation et manuels avant activation.",rules:"Règles",newRule:"Nouvelle règle",code:"Code",labels:"Libellés",create:"Créer la règle",version:"Version de règle",questionnaire:"Version du questionnaire",type:"Type de déclencheur",config:"Configuration",draft:"Créer une version DRAFT",simulate:"Simuler",activate:"Activer",simulation:"Résultat de simulation",empty:"Aucune règle.",select:"Sélectionnez une règle.",reload:"Actualiser",saved:"Enregistré.",error:"Échec de la requête.",immutable:"Les versions ACTIVE sont immuables. Une nouvelle activation retire la précédente.",dedupe:"Les affectations sont dédupliquées par version de règle + patient + événement.",manual:"Déclenchement manuel",patientId:"ID patient",eventId:"ID événement",dispatch:"Déclencher",due:"Échéance"},
  es:{title:"Reglas de activación de cuestionarios",eyebrow:"P0 · ADM-076",subtitle:"Simula triggers de onboarding, periodicidad, post-intervención, preconsulta y manuales antes de activarlos.",rules:"Reglas",newRule:"Nueva regla",code:"Código",labels:"Etiquetas",create:"Crear regla",version:"Versión de regla",questionnaire:"Versión de cuestionario",type:"Tipo de trigger",config:"Configuración",draft:"Crear versión DRAFT",simulate:"Simular",activate:"Activar",simulation:"Resultado de simulación",empty:"No hay reglas.",select:"Selecciona una regla.",reload:"Actualizar",saved:"Guardado.",error:"Error en la solicitud.",immutable:"Las versiones ACTIVE son inmutables. Activar una nueva retira la ACTIVE anterior.",dedupe:"Las asignaciones se deduplican por versión de regla + paciente + evento.",manual:"Disparo manual",patientId:"ID de paciente",eventId:"ID de evento",dispatch:"Disparar",due:"Vencimiento"}
};

export default function QuestionnaireTriggersPage(){
  const {locale}=useI18n(), t=copy[locale];
  const [rules,setRules]=useState<TriggerRule[]>([]);
  const [questionnaires,setQuestionnaires]=useState<Questionnaire[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [message,setMessage]=useState("");
  const [definition,setDefinition]=useState({code:"",en:"",ar:"",fr:"",es:""});
  const [triggerType,setTriggerType]=useState<TriggerType>("ONBOARDING");
  const [questionnaireVersionId,setQuestionnaireVersionId]=useState("");
  const [n1,setN1]=useState("0"),[n2,setN2]=useState("30");
  const [simulation,setSimulation]=useState<unknown>(null);
  const [manual,setManual]=useState({patientId:"",eventId:""});
  const selected=useMemo(()=>rules.find((r)=>r.id===selectedId)??null,[rules,selectedId]);
  const activeQuestionnaireVersions=useMemo(()=>questionnaires.flatMap((q)=>q.versions.filter((v)=>v.status==="ACTIVE").map((v)=>({id:v.id,label:`${q.code} · v${v.version}`}))),[questionnaires]);

  useEffect(()=>{void load();},[]);
  useEffect(()=>{if(!questionnaireVersionId&&activeQuestionnaireVersions[0])setQuestionnaireVersionId(activeQuestionnaireVersions[0].id);},[activeQuestionnaireVersions,questionnaireVersionId]);

  async function request(url:string,init?:RequestInit){
    const response=await fetch(url,{cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(typeof body?.message==="string"?body.message:t.error);
    return body;
  }
  async function load(preferred?:string){
    try{
      const [a,b]=await Promise.all([request("/api/admin/questionnaire-triggers"),request("/api/admin/questionnaires")]);
      const next:TriggerRule[]=Array.isArray(a?.items)?a.items:[];
      setRules(next);setQuestionnaires(Array.isArray(b)?b:(Array.isArray(b?.items)?b.items:[]));
      setSelectedId((current)=>{const id=preferred||current;return id&&next.some((r)=>r.id===id)?id:(next[0]?.id??"");});
    }catch(error){setMessage(String(error));}
  }
  async function createRule(){
    try{
      const row=await request("/api/admin/questionnaire-triggers",{method:"POST",body:JSON.stringify({code:definition.code.trim().toUpperCase(),labels:{en:definition.en,ar:definition.ar,fr:definition.fr,es:definition.es}})});
      setDefinition({code:"",en:"",ar:"",fr:"",es:""});setMessage(t.saved);await load(row.id);
    }catch(error){setMessage(String(error));}
  }
  function config(){
    if(triggerType==="PERIODIC")return {intervalDays:Number(n1||30)};
    if(triggerType==="PRE_VISIT")return {leadHours:Number(n1||48),dueBeforeMinutes:Number(n2||30)};
    if(triggerType==="MANUAL")return {dueDays:Number(n1||7)};
    return {delayHours:Number(n1||0)};
  }
  async function createVersion(){
    if(!selected)return;
    try{
      await request(`/api/admin/questionnaire-triggers/${encodeURIComponent(selected.id)}/versions`,{method:"POST",body:JSON.stringify({questionnaireVersionId,triggerType,config:config()})});
      setMessage(t.saved);setSimulation(null);await load(selected.id);
    }catch(error){setMessage(String(error));}
  }
  async function simulate(version:TriggerVersion){
    if(!selected)return;
    const now=new Date(), body:Record<string,string>={eventType:version.triggerType,occurredAt:now.toISOString()};
    if(version.triggerType==="PRE_VISIT")body.appointmentStartsAt=new Date(now.getTime()+24*60*60*1000).toISOString();
    try{
      const result=await request(`/api/admin/questionnaire-triggers/${encodeURIComponent(selected.id)}/versions/${version.version}/simulate`,{method:"POST",body:JSON.stringify(body)});
      setSimulation(result);setMessage(t.saved);await load(selected.id);
    }catch(error){setMessage(String(error));}
  }
  async function activate(version:TriggerVersion){
    if(!selected)return;
    try{
      await request(`/api/admin/questionnaire-triggers/${encodeURIComponent(selected.id)}/versions/${version.version}/activate`,{method:"POST",body:"{}"});
      setMessage(t.saved);await load(selected.id);
    }catch(error){setMessage(String(error));}
  }
  async function dispatch(version:TriggerVersion){
    if(!selected)return;
    try{
      const result=await request(`/api/admin/questionnaire-triggers/${encodeURIComponent(selected.id)}/versions/${version.version}/manual-dispatch`,{method:"POST",body:JSON.stringify(manual)});
      setSimulation(result);setMessage(t.saved);
    }catch(error){setMessage(String(error));}
  }

  const box={background:"#fff",border:"1px solid #dbe4ee",borderRadius:16,padding:16} as const;
  const configLabels=triggerType==="PRE_VISIT"?["leadHours","dueBeforeMinutes"]:triggerType==="PERIODIC"?["intervalDays"]:triggerType==="MANUAL"?["dueDays"]:["delayHours"];

  return <AppShell active="23" title={t.title} eyebrow={t.eyebrow}>
    <section className="notice-card"><div><span>{t.subtitle}</span><p>{t.dedupe}</p><p>{message}</p></div><button className="secondary-button" onClick={()=>void load(selectedId)}>{t.reload}</button></section>
    <div style={{display:"grid",gridTemplateColumns:"minmax(260px,320px) 1fr",gap:18}}>
      <aside style={box}>
        <h3>{t.rules}</h3>{rules.length===0&&<p>{t.empty}</p>}
        {rules.map((rule)=><button key={rule.id} className={rule.id===selectedId?"primary-button":"secondary-button"} style={{display:"block",width:"100%",marginBottom:8,textAlign:"start"}} onClick={()=>setSelectedId(rule.id)}>{rule.labels?.[locale]||rule.labels?.en||rule.code}<br/><small>{rule.code}</small></button>)}
      </aside>
      <div style={{display:"grid",gap:18}}>
        <section style={box}><h2>{t.newRule}</h2>
          <label>{t.code}<input value={definition.code} onChange={(e)=>setDefinition({...definition,code:e.target.value})}/></label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>{(["en","ar","fr","es"] as const).map((lang)=><label key={lang}>{t.labels} {lang.toUpperCase()}<input value={definition[lang]} onChange={(e)=>setDefinition({...definition,[lang]:e.target.value})}/></label>)}</div>
          <button className="primary-button" onClick={()=>void createRule()}>{t.create}</button>
        </section>
        {!selected?<section style={box}>{t.select}</section>:<>
          <section style={box}><h2>{t.version} · {selected.code}</h2><p><small>{t.immutable}</small></p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <label>{t.questionnaire}<select value={questionnaireVersionId} onChange={(e)=>setQuestionnaireVersionId(e.target.value)}>{activeQuestionnaireVersions.map((v)=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
              <label>{t.type}<select value={triggerType} onChange={(e)=>{setTriggerType(e.target.value as TriggerType);setN1(e.target.value==="PERIODIC"?"30":e.target.value==="PRE_VISIT"?"48":e.target.value==="MANUAL"?"7":"0");}}>{TYPES.map((v)=><option key={v}>{v}</option>)}</select></label>
              <label>{t.config} · {configLabels[0]}<input inputMode="numeric" value={n1} onChange={(e)=>setN1(e.target.value)}/></label>
              {configLabels[1]&&<label>{t.config} · {configLabels[1]}<input inputMode="numeric" value={n2} onChange={(e)=>setN2(e.target.value)}/></label>}
            </div>
            <button className="primary-button" onClick={()=>void createVersion()} disabled={!questionnaireVersionId}>{t.draft}</button>
          </section>
          <section style={box}><h2>{t.rules}</h2>
            {[...(selected.versions??[])].sort((a,b)=>b.version-a.version).map((v)=><div key={v.id} style={{padding:"12px 0",borderTop:"1px solid #e2e8f0"}}>
              <strong>v{v.version} · {v.triggerType} · {v.status}</strong><p><small>{JSON.stringify(v.config)}</small></p>
              {v.lastSimulatedAt&&<p><small>{t.simulation}: {new Date(v.lastSimulatedAt).toLocaleString(locale)}</small></p>}
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {v.status==="DRAFT"&&<><button className="secondary-button" onClick={()=>void simulate(v)}>{t.simulate}</button><button className="primary-button" disabled={!v.lastSimulatedAt} onClick={()=>void activate(v)}>{t.activate}</button></>}
              </div>
              {v.status==="ACTIVE"&&v.triggerType==="MANUAL"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,marginTop:10}}><input placeholder={t.patientId} value={manual.patientId} onChange={(e)=>setManual({...manual,patientId:e.target.value})}/><input placeholder={t.eventId} value={manual.eventId} onChange={(e)=>setManual({...manual,eventId:e.target.value})}/><button className="secondary-button" onClick={()=>void dispatch(v)}>{t.dispatch}</button></div>}
            </div>)}
          </section>
          {simulation!=null&&<section style={{...box,background:"#f8fafc"}}><h3>{t.simulation}</h3><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(simulation,null,2)}</pre></section>}
        </>}
      </div>
    </div>
  </AppShell>;
}
