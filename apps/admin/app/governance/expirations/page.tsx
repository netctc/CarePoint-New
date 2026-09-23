"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";

type State="CURRENT"|"EXPIRING"|"EXPIRED"|"MISSING";
type Item={providerId:string;providerDisplayName:string;providerClass:string;credentialType:string;state:State;validUntil:string|null;daysRemaining:number|null;operationallyBlocked:boolean};
type Snapshot={generatedAt:string;policy:{notificationsEnabled:boolean;warningDays:number[]};summary:Record<State,number>;items:Item[]};

const copy:Record<Locale,Record<string,string>>={
en:{title:"Credential expiration governance",eyebrow:"ADM-108 · Provider governance",refresh:"Refresh",save:"Save reminder policy",run:"Run reminders",windows:"Reminder windows (days)",notify:"Reminder notifications enabled",invariant:"Operational blocking on expiry is always enforced and cannot be disabled here.",privacy:"Credential numbers, issuers and documents are intentionally excluded.",provider:"Provider",kind:"Class",credential:"Required credential",state:"State",expiry:"Expiry",days:"Days remaining",blocked:"Blocked",yes:"Yes",no:"No",CURRENT:"Current",EXPIRING:"Expiring",EXPIRED:"Expired",MISSING:"Missing",invalid:"Use 1-5 unique integers from 1 to 365.",failed:"Request failed."},
ar:{title:"حوكمة انتهاء صلاحية الاعتمادات",eyebrow:"ADM-108 · حوكمة مقدمي الخدمة",refresh:"تحديث",save:"حفظ سياسة التذكير",run:"تشغيل التذكيرات",windows:"نوافذ التذكير (أيام)",notify:"تفعيل إشعارات التذكير",invariant:"يظل حظر التشغيل عند انتهاء الاعتماد إلزامياً ولا يمكن تعطيله من هنا.",privacy:"يتم استبعاد أرقام الاعتمادات والجهات المصدرة والمستندات.",provider:"مقدم الخدمة",kind:"الفئة",credential:"الاعتماد المطلوب",state:"الحالة",expiry:"الانتهاء",days:"الأيام المتبقية",blocked:"محظور",yes:"نعم",no:"لا",CURRENT:"ساري",EXPIRING:"قارب على الانتهاء",EXPIRED:"منتهي",MISSING:"مفقود",invalid:"استخدم 1-5 أعداد صحيحة فريدة من 1 إلى 365.",failed:"فشل الطلب."},
fr:{title:"Gouvernance des expirations de justificatifs",eyebrow:"ADM-108 · Gouvernance prestataires",refresh:"Actualiser",save:"Enregistrer la politique",run:"Exécuter les rappels",windows:"Fenêtres de rappel (jours)",notify:"Notifications de rappel activées",invariant:"Le blocage opérationnel à l’expiration reste obligatoire et ne peut pas être désactivé ici.",privacy:"Les numéros, émetteurs et documents sont volontairement exclus.",provider:"Prestataire",kind:"Classe",credential:"Justificatif requis",state:"État",expiry:"Expiration",days:"Jours restants",blocked:"Bloqué",yes:"Oui",no:"Non",CURRENT:"Valide",EXPIRING:"Expire bientôt",EXPIRED:"Expiré",MISSING:"Manquant",invalid:"Utilisez 1 à 5 entiers uniques de 1 à 365.",failed:"Échec de la requête."},
es:{title:"Gobernanza de vencimiento de credenciales",eyebrow:"ADM-108 · Gobernanza de proveedores",refresh:"Actualizar",save:"Guardar política de avisos",run:"Ejecutar recordatorios",windows:"Ventanas de aviso (días)",notify:"Notificaciones de credenciales activadas",invariant:"El bloqueo operativo al vencer una credencial es obligatorio y no puede desactivarse aquí.",privacy:"Los números, emisores y documentos de credenciales se excluyen intencionadamente.",provider:"Proveedor",kind:"Clase",credential:"Credencial requerida",state:"Estado",expiry:"Vencimiento",days:"Días restantes",blocked:"Bloqueado",yes:"Sí",no:"No",CURRENT:"Vigente",EXPIRING:"Próxima a vencer",EXPIRED:"Vencida",MISSING:"Faltante",invalid:"Usa entre 1 y 5 enteros únicos de 1 a 365.",failed:"La solicitud falló."}
};

async function api(path:string,method="GET",body?:unknown){
 const response=await fetch("/api/admin/b6/"+path,{method,headers:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(typeof payload?.message==="string"?payload.message:"Request failed.");
 return payload;
}
export default function CredentialExpirationsPage(){
 const {locale}=useI18n();const c=copy[locale];const [data,setData]=useState<Snapshot|null>(null);const [windows,setWindows]=useState("90,30,7");const [enabled,setEnabled]=useState(true);const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{const next=await api("credential-expirations") as Snapshot;setData(next);setWindows(next.policy.warningDays.join(","));setEnabled(next.policy.notificationsEnabled);setMessage("");}catch(e){setMessage(e instanceof Error?e.message:c.failed);}},[c.failed]);
 useEffect(()=>{void load();},[load]);
 const parsed=useMemo(()=>{const values=windows.split(",").map(v=>Number(v.trim())).filter(Number.isFinite);return{values,valid:values.length>=1&&values.length<=5&&values.every(v=>Number.isInteger(v)&&v>=1&&v<=365)&&new Set(values).size===values.length};},[windows]);
 async function save(){if(!parsed.valid){setMessage(c.invalid);return;}setBusy(true);try{await api("credential-expirations/policy","POST",{warningDays:parsed.values,notificationsEnabled:enabled});await load();}catch(e){setMessage(e instanceof Error?e.message:c.failed);}finally{setBusy(false);}}
 async function run(){setBusy(true);try{await api("credential-expirations/run-reminders","POST",{});await load();}catch(e){setMessage(e instanceof Error?e.message:c.failed);}finally{setBusy(false);}}
 const box={background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:16} as const;
 return <AppShell active="17" eyebrow={c.eyebrow} title={c.title}><div style={{display:"grid",gap:14}}>
  <div style={{...box,background:"#eff6ff"}}><strong>{c.invariant}</strong><div style={{color:"#475569",marginTop:6}}>{c.privacy}</div></div>
  {message?<div style={box}>{message}</div>:null}
  <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(100px,1fr))",gap:10}}>{(["CURRENT","EXPIRING","EXPIRED","MISSING"] as State[]).map(s=><div key={s} style={box}><small>{c[s]}</small><div style={{fontSize:26,fontWeight:800}}>{data?.summary?.[s]??0}</div></div>)}</div>
  <div style={box}><div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
   <label style={{display:"grid",gap:5}}>{c.windows}<input value={windows} onChange={e=>setWindows(e.target.value)} style={{padding:9,border:"1px solid #cbd5e1",borderRadius:8}}/></label>
   <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> {c.notify}</label>
   <button className="secondary-button" disabled={busy||!parsed.valid} onClick={()=>void save()}>{c.save}</button>
   <button className="secondary-button" disabled={busy} onClick={()=>void run()}>{c.run}</button>
   <button className="secondary-button" disabled={busy} onClick={()=>void load()}>{c.refresh}</button>
  </div></div>
  <div style={{...box,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:850}}><thead><tr>{[c.provider,c.kind,c.credential,c.state,c.expiry,c.days,c.blocked].map(h=><th key={h} style={{textAlign:"start",padding:9,borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr></thead><tbody>
   {(data?.items??[]).map(item=><tr key={item.providerId+":"+item.credentialType}><td style={{padding:9,borderBottom:"1px solid #e2e8f0"}}><strong>{item.providerDisplayName}</strong><small style={{display:"block",color:"#64748b"}}>{item.providerId}</small></td><td>{item.providerClass}</td><td>{item.credentialType}</td><td>{c[item.state]}</td><td>{item.validUntil?new Date(item.validUntil).toLocaleDateString():"—"}</td><td>{item.daysRemaining??"—"}</td><td>{item.operationallyBlocked?c.yes:c.no}</td></tr>)}
  </tbody></table></div>
 </div></AppShell>;
}
