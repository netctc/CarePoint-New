"use client";

import { FormEvent, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";

type Domain = "ALL" | "CLINICAL_PROFILE" | "OBSERVATION" | "QUESTIONNAIRE";
type Item = {
  id: string;
  patientId: string;
  domain: Exclude<Domain, "ALL">;
  resourceType: string;
  resourceCode: string;
  resourceStatus: string | null;
  resourceVersion: number;
  schemaVersion: number | null;
  sourceType: string;
  sourceId: string | null;
  sourceActorId: string | null;
  verificationStatus: string | null;
  verifiedByActorId: string | null;
  verifiedAt: string | null;
  revisionCount: number;
  effectiveAt: string | null;
  recordedAt: string;
  updatedAt: string;
};
type Response = {
  patientId: string;
  domain: Domain;
  limit: number;
  contentIncluded: false;
  immutableReadOnly: true;
  items: Item[];
};

const copy = {
  en: {
    title:"Clinical provenance explorer",eyebrow:"ADM-086 · Data governance",intro:"Inspect origin, version and verification evidence without opening clinical values or editing records.",privacy:"This view contains structural PHI identifiers only. Clinical notes, answers, measurements and encrypted payloads are intentionally excluded. Every patient query is audited.",patient:"Patient ID",domain:"Domain",search:"Search provenance",all:"All",profile:"Clinical profile",observation:"Observations",questionnaire:"Questionnaires",resource:"Resource",version:"Version",source:"Source",actor:"Source actor",verification:"Verification",verifiedBy:"Verified by",recorded:"Recorded",effective:"Effective",revisions:"Revisions",status:"Status",empty:"No provenance rows match this patient/domain.",failed:"Request failed.",required:"Enter a valid patient ID.",readOnly:"Read-only",notVerified:"Not separately verified"
  },
  ar: {
    title:"مستكشف مصدر البيانات السريرية",eyebrow:"ADM-086 · حوكمة البيانات",intro:"راجع المصدر والإصدار ودليل التحقق دون فتح القيم السريرية أو تعديل السجلات.",privacy:"تعرض هذه الصفحة معرّفات بنيوية فقط. الملاحظات والإجابات والقياسات والبيانات المشفرة مستبعدة عمداً. كل استعلام عن مريض مسجّل في التدقيق.",patient:"معرّف المريض",domain:"المجال",search:"بحث المصدر",all:"الكل",profile:"الملف السريري",observation:"الملاحظات",questionnaire:"الاستبيانات",resource:"المورد",version:"الإصدار",source:"المصدر",actor:"منشئ المصدر",verification:"التحقق",verifiedBy:"تم التحقق بواسطة",recorded:"تاريخ التسجيل",effective:"التاريخ الفعلي",revisions:"المراجعات",status:"الحالة",empty:"لا توجد سجلات مصدر مطابقة.",failed:"فشل الطلب.",required:"أدخل معرّف مريض صالحاً.",readOnly:"للقراءة فقط",notVerified:"لا يوجد تحقق منفصل"
  },
  fr: {
    title:"Explorateur de provenance clinique",eyebrow:"ADM-086 · Gouvernance des données",intro:"Inspectez l’origine, la version et la vérification sans ouvrir les valeurs cliniques ni modifier les dossiers.",privacy:"Cette vue contient uniquement des identifiants PHI structurels. Notes, réponses, mesures et payloads chiffrés sont volontairement exclus. Chaque requête patient est auditée.",patient:"ID patient",domain:"Domaine",search:"Rechercher la provenance",all:"Tous",profile:"Profil clinique",observation:"Observations",questionnaire:"Questionnaires",resource:"Ressource",version:"Version",source:"Source",actor:"Acteur source",verification:"Vérification",verifiedBy:"Vérifié par",recorded:"Enregistré",effective:"Effectif",revisions:"Révisions",status:"État",empty:"Aucune ligne de provenance pour ce patient/domaine.",failed:"Échec de la requête.",required:"Saisissez un ID patient valide.",readOnly:"Lecture seule",notVerified:"Pas de vérification séparée"
  },
  es: {
    title:"Explorador de procedencia clínica",eyebrow:"ADM-086 · Gobernanza de datos",intro:"Consulta origen, versión y evidencia de verificación sin abrir valores clínicos ni editar registros.",privacy:"Esta vista contiene sólo identificadores PHI estructurales. Notas, respuestas, mediciones y payloads cifrados se excluyen intencionadamente. Cada consulta de paciente queda auditada.",patient:"ID de paciente",domain:"Dominio",search:"Buscar procedencia",all:"Todos",profile:"Perfil clínico",observation:"Observaciones",questionnaire:"Cuestionarios",resource:"Recurso",version:"Versión",source:"Origen",actor:"Actor de origen",verification:"Verificación",verifiedBy:"Verificado por",recorded:"Registrado",effective:"Efectivo",revisions:"Revisiones",status:"Estado",empty:"No hay registros de procedencia para este paciente/dominio.",failed:"La solicitud falló.",required:"Introduce un ID de paciente válido.",readOnly:"Sólo lectura",notVerified:"Sin verificación separada"
  },
} as const satisfies Record<Locale, Record<string, string>>;

const SAFE_ID=/^[A-Za-z0-9_.:-]{1,180}$/;

export default function ClinicalProvenancePage(){
  const {locale}=useI18n(); const c=copy[locale];
  const [patientId,setPatientId]=useState("");
  const [domain,setDomain]=useState<Domain>("ALL");
  const [data,setData]=useState<Response|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  const formatter=useMemo(()=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}),[locale]);
  const date=(value:string|null)=>{if(!value)return "—";const parsed=new Date(value);return Number.isFinite(parsed.getTime())?formatter.format(parsed):"—";};
  const domainLabel=(value:Domain)=>value==="CLINICAL_PROFILE"?c.profile:value==="OBSERVATION"?c.observation:value==="QUESTIONNAIRE"?c.questionnaire:c.all;

  async function submit(event:FormEvent){
    event.preventDefault();
    const id=patientId.trim();
    if(!SAFE_ID.test(id)){setMessage(c.required);return;}
    setBusy(true);setMessage("");
    try{
      const query=new URLSearchParams({patientId:id,domain,limit:"200"});
      const response=await fetch("/api/admin/clinical-access/provenance?"+query.toString(),{cache:"no-store"});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(typeof payload?.message==="string"?payload.message:c.failed);
      setData(payload as Response);
    }catch(error){setData(null);setMessage(error instanceof Error?error.message:c.failed);}
    finally{setBusy(false);}
  }

  const box={background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:16} as const;
  return <AppShell active="19" eyebrow={c.eyebrow} title={c.title}>
    <div style={{display:"grid",gap:14}}>
      <div style={{...box,background:"#f8fafc"}}>
        <strong>{c.intro}</strong><div style={{marginTop:7,color:"#475569"}}>{c.privacy}</div>
        <div style={{marginTop:7}}><code>{c.readOnly}</code></div>
      </div>
      <form onSubmit={submit} style={{...box,display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}>
        <label style={{display:"grid",gap:5,flex:"1 1 300px"}}>{c.patient}
          <input value={patientId} onChange={e=>setPatientId(e.target.value)} maxLength={180} style={{padding:9,border:"1px solid #cbd5e1",borderRadius:8}}/>
        </label>
        <label style={{display:"grid",gap:5,minWidth:210}}>{c.domain}
          <select value={domain} onChange={e=>setDomain(e.target.value as Domain)} style={{padding:9,border:"1px solid #cbd5e1",borderRadius:8}}>
            {(["ALL","CLINICAL_PROFILE","OBSERVATION","QUESTIONNAIRE"] as Domain[]).map(value=><option key={value} value={value}>{domainLabel(value)}</option>)}
          </select>
        </label>
        <button className="secondary-button" disabled={busy} type="submit">{c.search}</button>
      </form>
      {message?<div style={box}>{message}</div>:null}
      {data?<div style={{...box,overflow:"auto"}}>
        <div style={{marginBottom:10}}><strong>{data.patientId}</strong> · {domainLabel(data.domain)} · {data.items.length}</div>
        {data.items.length===0?<div>{c.empty}</div>:<table style={{width:"100%",borderCollapse:"collapse",minWidth:1180}}>
          <thead><tr>{[c.resource,c.version,c.status,c.source,c.actor,c.verification,c.verifiedBy,c.revisions,c.effective,c.recorded].map(h=><th key={h} style={{textAlign:"start",padding:8,borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr></thead>
          <tbody>{data.items.map(item=><tr key={item.domain+":"+item.id}>
            <td style={{padding:8,borderBottom:"1px solid #e2e8f0"}}><strong>{item.resourceCode}</strong><small style={{display:"block",color:"#64748b"}}>{domainLabel(item.domain)} · {item.resourceType}<br/>{item.id}</small></td>
            <td>{item.resourceVersion}{item.schemaVersion!=null?<small style={{display:"block"}}>schema v{item.schemaVersion}</small>:null}</td>
            <td>{item.resourceStatus??"—"}</td>
            <td>{item.sourceType}<small style={{display:"block"}}>{item.sourceId??"—"}</small></td>
            <td>{item.sourceActorId??"—"}</td>
            <td>{item.verificationStatus??c.notVerified}</td>
            <td>{item.verifiedByActorId??"—"}<small style={{display:"block"}}>{date(item.verifiedAt)}</small></td>
            <td>{item.revisionCount}</td>
            <td>{date(item.effectiveAt)}</td>
            <td>{date(item.recordedAt)}</td>
          </tr>)}</tbody>
        </table>}
      </div>:null}
    </div>
  </AppShell>;
}
