"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./DeviceGovernanceConsole.module.css";

type Row = Record<string, any>;
type Section = "registry" | "integrations";

type Copy = {
  refresh:string; loading:string; failed:string; empty:string; createModel:string; registerDevice:string;
  assign:string; rotate:string; revoke:string; code:string; manufacturer:string; model:string; type:string;
  observations:string; serial:string; patient:string; provider:string; integration:string; status:string;
  version:string; lastSeen:string; credential:string; credentialWarning:string; createIntegration:string;
  providerName:string; publicKey:string; scopes:string; health:string; lastSuccess:string; lastError:string;
  activeOnly:string; save:string; cancel:string; noSecret:string;
};

const copy: Record<Locale, Copy> = {
  en:{refresh:"Refresh",loading:"Loading…",failed:"Request failed.",empty:"No records.",createModel:"Create device model",registerDevice:"Register device",assign:"Change assignment",rotate:"Rotate credential",revoke:"Revoke",code:"Code",manufacturer:"Manufacturer",model:"Model",type:"Device type",observations:"Observation codes",serial:"Serial number",patient:"Patient ID",provider:"Provider ID",integration:"Integration",status:"Status",version:"Version",lastSeen:"Last seen",credential:"One-time device private key",credentialWarning:"Copy this private key now. CarePoint does not store it and it will not be shown again.",createIntegration:"Create connector",providerName:"Provider name",publicKey:"Webhook Ed25519 public key",scopes:"Observation scopes",health:"Health",lastSuccess:"Last success",lastError:"Last error",activeOnly:"Revoked devices/connectors cannot ingest new observations.",save:"Save",cancel:"Cancel",noSecret:"Only public-key fingerprints and credential status are listed; no private secret is returned."},
  ar:{refresh:"تحديث",loading:"جارٍ التحميل…",failed:"فشل الطلب.",empty:"لا توجد سجلات.",createModel:"إنشاء طراز جهاز",registerDevice:"تسجيل جهاز",assign:"تغيير التعيين",rotate:"تدوير بيانات الاعتماد",revoke:"إلغاء",code:"الرمز",manufacturer:"الشركة المصنعة",model:"الطراز",type:"نوع الجهاز",observations:"رموز القياسات",serial:"الرقم التسلسلي",patient:"معرف المريض",provider:"معرف مقدم الخدمة",integration:"التكامل",status:"الحالة",version:"الإصدار",lastSeen:"آخر ظهور",credential:"المفتاح الخاص للجهاز لمرة واحدة",credentialWarning:"انسخ المفتاح الآن. لا يخزنه CarePoint ولن يظهر مرة أخرى.",createIntegration:"إنشاء موصل",providerName:"اسم المزود",publicKey:"المفتاح العام Ed25519 للويب هوك",scopes:"نطاقات القياسات",health:"الصحة",lastSuccess:"آخر نجاح",lastError:"آخر خطأ",activeOnly:"الأجهزة/الموصلات الملغاة لا يمكنها إدخال قياسات جديدة.",save:"حفظ",cancel:"إلغاء",noSecret:"تظهر فقط بصمات المفاتيح العامة وحالة بيانات الاعتماد دون أسرار خاصة."},
  fr:{refresh:"Actualiser",loading:"Chargement…",failed:"Échec de la requête.",empty:"Aucun enregistrement.",createModel:"Créer un modèle d’appareil",registerDevice:"Enregistrer un appareil",assign:"Modifier l’affectation",rotate:"Renouveler l’identifiant",revoke:"Révoquer",code:"Code",manufacturer:"Fabricant",model:"Modèle",type:"Type d’appareil",observations:"Codes d’observation",serial:"Numéro de série",patient:"ID patient",provider:"ID prestataire",integration:"Intégration",status:"Statut",version:"Version",lastSeen:"Dernier contact",credential:"Clé privée appareil à usage unique",credentialWarning:"Copiez cette clé maintenant. CarePoint ne la conserve pas et ne l’affichera plus.",createIntegration:"Créer un connecteur",providerName:"Nom du fournisseur",publicKey:"Clé publique Ed25519 du webhook",scopes:"Périmètres d’observation",health:"Santé",lastSuccess:"Dernier succès",lastError:"Dernière erreur",activeOnly:"Un appareil/connecteur révoqué ne peut plus ingérer de nouvelles observations.",save:"Enregistrer",cancel:"Annuler",noSecret:"Seules les empreintes de clés publiques et l’état des identifiants sont listés; aucun secret privé."},
  es:{refresh:"Actualizar",loading:"Cargando…",failed:"La solicitud falló.",empty:"Sin registros.",createModel:"Crear modelo de dispositivo",registerDevice:"Registrar dispositivo",assign:"Cambiar asignación",rotate:"Rotar credencial",revoke:"Revocar",code:"Código",manufacturer:"Fabricante",model:"Modelo",type:"Tipo de dispositivo",observations:"Códigos de observación",serial:"Número de serie",patient:"ID de paciente",provider:"ID de proveedor",integration:"Integración",status:"Estado",version:"Versión",lastSeen:"Último contacto",credential:"Clave privada del dispositivo (una sola vez)",credentialWarning:"Copia esta clave ahora. CarePoint no la almacena y no volverá a mostrarla.",createIntegration:"Crear conector",providerName:"Nombre del proveedor",publicKey:"Clave pública Ed25519 del webhook",scopes:"Scopes de observación",health:"Salud",lastSuccess:"Último éxito",lastError:"Último error",activeOnly:"Un dispositivo o conector revocado no puede ingerir nuevas observaciones.",save:"Guardar",cancel:"Cancelar",noSecret:"Solo se muestran fingerprints de claves públicas y estado de credenciales; nunca secretos privados."},
};

export function DeviceGovernanceConsole({section}:{section:Section}) {
  const {locale}=useI18n();
  const c=copy[locale];
  const [workspace,setWorkspace]=useState<Row|null>(null);
  const [integrations,setIntegrations]=useState<Row[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [oneTimeKey,setOneTimeKey]=useState<Row|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);
    try {
      if(section==="registry"){
        setWorkspace(asRow(await api("/devices")));
      } else {
        setIntegrations(list(await api("/integrations")));
      }
      setError("");
    } catch(value){ setError(message(value,c.failed)); }
    finally{ setLoading(false); }
  },[section,c.failed]);

  useEffect(()=>{void load();},[load]);

  async function createModel(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); const fd=new FormData(event.currentTarget);
    try{
      await api("/models",{method:"POST",body:{
        code:text(fd,"code"),manufacturer:text(fd,"manufacturer"),modelName:text(fd,"modelName"),
        deviceType:text(fd,"deviceType"),observationCodes:csv(fd.get("observationCodes")),
      }});
      event.currentTarget.reset(); await load();
    }catch(value){setError(message(value,c.failed));}
  }

  async function registerDevice(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); const fd=new FormData(event.currentTarget);
    try{
      await api("/devices",{method:"POST",body:{
        modelId:text(fd,"modelId"),serialNumber:text(fd,"serialNumber"),
        assignedPatientId:text(fd,"assignedPatientId")||null,
        assignedProviderId:text(fd,"assignedProviderId")||null,
        integrationId:text(fd,"integrationId")||null,
      }});
      event.currentTarget.reset(); await load();
    }catch(value){setError(message(value,c.failed));}
  }

  async function assignDevice(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); const fd=new FormData(event.currentTarget), id=text(fd,"deviceId");
    try{
      await api("/devices/"+encodeURIComponent(id)+"/assign",{method:"POST",body:{
        expectedVersion:Number(fd.get("expectedVersion")),
        assignedPatientId:text(fd,"assignedPatientId")||null,
        assignedProviderId:text(fd,"assignedProviderId")||null,
        integrationId:text(fd,"integrationId")||null,
      }});
      event.currentTarget.reset(); await load();
    }catch(value){setError(message(value,c.failed));}
  }

  async function rotate(row:Row){
    try{
      const value=asRow(await api("/devices/"+encodeURIComponent(String(row.id))+"/credentials/rotate",{
        method:"POST",body:{expectedVersion:Number(row.version)}
      }));
      setOneTimeKey(value); await load();
    }catch(value){setError(message(value,c.failed));}
  }

  async function revokeDevice(row:Row){
    try{
      await api("/devices/"+encodeURIComponent(String(row.id))+"/revoke",{
        method:"POST",body:{expectedVersion:Number(row.version)}
      });
      await load();
    }catch(value){setError(message(value,c.failed));}
  }

  async function createIntegration(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); const fd=new FormData(event.currentTarget);
    try{
      await api("/integrations",{method:"POST",body:{
        code:text(fd,"code"),providerName:text(fd,"providerName"),
        observationScopes:csv(fd.get("observationScopes")),
        webhookPublicKeyPem:text(fd,"webhookPublicKeyPem"),
      }});
      event.currentTarget.reset(); await load();
    }catch(value){setError(message(value,c.failed));}
  }

  async function revokeIntegration(row:Row){
    try{await api("/integrations/"+encodeURIComponent(String(row.id))+"/revoke",{method:"POST",body:{}});await load();}
    catch(value){setError(message(value,c.failed));}
  }

  if(section==="integrations") return <div className={styles.stack}>
    <Toolbar loading={loading} error={error} c={c} load={load}/>
    <section className={styles.notice}>{c.activeOnly}<br/>{c.noSecret}</section>
    <form className={styles.panel} onSubmit={createIntegration}>
      <h3>{c.createIntegration}</h3>
      <div className={styles.grid}>
        <Field name="code" label={c.code}/><Field name="providerName" label={c.providerName}/>
        <Field name="observationScopes" label={c.scopes} placeholder="HEART_RATE, OXYGEN_SATURATION"/>
      </div>
      <label>{c.publicKey}<textarea name="webhookPublicKeyPem" rows={6} required/></label>
      <button className={styles.primary}>{c.save}</button>
    </form>
    <section className={styles.panel}>
      <Table headers={[c.code,c.providerName,c.status,c.scopes,c.health,c.lastSuccess,c.lastError,c.revoke]}>
        {integrations.map(row=><tr key={String(row.id)}>
          <td><strong>{String(row.code)}</strong><small>{String(row.publicKeyFingerprint??"")}</small></td>
          <td>{String(row.providerName)}</td><td>{String(row.status)}</td>
          <td>{arr(row.observationScopes).join(", ")}</td><td>{String(row.healthState)}</td>
          <td>{fmt(row.lastSuccessAt)}</td><td>{String(row.lastErrorCode??"—")}</td>
          <td><button disabled={row.status!=="ACTIVE"} onClick={()=>void revokeIntegration(row)}>{c.revoke}</button></td>
        </tr>)}
      </Table>
      {!loading&&integrations.length===0?<p>{c.empty}</p>:null}
    </section>
  </div>;

  const models=list(workspace?.models), devices=list(workspace?.devices), connectorRows=list(workspace?.integrations);
  return <div className={styles.stack}>
    <Toolbar loading={loading} error={error} c={c} load={load}/>
    <section className={styles.notice}>{c.activeOnly}<br/>{c.noSecret}</section>
    {oneTimeKey?<section className={styles.secret}>
      <strong>{c.credential}</strong><p>{c.credentialWarning}</p>
      <pre>{String(oneTimeKey.privateKeyPem??"")}</pre>
      <small>{String(oneTimeKey.publicKeyFingerprint??"")}</small>
      <button onClick={()=>setOneTimeKey(null)}>{c.cancel}</button>
    </section>:null}
    <div className={styles.columns}>
      <form className={styles.panel} onSubmit={createModel}>
        <h3>{c.createModel}</h3>
        <Field name="code" label={c.code}/><Field name="manufacturer" label={c.manufacturer}/>
        <Field name="modelName" label={c.model}/>
        <label>{c.type}<select name="deviceType" defaultValue="BLOOD_PRESSURE"><option>BLOOD_PRESSURE</option><option>PULSE_OXIMETER</option><option>GLUCOSE_METER</option><option>WEARABLE</option><option>OTHER</option></select></label>
        <Field name="observationCodes" label={c.observations} placeholder="HEART_RATE, OXYGEN_SATURATION"/>
        <button className={styles.primary}>{c.save}</button>
      </form>
      <form className={styles.panel} onSubmit={registerDevice}>
        <h3>{c.registerDevice}</h3>
        <label>{c.model}<select name="modelId" required>{models.map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.code)} · {String(row.modelName)}</option>)}</select></label>
        <Field name="serialNumber" label={c.serial}/><Field name="assignedPatientId" label={c.patient}/>
        <Field name="assignedProviderId" label={c.provider}/>
        <label>{c.integration}<select name="integrationId" defaultValue=""><option value="">—</option>{connectorRows.filter(r=>r.status==="ACTIVE").map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.code)}</option>)}</select></label>
        <button className={styles.primary}>{c.save}</button>
      </form>
    </div>
    <form className={styles.panel} onSubmit={assignDevice}>
      <h3>{c.assign}</h3>
      <div className={styles.grid}>
        <label>{c.serial}<select name="deviceId" required>{devices.filter(r=>r.status==="ACTIVE").map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.serialNumber)}</option>)}</select></label>
        <Field name="expectedVersion" label={c.version} type="number"/>
        <Field name="assignedPatientId" label={c.patient}/><Field name="assignedProviderId" label={c.provider}/>
        <label>{c.integration}<select name="integrationId" defaultValue=""><option value="">—</option>{connectorRows.filter(r=>r.status==="ACTIVE").map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.code)}</option>)}</select></label>
      </div>
      <button className={styles.primary}>{c.save}</button>
    </form>
    <section className={styles.panel}>
      <Table headers={[c.serial,c.model,c.status,c.patient,c.provider,c.integration,c.version,c.lastSeen,c.credential,c.revoke]}>
        {devices.map(row=><tr key={String(row.id)}>
          <td><strong>{String(row.serialNumber)}</strong><small>{String(row.id)}</small></td>
          <td>{String(row.model?.code??"")}</td><td>{String(row.status)}</td>
          <td><small>{String(row.assignedPatientId??"—")}</small></td><td><small>{String(row.assignedProviderId??"—")}</small></td>
          <td>{String(row.integration?.code??"—")}</td><td>{String(row.version)}</td><td>{fmt(row.lastSeenAt)}</td>
          <td><button disabled={row.status!=="ACTIVE"} onClick={()=>void rotate(row)}>{c.rotate}</button></td>
          <td><button disabled={row.status!=="ACTIVE"} onClick={()=>void revokeDevice(row)}>{c.revoke}</button></td>
        </tr>)}
      </Table>
    </section>
  </div>;
}

function Toolbar({loading,error,c,load}:{loading:boolean;error:string;c:Copy;load:()=>Promise<void>}) {
  return <div className={styles.toolbar}><div>{loading?<span>{c.loading}</span>:null}{error?<span className={styles.error}>{error}</span>:null}</div><button onClick={()=>void load()}>{c.refresh}</button></div>;
}
function Field({name,label,type="text",placeholder}:{name:string;label:string;type?:string;placeholder?:string}){return <label>{label}<input name={name} type={type} placeholder={placeholder}/></label>;}
function Table({headers,children}:{headers:string[];children:React.ReactNode}){return <div className={styles.tableWrap}><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
async function api(path:string,options?:{method?:"POST";body?:unknown}) {
  const init:RequestInit={method:options?.method??"GET",cache:"no-store"};
  if(options?.body!==undefined){init.headers={"content-type":"application/json"};init.body=JSON.stringify(options.body);}
  const response=await fetch("/api/admin/device-governance"+path,init);
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof payload?.message==="string"?payload.message:"HTTP "+response.status);
  return payload;
}
function asRow(value:any):Row{return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function list(value:any):Row[]{return Array.isArray(value)?value.map(asRow):Array.isArray(value?.items)?value.items.map(asRow):[];}
function arr(value:any):string[]{return Array.isArray(value)?value.filter((v):v is string=>typeof v==="string"):[];}
function csv(value:FormDataEntryValue|null){return String(value??"").split(",").map(v=>v.trim().toUpperCase()).filter(Boolean);}
function text(fd:FormData,key:string){return String(fd.get(key)??"").trim();}
function fmt(value:any){return value?new Date(String(value)).toLocaleString():"—";}
function message(value:unknown,fallback:string){return value instanceof Error?value.message:fallback;}
