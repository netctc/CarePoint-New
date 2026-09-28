"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";

type ProviderKind = "DOCTOR" | "OTHER_PROVIDER";
type Credential = {
  id:string; type:string; issuer?:string|null; number?:string|null; validFrom?:string|null; validUntil?:string|null;
  status:string; effectiveStatus?:string; daysRemaining?:number|null; documentCount?:number;
  documents?: Array<{id:string;fileName:string;mediaType:string;byteLength:number;createdAt:string}>;
  verifications?: Array<{id:string;status:string;note?:string|null;actorId:string;createdAt:string}>;
};
type Provider = {
  id:string; class:ProviderKind; displayName:string; legalName?:string|null; contactPhone?:string|null; status:string;
  user?:{id:string;email:string;status:string}|null;
  credentials:Credential[]; operationallyBlocked:boolean; operationalBlockReasons:string[];
  requiredCredentialTypes:string[]; missingRequiredCredentialTypes:string[];
  doctorProfile?:any; otherProviderProfile?:any;
  governanceHistory?:Array<{id:string;domain:string;targetId?:string|null;fromStatus?:string|null;toStatus:string;reason?:string|null;actorId:string;createdAt:string}>;
};
const ACCOUNT_STATUSES=["ACTIVE","SUSPENDED","ARCHIVED"];
const PROVIDER_STATUSES=["DRAFT","PENDING_REVIEW","ACTIVE","SUSPENDED","REJECTED"];
const CREDENTIAL_STATUSES=["PENDING","VALID","REJECTED","REVOKED"];

const copy={
 en:{center:"Doctor / Provider Administration Center",intro:"Account access, provider operability and credential validity are governed independently.",search:"Search professionals, license, issuer or email",total:"Professionals",active:"Operational",blocked:"Blocked",expiring:"Expiring soon",open:"Manage",account:"Account",provider:"Provider",credential:"Credential",profile:"Administrative profile",display:"Display name",legal:"Legal name",phone:"Phone",save:"Save profile",reason:"Reason for change",apply:"Apply",licenses:"Licenses & authorizations",type:"Type",number:"Number",issuer:"Issuer",from:"Valid from",until:"Valid until",status:"Status",documents:"Documents",renew:"Renew",verification:"Verification history",history:"Status history",newCredential:"Add license / credential",add:"Add credential",upload:"Attach PDF",missing:"Missing required",blockedWhy:"Operational block",none:"None",loading:"Loading administration center…",refresh:"Refresh",uploadLimit:"PDF only, max 8 MB each; multiple documents are retained per credential.",renewUntil:"New expiry date (YYYY-MM-DD)",renewNote:"Renewal note",view:"View",saved:"Saved.",failed:"Operation failed."},
 es:{center:"Centro de Administración de Médicos / Proveedores",intro:"El acceso de cuenta, la capacidad operativa del proveedor y la validez de credenciales se gobiernan por separado.",search:"Buscar profesional, licencia, emisor o email",total:"Profesionales",active:"Operativos",blocked:"Bloqueados",expiring:"Próximos a vencer",open:"Gestionar",account:"Cuenta",provider:"Proveedor",credential:"Credencial",profile:"Perfil administrativo",display:"Nombre visible",legal:"Nombre legal",phone:"Teléfono",save:"Guardar perfil",reason:"Motivo del cambio",apply:"Aplicar",licenses:"Licencias y autorizaciones",type:"Tipo",number:"Número",issuer:"Emisor",from:"Válida desde",until:"Válida hasta",status:"Estado",documents:"Documentos",renew:"Renovar",verification:"Historial de verificaciones",history:"Historial de estados",newCredential:"Añadir licencia / credencial",add:"Añadir credencial",upload:"Adjuntar PDF",missing:"Obligatorias ausentes",blockedWhy:"Bloqueo operacional",none:"Ninguno",loading:"Cargando centro administrativo…",refresh:"Actualizar",uploadLimit:"Solo PDF, máximo 8 MB por archivo; se conservan múltiples documentos por credencial.",renewUntil:"Nueva fecha de vencimiento (YYYY-MM-DD)",renewNote:"Nota de renovación",view:"Ver",saved:"Guardado.",failed:"No se pudo completar la operación."},
 fr:{center:"Centre d’administration Médecins / Prestataires",intro:"L’accès au compte, l’état opérationnel du prestataire et la validité des justificatifs sont gouvernés séparément.",search:"Rechercher professionnel, licence, émetteur ou e-mail",total:"Professionnels",active:"Opérationnels",blocked:"Bloqués",expiring:"Expiration proche",open:"Gérer",account:"Compte",provider:"Prestataire",credential:"Justificatif",profile:"Profil administratif",display:"Nom affiché",legal:"Nom légal",phone:"Téléphone",save:"Enregistrer",reason:"Motif du changement",apply:"Appliquer",licenses:"Licences et autorisations",type:"Type",number:"Numéro",issuer:"Émetteur",from:"Valide depuis",until:"Valide jusqu’au",status:"Statut",documents:"Documents",renew:"Renouveler",verification:"Historique de vérification",history:"Historique des statuts",newCredential:"Ajouter licence / justificatif",add:"Ajouter",upload:"Joindre PDF",missing:"Justificatifs manquants",blockedWhy:"Blocage opérationnel",none:"Aucun",loading:"Chargement…",refresh:"Actualiser",uploadLimit:"PDF uniquement, 8 Mo max par fichier; plusieurs documents sont conservés.",renewUntil:"Nouvelle expiration (AAAA-MM-JJ)",renewNote:"Note de renouvellement",view:"Voir",saved:"Enregistré.",failed:"Échec de l’opération."},
 ar:{center:"مركز إدارة الأطباء ومقدمي الخدمة",intro:"يتم فصل حوكمة حالة الحساب وحالة مقدم الخدمة وصلاحية الاعتماد.",search:"بحث بالاسم أو الترخيص أو الجهة أو البريد",total:"المهنيون",active:"قابلون للعمل",blocked:"محظورون",expiring:"قريب الانتهاء",open:"إدارة",account:"الحساب",provider:"مقدم الخدمة",credential:"الاعتماد",profile:"الملف الإداري",display:"الاسم الظاهر",legal:"الاسم القانوني",phone:"الهاتف",save:"حفظ",reason:"سبب التغيير",apply:"تطبيق",licenses:"التراخيص والاعتمادات",type:"النوع",number:"الرقم",issuer:"الجهة",from:"صالح من",until:"صالح حتى",status:"الحالة",documents:"المستندات",renew:"تجديد",verification:"سجل التحقق",history:"سجل الحالات",newCredential:"إضافة ترخيص / اعتماد",add:"إضافة",upload:"إرفاق PDF",missing:"الاعتمادات الناقصة",blockedWhy:"الحظر التشغيلي",none:"لا يوجد",loading:"جارٍ التحميل…",refresh:"تحديث",uploadLimit:"PDF فقط بحد أقصى 8 ميغابايت لكل ملف مع الاحتفاظ بعدة مستندات لكل اعتماد.",renewUntil:"تاريخ الانتهاء الجديد",renewNote:"ملاحظة التجديد",view:"عرض",saved:"تم الحفظ.",failed:"تعذر إتمام العملية."}
} satisfies Record<Locale,Record<string,string>>;

export function ProfessionalAdministrationCenter({kind}:{kind:ProviderKind}) {
  const {locale}=useI18n(); const t=copy[locale];
  const [rows,setRows]=useState<Provider[]>([]); const [query,setQuery]=useState(""); const [busy,setBusy]=useState(true);
  const [message,setMessage]=useState(""); const [selectedId,setSelectedId]=useState(""); const [detail,setDetail]=useState<Provider|null>(null);
  const [profile,setProfile]=useState({displayName:"",legalName:"",contactPhone:""});
  const [accountStatus,setAccountStatus]=useState("ACTIVE"); const [providerStatus,setProviderStatus]=useState("ACTIVE"); const [reason,setReason]=useState("");
  const [credentialForm,setCredentialForm]=useState({type:kind==="DOCTOR"?"medical-license":"",number:"",issuer:"",validFrom:"",validUntil:""});

  async function request(path:string,init?:RequestInit){
    const response=await fetch(path,{cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
    if(response.status===401){window.location.assign("/login?next="+encodeURIComponent(window.location.pathname));throw new Error("Authentication required.");}
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(typeof body?.message==="string"?body.message:t.failed);
    return body;
  }
  async function load(){
    setBusy(true); setMessage("");
    try{
      const params=new URLSearchParams({class:kind}); if(query.trim())params.set("q",query.trim());
      const body=await request("/api/admin/provider-administration?"+params.toString());
      setRows(Array.isArray(body?.items)?body.items:[]);
      if(selectedId && !(body?.items??[]).some((item:any)=>item.id===selectedId)){setSelectedId("");setDetail(null);}
    }catch(e){setMessage(String(e));}finally{setBusy(false);}
  }
  useEffect(()=>{void load();},[kind]);
  async function open(id:string){
    try{
      const body=await request("/api/admin/provider-administration/"+encodeURIComponent(id));
      setSelectedId(id);setDetail(body);
      setProfile({displayName:body.displayName??"",legalName:body.legalName??"",contactPhone:body.contactPhone??""});
      setAccountStatus(body.user?.status??"ACTIVE");setProviderStatus(body.status??"DRAFT");setReason("");
    }catch(e){setMessage(String(e));}
  }
  async function mutate(path:string,method:"POST"|"PATCH",body:any){
    setMessage("");
    try{await request(path,{method,body:JSON.stringify(body)});setMessage(t.saved);await load();if(selectedId)await open(selectedId);}
    catch(e){setMessage(String(e));}
  }
  const metrics=useMemo(()=>({
    total:rows.length,
    active:rows.filter(r=>!r.operationallyBlocked).length,
    blocked:rows.filter(r=>r.operationallyBlocked).length,
    expiring:rows.reduce((n,r)=>n+r.credentials.filter(c=>c.effectiveStatus==="EXPIRING_SOON").length,0),
  }),[rows]);

  async function upload(credential:Credential,files:FileList|null){
    if(!detail||!files)return;
    for(const file of Array.from(files)){
      if(file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf")){setMessage("PDF required: "+file.name);continue;}
      if(file.size>8*1024*1024){setMessage("PDF exceeds 8 MB: "+file.name);continue;}
      const contentBase64=await toBase64(file);
      await mutate("/api/admin/provider-administration/"+detail.id+"/credentials/"+credential.id+"/documents","POST",{fileName:file.name,mediaType:"application/pdf",contentBase64});
    }
  }
  async function renew(credential:Credential){
    if(!detail)return;
    const validUntil=window.prompt(t.renewUntil,credential.validUntil?.slice(0,10)??"")?.trim();
    if(!validUntil)return;
    const note=window.prompt(t.renewNote,"Administrative renewal")?.trim()||"Administrative renewal";
    await mutate("/api/admin/provider-administration/"+detail.id+"/credentials/"+credential.id+"/renew","POST",{validUntil,note});
  }
  async function viewDocument(credential:Credential,documentId:string){
    if(!detail)return;
    const preview=window.open("about:blank","_blank");
    try{
      const body=await request("/api/admin/provider-administration/"+detail.id+"/credentials/"+credential.id+"/documents/"+documentId+"/content");
      const binary=window.atob(body.contentBase64||""); const bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      const url=URL.createObjectURL(new Blob([bytes],{type:body.mediaType||"application/pdf"}));
      if(preview)preview.location.href=url;else window.open(url,"_blank","noopener,noreferrer");
      window.setTimeout(()=>URL.revokeObjectURL(url),120000);
    }catch(e){preview?.close();setMessage(String(e));}
  }

  const card={background:"#fff",border:"1px solid #dbe4ee",borderRadius:16,padding:16} as const;
  return <section style={{display:"grid",gap:16}}>
    <section style={card}>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"start",flexWrap:"wrap"}}>
        <div><span style={{fontSize:12,fontWeight:800,color:"#64748b"}}>ADM-PRO-001 → ADM-PRO-010</span><h2 style={{margin:"5px 0"}}>{t.center}</h2><p>{t.intro}</p></div>
        <button className="secondary-button" onClick={()=>void load()}>{t.refresh}</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(110px,1fr))",gap:10}}>
        <Metric label={t.total} value={metrics.total}/><Metric label={t.active} value={metrics.active}/><Metric label={t.blocked} value={metrics.blocked}/><Metric label={t.expiring} value={metrics.expiring}/>
      </div>
      <form onSubmit={e=>{e.preventDefault();void load();}} style={{display:"flex",gap:8,marginTop:14}}>
        <input style={{flex:1}} value={query} onChange={e=>setQuery(e.target.value)} placeholder={t.search}/><button className="primary-button">{t.refresh}</button>
      </form>
      {message&&<p style={{marginBottom:0}}>{message}</p>}
    </section>

    {busy?<p>{t.loading}</p>:<section style={{...card,overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr><th align="left">{kind==="DOCTOR"?"Doctor":"Provider"}</th><th align="left">{t.account}</th><th align="left">{t.provider}</th><th align="left">{t.credential}</th><th align="left">{t.blockedWhy}</th><th/></tr></thead>
        <tbody>{rows.map(row=><tr key={row.id} style={{borderTop:"1px solid #e2e8f0"}}>
          <td style={{padding:"12px 8px"}}><strong>{row.displayName}</strong><br/><small>{row.user?.email??"—"}</small></td>
          <td style={{padding:"12px 8px"}}><Badge value={row.user?.status??"UNLINKED"}/></td>
          <td style={{padding:"12px 8px"}}><Badge value={row.status}/></td>
          <td style={{padding:"12px 8px"}}>{row.credentials.slice(0,2).map(c=><span key={c.id} style={{display:"block"}}>{c.type}: <Badge value={c.effectiveStatus??c.status}/></span>)}</td>
          <td style={{padding:"12px 8px"}}><small>{row.operationallyBlocked?row.operationalBlockReasons.join(", "):t.none}</small></td>
          <td style={{padding:"12px 8px"}}><button className="secondary-button" onClick={()=>void open(row.id)}>{t.open}</button></td>
        </tr>)}</tbody>
      </table>
    </section>}

    {detail&&<section style={{...card,border:"2px solid #cbd5e1"}}>
      <h2>{detail.displayName}</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
        <label>{t.display}<input value={profile.displayName} onChange={e=>setProfile({...profile,displayName:e.target.value})}/></label>
        <label>{t.legal}<input value={profile.legalName} onChange={e=>setProfile({...profile,legalName:e.target.value})}/></label>
        <label>{t.phone}<input value={profile.contactPhone} onChange={e=>setProfile({...profile,contactPhone:e.target.value})}/></label>
      </div>
      <button style={{marginTop:10}} className="primary-button" onClick={()=>void mutate("/api/admin/provider-administration/"+detail.id+"/profile","PATCH",profile)}>{t.save}</button>

      <hr style={{border:0,borderTop:"1px solid #e2e8f0",margin:"18px 0"}}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:14}}>
        <div><h3>{t.account} status</h3><select value={accountStatus} onChange={e=>setAccountStatus(e.target.value)}>{ACCOUNT_STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
        <div><h3>{t.provider} status</h3><select value={providerStatus} onChange={e=>setProviderStatus(e.target.value)}>{PROVIDER_STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
        <label>{t.reason}<input value={reason} onChange={e=>setReason(e.target.value)} placeholder={t.reason}/></label>
      </div>
      <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
        <button className="secondary-button" onClick={()=>void mutate("/api/admin/provider-administration/"+detail.id+"/account-status","PATCH",{status:accountStatus,reason})}>{t.apply} · {t.account}</button>
        <button className="secondary-button" onClick={()=>void mutate("/api/admin/provider-administration/"+detail.id+"/provider-status","PATCH",{status:providerStatus,reason})}>{t.apply} · {t.provider}</button>
      </div>
      {detail.missingRequiredCredentialTypes.length>0&&<p><b>{t.missing}:</b> {detail.missingRequiredCredentialTypes.join(", ")}</p>}

      <hr style={{border:0,borderTop:"1px solid #e2e8f0",margin:"18px 0"}}/>
      <h3>{t.licenses}</h3>
      <p><small>{t.uploadLimit}</small></p>
      <div style={{display:"grid",gap:12}}>
        {detail.credentials.map(credential=><article key={credential.id} style={{border:"1px solid #e2e8f0",borderRadius:12,padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <div><strong>{credential.type}</strong> · {credential.number||"—"} · {credential.issuer||"—"}<br/><small>{t.from}: {date(credential.validFrom)} · {t.until}: {date(credential.validUntil)} · {credential.daysRemaining??"—"}d</small></div>
            <Badge value={credential.effectiveStatus??credential.status}/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
            <select defaultValue={credential.status==="VERIFIED"?"VALID":credential.status} id={"cred-status-"+credential.id}>{CREDENTIAL_STATUSES.map(s=><option key={s}>{s}</option>)}</select>
            <button className="secondary-button" onClick={()=>{const el=document.getElementById("cred-status-"+credential.id) as HTMLSelectElement|null;void mutate("/api/admin/provider-administration/"+detail.id+"/credentials/"+credential.id+"/status","PATCH",{status:el?.value||credential.status,reason:reason||"Administrative credential review"});}}>{t.apply} · {t.status}</button>
            <button className="secondary-button" onClick={()=>void renew(credential)}>{t.renew}</button>
            <label className="secondary-button" style={{cursor:"pointer"}}>{t.upload}<input hidden type="file" accept="application/pdf,.pdf" multiple onChange={e=>void upload(credential,e.target.files)}/></label>
          </div>
          {(credential.documents??[]).length>0&&<div style={{marginTop:8}}><b>{t.documents}: </b>{credential.documents!.map(doc=><button key={doc.id} style={{marginInlineEnd:6}} className="secondary-button" onClick={()=>void viewDocument(credential,doc.id)}>{t.view} · {doc.fileName}</button>)}</div>}
          {(credential.verifications??[]).length>0&&<details style={{marginTop:8}}><summary>{t.verification} ({credential.verifications!.length})</summary><ul>{credential.verifications!.map(v=><li key={v.id}>{dateTime(v.createdAt)} · <b>{v.status}</b>{v.note?" · "+v.note:""}</li>)}</ul></details>}
        </article>)}
      </div>

      <section style={{marginTop:16,border:"1px dashed #cbd5e1",borderRadius:12,padding:12}}>
        <h3>{t.newCredential}</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
          <label>{t.type}<input value={credentialForm.type} onChange={e=>setCredentialForm({...credentialForm,type:e.target.value})}/></label>
          <label>{t.number}<input value={credentialForm.number} onChange={e=>setCredentialForm({...credentialForm,number:e.target.value})}/></label>
          <label>{t.issuer}<input value={credentialForm.issuer} onChange={e=>setCredentialForm({...credentialForm,issuer:e.target.value})}/></label>
          <label>{t.from}<input type="date" value={credentialForm.validFrom} onChange={e=>setCredentialForm({...credentialForm,validFrom:e.target.value})}/></label>
          <label>{t.until}<input type="date" value={credentialForm.validUntil} onChange={e=>setCredentialForm({...credentialForm,validUntil:e.target.value})}/></label>
        </div>
        <button style={{marginTop:10}} className="primary-button" onClick={()=>void mutate("/api/admin/provider-administration/"+detail.id+"/credentials","POST",{...credentialForm,status:"PENDING",note:"Administrative credential creation"})}>{t.add}</button>
      </section>

      <details style={{marginTop:16}} open><summary><b>{t.history}</b> ({detail.governanceHistory?.length??0})</summary>
        <ul>{(detail.governanceHistory??[]).map(item=><li key={item.id}>{dateTime(item.createdAt)} · {item.domain}: {item.fromStatus??"—"} → <b>{item.toStatus}</b>{item.reason?" · "+item.reason:""}</li>)}</ul>
      </details>
    </section>}
  </section>;
}
function Metric({label,value}:{label:string;value:number}){return <div style={{border:"1px solid #e2e8f0",borderRadius:12,padding:10}}><strong style={{fontSize:24}}>{value}</strong><br/><small>{label}</small></div>}
function Badge({value}:{value:string}){const danger=["EXPIRED","REJECTED","REVOKED","SUSPENDED","ARCHIVED"].includes(value);const warn=["EXPIRING_SOON","PENDING","PENDING_REVIEW","DRAFT"].includes(value);return <span style={{display:"inline-block",padding:"3px 7px",borderRadius:999,fontSize:11,fontWeight:800,background:danger?"#fee2e2":warn?"#fef3c7":"#dcfce7",color:danger?"#991b1b":warn?"#92400e":"#166534"}}>{value}</span>}
function date(value?:string|null){return value?value.slice(0,10):"—"}
function dateTime(value?:string|null){if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString()}
function toBase64(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result??"").split(",").pop()??"");reader.readAsDataURL(file);})}
