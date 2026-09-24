"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";

type Labels = { en?: string; ar?: string; fr?: string; es?: string };
type QuestionType = "BOOLEAN" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "NUMBER" | "TEXT" | "DATE";
type Version = {
  id: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED" | string;
  schema: unknown;
  activationRules?: unknown;
  activatedAt?: string | null;
  retiredAt?: string | null;
  createdAt?: string;
};
type Questionnaire = {
  id: string;
  code: string;
  labels: Labels;
  descriptionLabels?: Labels | null;
  active: boolean;
  versions: Version[];
};
type BuilderQuestion = {
  id: string;
  type: QuestionType;
  required: boolean;
  en: string;
  ar: string;
  fr: string;
  es: string;
  options: string;
  min: string;
  max: string;
  maxLength: string;
};
type Copy = Record<
  | "title" | "eyebrow" | "subtitle" | "definitions" | "newDefinition" | "code" | "labels"
  | "description" | "create" | "builder" | "questions" | "addQuestion" | "required" | "options"
  | "activation" | "dueIfNoResponse" | "repeatDays" | "askHealthChanged" | "preview" | "draft"
  | "versions" | "activate" | "active" | "retired" | "empty" | "select" | "reload" | "saved"
  | "error" | "remove" | "immutableHint" | "noVersion" | "schemaVersion",
  string
>;

const TYPES: QuestionType[] = ["BOOLEAN","SINGLE_CHOICE","MULTI_CHOICE","NUMBER","TEXT","DATE"];

const copy: Record<Locale, Copy> = {
  en: {
    title:"Questionnaire Builder", eyebrow:"P0 · ADM-074 / ADM-075", subtitle:"Build validated questionnaire schemas and publish immutable versions.",
    definitions:"Questionnaires", newDefinition:"New questionnaire", code:"Code", labels:"Labels", description:"Description",
    create:"Create definition", builder:"Version builder", questions:"Questions", addQuestion:"Add question", required:"Required",
    options:"Choice options", activation:"Activation rules", dueIfNoResponse:"Due when no prior response", repeatDays:"Repeat every N days",
    askHealthChanged:"Ask health-changed confirmation", preview:"Preview", draft:"Create DRAFT version", versions:"Version history",
    activate:"Activate", active:"ACTIVE", retired:"RETIRED", empty:"No questionnaires yet.", select:"Select a questionnaire to build a version.",
    reload:"Reload", saved:"Saved.", error:"Request failed.", remove:"Remove", immutableHint:"DRAFT versions are validated server-side. Activating a version retires the previous ACTIVE version; historical responses remain pinned to their original version.",
    noVersion:"No versions", schemaVersion:"Schema v1"
  },
  ar: {
    title:"منشئ الاستبيانات", eyebrow:"P0 · ADM-074 / ADM-075", subtitle:"إنشاء مخططات استبيان مُتحقق منها ونشر إصدارات غير قابلة للتغيير.",
    definitions:"الاستبيانات", newDefinition:"استبيان جديد", code:"الرمز", labels:"التسميات", description:"الوصف",
    create:"إنشاء التعريف", builder:"منشئ الإصدار", questions:"الأسئلة", addQuestion:"إضافة سؤال", required:"إلزامي",
    options:"خيارات الاختيار", activation:"قواعد التفعيل", dueIfNoResponse:"مستحق عند عدم وجود استجابة سابقة", repeatDays:"التكرار كل N يوم",
    askHealthChanged:"طلب تأكيد تغيّر الحالة الصحية", preview:"معاينة", draft:"إنشاء إصدار مسودة", versions:"سجل الإصدارات",
    activate:"تفعيل", active:"نشط", retired:"متقاعد", empty:"لا توجد استبيانات.", select:"اختر استبياناً لبناء إصدار.",
    reload:"تحديث", saved:"تم الحفظ.", error:"فشل الطلب.", remove:"إزالة", immutableHint:"يتم التحقق من إصدارات المسودة على الخادم. تفعيل إصدار جديد يسحب الإصدار النشط السابق مع بقاء الاستجابات التاريخية مرتبطة بإصدارها الأصلي.",
    noVersion:"لا توجد إصدارات", schemaVersion:"المخطط v1"
  },
  fr: {
    title:"Créateur de questionnaires", eyebrow:"P0 · ADM-074 / ADM-075", subtitle:"Construire des schémas validés et publier des versions immuables.",
    definitions:"Questionnaires", newDefinition:"Nouveau questionnaire", code:"Code", labels:"Libellés", description:"Description",
    create:"Créer la définition", builder:"Créateur de version", questions:"Questions", addQuestion:"Ajouter une question", required:"Obligatoire",
    options:"Options de choix", activation:"Règles d’activation", dueIfNoResponse:"Échéance sans réponse précédente", repeatDays:"Répéter tous les N jours",
    askHealthChanged:"Demander la confirmation d’un changement de santé", preview:"Aperçu", draft:"Créer une version BROUILLON", versions:"Historique des versions",
    activate:"Activer", active:"ACTIVE", retired:"RETIRÉE", empty:"Aucun questionnaire.", select:"Sélectionnez un questionnaire pour construire une version.",
    reload:"Actualiser", saved:"Enregistré.", error:"Échec de la requête.", remove:"Supprimer", immutableHint:"Les versions DRAFT sont validées côté serveur. L’activation retire l’ancienne version ACTIVE; les réponses historiques restent liées à leur version d’origine.",
    noVersion:"Aucune version", schemaVersion:"Schéma v1"
  },
  es: {
    title:"Constructor de cuestionarios", eyebrow:"P0 · ADM-074 / ADM-075", subtitle:"Construye schemas validados y publica versiones inmutables.",
    definitions:"Cuestionarios", newDefinition:"Nuevo cuestionario", code:"Código", labels:"Etiquetas", description:"Descripción",
    create:"Crear definición", builder:"Constructor de versión", questions:"Preguntas", addQuestion:"Añadir pregunta", required:"Obligatorio",
    options:"Opciones de elección", activation:"Reglas de activación", dueIfNoResponse:"Pendiente si no hay respuesta previa", repeatDays:"Repetir cada N días",
    askHealthChanged:"Preguntar si cambió la salud", preview:"Vista previa", draft:"Crear versión DRAFT", versions:"Historial de versiones",
    activate:"Activar", active:"ACTIVE", retired:"RETIRADA", empty:"No hay cuestionarios.", select:"Selecciona un cuestionario para construir una versión.",
    reload:"Actualizar", saved:"Guardado.", error:"Error en la solicitud.", remove:"Eliminar", immutableHint:"Las versiones DRAFT se validan en servidor. Activar una versión retira la ACTIVE anterior; las respuestas históricas siguen vinculadas a su versión original.",
    noVersion:"Sin versiones", schemaVersion:"Schema v1"
  },
};

function blankQuestion(): BuilderQuestion {
  return { id:"", type:"TEXT", required:false, en:"", ar:"", fr:"", es:"", options:"", min:"", max:"", maxLength:"2000" };
}

export default function QuestionnairesPage() {
  const { locale } = useI18n();
  const t = copy[locale];
  const [items,setItems] = useState<Questionnaire[]>([]);
  const [selectedId,setSelectedId] = useState("");
  const [busy,setBusy] = useState(true);
  const [message,setMessage] = useState("");
  const [definition,setDefinition] = useState({ code:"", en:"", ar:"", fr:"", es:"", descEn:"", descAr:"", descFr:"", descEs:"" });
  const [questions,setQuestions] = useState<BuilderQuestion[]>([blankQuestion()]);
  const [dueIfNoResponse,setDueIfNoResponse] = useState(true);
  const [repeatDays,setRepeatDays] = useState("");
  const [askHealthChanged,setAskHealthChanged] = useState(true);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null,[items,selectedId]);

  useEffect(() => { void load(); }, []);

  async function request(url:string, init?:RequestInit) {
    const response = await fetch(url, {
      cache:"no-store",
      ...init,
      headers:{ "content-type":"application/json", ...(init?.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(typeof body?.message === "string" ? body.message : t.error);
    return body;
  }

  async function load(preferredId?:string) {
    setBusy(true);
    try {
      const body=await request("/api/admin/questionnaires");
      const next:Questionnaire[] = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      setItems(next);
      setSelectedId((current) => {
        const candidate=preferredId || current;
        return candidate && next.some((item)=>item.id===candidate) ? candidate : (next[0]?.id ?? "");
      });
    } catch(error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }

  function labels(prefix:""|"desc") {
    const values: Record<"en"|"ar"|"fr"|"es", string> = prefix === ""
      ? { en:definition.en, ar:definition.ar, fr:definition.fr, es:definition.es }
      : { en:definition.descEn, ar:definition.descAr, fr:definition.descFr, es:definition.descEs };
    const output:Labels={};
    (["en","ar","fr","es"] as const).forEach((lang) => {
      const value=values[lang].trim();
      if(value) output[lang]=value;
    });
    return output;
  }

  async function createDefinition() {
    try {
      const created=await request("/api/admin/questionnaires",{
        method:"POST",
        body:JSON.stringify({
          code:definition.code.trim().toUpperCase(),
          labels:labels(""),
          ...(definition.descEn.trim() ? { descriptionLabels:labels("desc") } : {}),
        }),
      });
      setDefinition({ code:"", en:"", ar:"", fr:"", es:"", descEn:"", descAr:"", descFr:"", descEs:"" });
      setMessage(t.saved);
      await load(created?.id);
    } catch(error) { setMessage(String(error)); }
  }

  function buildSchema() {
    return {
      schemaVersion:1,
      questions:questions.map((q) => {
        const output:Record<string,unknown>={
          id:q.id.trim(),
          type:q.type,
          required:q.required,
          labels:{
            en:q.en.trim(),
            ...(q.ar.trim()?{ar:q.ar.trim()}:{}),
            ...(q.fr.trim()?{fr:q.fr.trim()}:{}),
            ...(q.es.trim()?{es:q.es.trim()}:{}),
          },
        };
        if(q.type==="SINGLE_CHOICE" || q.type==="MULTI_CHOICE") {
          output.options=q.options.split("\n").map((line)=>line.trim()).filter(Boolean).map((line)=>{
            const [value,en,ar,fr,es]=line.split("|").map((part)=>part.trim());
            return { value, labels:{ en:en || value, ...(ar?{ar}:{}), ...(fr?{fr}:{}), ...(es?{es}:{}) } };
          });
        }
        if(q.type==="NUMBER") {
          if(q.min.trim()) output.min=Number(q.min);
          if(q.max.trim()) output.max=Number(q.max);
        }
        if(q.type==="TEXT" && q.maxLength.trim()) output.maxLength=Number(q.maxLength);
        return output;
      }),
    };
  }

  async function createVersion() {
    if(!selected) return;
    const rules:Record<string,unknown>={ dueIfNoResponse, askHealthChanged };
    if(repeatDays.trim()) rules.repeatDays=Number(repeatDays);
    try {
      await request("/api/admin/questionnaires/"+encodeURIComponent(selected.id)+"/versions",{
        method:"POST",
        body:JSON.stringify({ schema:buildSchema(), activationRules:rules }),
      });
      setMessage(t.saved);
      await load(selected.id);
    } catch(error) { setMessage(String(error)); }
  }

  async function activate(version:number) {
    if(!selected) return;
    try {
      await request("/api/admin/questionnaires/"+encodeURIComponent(selected.id)+"/versions/"+version+"/activate",{
        method:"POST", body:"{}",
      });
      setMessage(t.saved);
      await load(selected.id);
    } catch(error) { setMessage(String(error)); }
  }

  const box={background:"#fff",border:"1px solid #dbe4ee",borderRadius:16,padding:16} as const;
  const grid={display:"grid",gap:12} as const;
  const sortedVersions=selected ? [...(selected.versions ?? [])].sort((a,b)=>b.version-a.version) : [];

  return <AppShell active="22" eyebrow={t.eyebrow} title={t.title}>
    <section className="notice-card">
      <div><span>{t.subtitle}</span><p>{message}</p></div>
      <button className="secondary-button" onClick={()=>void load(selectedId)}>{t.reload}</button>
    </section>

    {busy ? <p>Loading…</p> : <div style={{display:"grid",gridTemplateColumns:"minmax(240px,300px) 1fr",gap:18}}>
      <aside style={{...box,...grid,alignContent:"start"}}>
        <h3>{t.definitions}</h3>
        {items.length===0 && <p>{t.empty}</p>}
        {items.map((item)=><button
          key={item.id}
          className={item.id===selectedId?"primary-button":"secondary-button"}
          onClick={()=>setSelectedId(item.id)}
          style={{textAlign:"start"}}
        >{(item.labels?.[locale] || item.labels?.en || item.code) as string}<br/><small>{item.code}</small></button>)}
      </aside>

      <div style={grid}>
        <section style={box}>
          <h2>{t.newDefinition}</h2>
          <div style={{...grid,gridTemplateColumns:"1fr 1fr"}}>
            <label>{t.code}<input value={definition.code} onChange={(e)=>setDefinition({...definition,code:e.target.value})} placeholder="INTAKE_GENERAL"/></label>
            <div/>
          </div>
          <div style={{...grid,gridTemplateColumns:"repeat(4,1fr)"}}>
            {(["en","ar","fr","es"] as const).map((lang)=><label key={lang}>{t.labels} {lang.toUpperCase()}<input value={definition[lang]} onChange={(e)=>setDefinition({...definition,[lang]:e.target.value})}/></label>)}
          </div>
          <div style={{...grid,gridTemplateColumns:"repeat(4,1fr)"}}>
            {(["en","ar","fr","es"] as const).map((lang)=>{
              const key = ({ en:"descEn", ar:"descAr", fr:"descFr", es:"descEs" } as const)[lang];
              return <label key={lang}>{t.description} {lang.toUpperCase()}<input value={definition[key]} onChange={(e)=>setDefinition({...definition,[key]:e.target.value})}/></label>;
            })}
          </div>
          <button className="primary-button" onClick={()=>void createDefinition()}>{t.create}</button>
        </section>

        {!selected ? <section style={box}><p>{t.select}</p></section> : <>
          <section style={box}>
            <h2>{t.builder} · {selected.code}</h2>
            <p><small>{t.immutableHint}</small></p>
            <h3>{t.questions}</h3>
            {questions.map((q,index)=><QuestionEditor
              key={index}
              question={q}
              index={index}
              locale={locale}
              t={t}
              onChange={(next)=>setQuestions((current)=>current.map((item,i)=>i===index?next:item))}
              onRemove={()=>setQuestions((current)=>current.filter((_,i)=>i!==index))}
              canRemove={questions.length>1}
            />)}
            <button className="secondary-button" onClick={()=>setQuestions((current)=>[...current,blankQuestion()])}>{t.addQuestion}</button>

            <h3>{t.activation}</h3>
            <div style={{...grid,gridTemplateColumns:"1fr 1fr 1fr"}}>
              <label><input type="checkbox" checked={dueIfNoResponse} onChange={(e)=>setDueIfNoResponse(e.target.checked)}/> {t.dueIfNoResponse}</label>
              <label>{t.repeatDays}<input inputMode="numeric" value={repeatDays} onChange={(e)=>setRepeatDays(e.target.value)} placeholder="30"/></label>
              <label><input type="checkbox" checked={askHealthChanged} onChange={(e)=>setAskHealthChanged(e.target.checked)}/> {t.askHealthChanged}</label>
            </div>

            <div style={{marginTop:16,...box,background:"#f8fafc"}}>
              <h3>{t.preview} · {t.schemaVersion}</h3>
              {questions.map((q,index)=><div key={q.id || `preview-${index}`} style={{padding:"8px 0",borderTop:"1px solid #e2e8f0"}}>
                <strong>{q.en || q.id || "Untitled"}</strong> <small>· {q.type} {q.required?"· "+t.required:""}</small>
                {(q.type==="SINGLE_CHOICE" || q.type==="MULTI_CHOICE") && <p><small>{q.options.split("\n").filter(Boolean).map((line)=>line.split("|")[1] || line.split("|")[0]).join(" · ")}</small></p>}
              </div>)}
            </div>
            <button className="primary-button" onClick={()=>void createVersion()}>{t.draft}</button>
          </section>

          <section style={box}>
            <h2>{t.versions}</h2>
            {sortedVersions.length===0 && <p>{t.noVersion}</p>}
            {sortedVersions.map((version)=><div key={version.id} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"12px 0",borderTop:"1px solid #e2e8f0"}}>
              <div>
                <strong>v{version.version}</strong> · <span>{version.status}</span>
                <br/><small>{version.activatedAt ? "Activated "+new Date(version.activatedAt).toLocaleString(locale) : version.createdAt ? new Date(version.createdAt).toLocaleString(locale) : ""}</small>
              </div>
              {version.status==="DRAFT" && <button className="primary-button" onClick={()=>void activate(version.version)}>{t.activate}</button>}
            </div>)}
          </section>
        </>}
      </div>
    </div>}
  </AppShell>;
}

function QuestionEditor({
  question,index,locale,t,onChange,onRemove,canRemove,
}:{
  question:BuilderQuestion; index:number; locale:Locale; t:Copy;
  onChange:(next:BuilderQuestion)=>void; onRemove:()=>void; canRemove:boolean;
}) {
  const set=<K extends keyof BuilderQuestion>(key:K,value:BuilderQuestion[K])=>onChange({...question,[key]:value});
  return <div style={{border:"1px solid #e2e8f0",borderRadius:14,padding:14,marginBottom:12}}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:12}}>
      <label>ID<input value={question.id} onChange={(e)=>set("id",e.target.value)} placeholder={"question_"+(index+1)}/></label>
      <label>Type<select value={question.type} onChange={(e)=>set("type",e.target.value as QuestionType)}>{TYPES.map((type)=><option key={type}>{type}</option>)}</select></label>
      <label><input type="checkbox" checked={question.required} onChange={(e)=>set("required",e.target.checked)}/> {t.required}</label>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
      {(["en","ar","fr","es"] as const).map((lang)=><label key={lang}>{t.labels} {lang.toUpperCase()}<input value={question[lang]} onChange={(e)=>set(lang,e.target.value)}/></label>)}
    </div>
    {(question.type==="SINGLE_CHOICE" || question.type==="MULTI_CHOICE") && <label>{t.options}<textarea rows={4} value={question.options} onChange={(e)=>set("options",e.target.value)} placeholder={"YES|Yes|نعم|Oui|Sí\nNO|No|لا|Non|No"}/></label>}
    {question.type==="NUMBER" && <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><label>Min<input value={question.min} onChange={(e)=>set("min",e.target.value)}/></label><label>Max<input value={question.max} onChange={(e)=>set("max",e.target.value)}/></label></div>}
    {question.type==="TEXT" && <label>Max length<input value={question.maxLength} onChange={(e)=>set("maxLength",e.target.value)}/></label>}
    {canRemove && <button className="secondary-button" onClick={onRemove}>{t.remove}</button>}
  </div>;
}
