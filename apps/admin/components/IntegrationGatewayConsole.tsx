"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./B6GovernanceCenter.module.css";

type Row = Record<string, any>;
type Kind = "fhir" | "labs";

const copy: Record<Locale, Record<string,string>> = {
  en:{refresh:"Refresh",loading:"Loading…",failed:"Request failed.",newConfig:"New connector",code:"Code",name:"Name",environment:"Environment",baseUrl:"Base URL",credential:"Credential reference",scopes:"Scopes (comma-separated)",create:"Create",test:"Test",activate:"Activate",mapping:"New mapping",resource:"FHIR resource",direction:"Direction",mappingJson:"Mapping JSON",publish:"Publish",status:"Status",lastTest:"Last test",mappings:"Mappings",sourceSystem:"Source system",healthPath:"Health path",publicKey:"Webhook Ed25519 public key",externalCode:"External test code",codeSystem:"Internal code system",internalCode:"Internal code",display:"Internal display",unit:"Canonical unit",events:"External result staging",order:"Clinical order",error:"Error",retry:"Retry",release:"Patient release remains professional-only",sandbox:"Production activation requires successful sandbox testing."},
  ar:{refresh:"تحديث",loading:"جارٍ التحميل…",failed:"فشل الطلب.",newConfig:"موصل جديد",code:"الرمز",name:"الاسم",environment:"البيئة",baseUrl:"عنوان الأساس",credential:"مرجع بيانات الاعتماد",scopes:"النطاقات (مفصولة بفواصل)",create:"إنشاء",test:"اختبار",activate:"تفعيل",mapping:"تعيين جديد",resource:"مورد FHIR",direction:"الاتجاه",mappingJson:"JSON للتعيين",publish:"نشر",status:"الحالة",lastTest:"آخر اختبار",mappings:"التعيينات",sourceSystem:"النظام المصدر",healthPath:"مسار الصحة",publicKey:"المفتاح العام Ed25519 للويب هوك",externalCode:"رمز الفحص الخارجي",codeSystem:"نظام الرمز الداخلي",internalCode:"الرمز الداخلي",display:"العرض الداخلي",unit:"الوحدة القياسية",events:"مرحلة نتائج المختبر الخارجي",order:"الطلب السريري",error:"الخطأ",retry:"إعادة المحاولة",release:"إتاحة النتيجة للمريض تتطلب اعتماداً مهنياً.",sandbox:"تفعيل الإنتاج يتطلب اختبار Sandbox ناجحاً."},
  fr:{refresh:"Actualiser",loading:"Chargement…",failed:"Échec de la requête.",newConfig:"Nouveau connecteur",code:"Code",name:"Nom",environment:"Environnement",baseUrl:"URL de base",credential:"Référence d’identifiant",scopes:"Scopes (séparés par virgules)",create:"Créer",test:"Tester",activate:"Activer",mapping:"Nouveau mapping",resource:"Ressource FHIR",direction:"Direction",mappingJson:"JSON mapping",publish:"Publier",status:"Statut",lastTest:"Dernier test",mappings:"Mappings",sourceSystem:"Système source",healthPath:"Chemin santé",publicKey:"Clé publique Ed25519 du webhook",externalCode:"Code de test externe",codeSystem:"Système de code interne",internalCode:"Code interne",display:"Libellé interne",unit:"Unité canonique",events:"Staging résultats externes",order:"Ordre clinique",error:"Erreur",retry:"Réessayer",release:"La diffusion au patient reste soumise à validation professionnelle.",sandbox:"L’activation production exige un test sandbox réussi."},
  es:{refresh:"Actualizar",loading:"Cargando…",failed:"La solicitud falló.",newConfig:"Nuevo conector",code:"Código",name:"Nombre",environment:"Entorno",baseUrl:"URL base",credential:"Referencia de credencial",scopes:"Scopes (separados por comas)",create:"Crear",test:"Probar",activate:"Activar",mapping:"Nuevo mapping",resource:"Recurso FHIR",direction:"Dirección",mappingJson:"JSON de mapping",publish:"Publicar",status:"Estado",lastTest:"Última prueba",mappings:"Mappings",sourceSystem:"Sistema origen",healthPath:"Ruta health",publicKey:"Clave pública Ed25519 del webhook",externalCode:"Código externo de prueba",codeSystem:"Sistema de código interno",internalCode:"Código interno",display:"Descripción interna",unit:"Unidad canónica",events:"Staging de resultados externos",order:"Orden clínica",error:"Error",retry:"Reintentar",release:"La liberación al paciente sigue requiriendo validación profesional.",sandbox:"Activar producción exige una prueba sandbox satisfactoria."},
};

export function IntegrationGatewayConsole({kind}:{kind:Kind}) {
  const {locale}=useI18n();
  const c=copy[locale];
  const [data,setData]=useState<Row>({}),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const configs=useMemo(()=>list(data),[data]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{setData(asRow(await api("/integrations/"+kind)));setError("");}
    catch(e){setError(message(e,c.failed));}
    finally{setLoading(false);}
  },[kind,c.failed]);

  useEffect(()=>{void load();},[load]);

  async function mutate(path:string,body?:unknown){
    try{await api(path,{method:"POST",body:body??{}});await load();}
    catch(e){setError(message(e,c.failed));}
  }

  async function createConfig(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const common={
      code:text(fd,"code").toUpperCase(),
      displayName:text(fd,"displayName"),
      environment:text(fd,"environment"),
      baseUrl:text(fd,"baseUrl"),
      credentialReference:text(fd,"credentialReference")||undefined,
    };
    const body=kind==="fhir"
      ? {...common,scopes:csv(fd.get("scopes"))}
      : {...common,sourceSystem:text(fd,"sourceSystem"),healthPath:text(fd,"healthPath")||"/health",webhookPublicKeyPem:text(fd,"webhookPublicKeyPem")};
    await mutate("/integrations/"+kind+"/configs",body);
    e.currentTarget.reset();
  }

  async function createMapping(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const fd=new FormData(e.currentTarget), configId=text(fd,"configId");
    if(kind==="fhir"){
      let mapping:unknown;
      try{mapping=JSON.parse(text(fd,"mapping"));}catch{setError("Invalid mapping JSON.");return;}
      await mutate("/integrations/fhir/configs/"+encodeURIComponent(configId)+"/mappings",{
        resourceType:text(fd,"resourceType"),direction:text(fd,"direction"),mapping,
      });
    }else{
      await mutate("/integrations/labs/configs/"+encodeURIComponent(configId)+"/mappings",{
        externalCode:text(fd,"externalCode"),internalCodeSystem:text(fd,"internalCodeSystem"),
        internalCode:text(fd,"internalCode"),internalDisplay:text(fd,"internalDisplay"),
        canonicalUnit:text(fd,"canonicalUnit")||undefined,
      });
    }
    e.currentTarget.reset();
  }

  return <div className={styles.workspace}>
    <div className={styles.toolbar}>
      <div>{loading?<span>{c.loading}</span>:null}{error?<span className={styles.notice}>{error}</span>:null}</div>
      <button onClick={()=>void load()}>{c.refresh}</button>
    </div>

    <section className={styles.panel}>
      <div className={styles.notice}>{c.sandbox}</div>
      {kind==="labs"?<div className={styles.notice}>{c.release}</div>:null}
      <h3>{c.newConfig}</h3>
      <form onSubmit={createConfig}>
        <div className={styles.grid2}>
          <Field name="code" label={c.code} required/>
          <Field name="displayName" label={c.name} required/>
          <label>{c.environment}<select name="environment" defaultValue="SANDBOX"><option>SANDBOX</option><option>PRODUCTION</option></select></label>
          <Field name="baseUrl" label={c.baseUrl} placeholder="https://sandbox.example/" required/>
          <Field name="credentialReference" label={c.credential}/>
          {kind==="fhir"?<Field name="scopes" label={c.scopes} placeholder="system/Patient.read,system/Observation.read"/>:<>
            <Field name="sourceSystem" label={c.sourceSystem} required/>
            <Field name="healthPath" label={c.healthPath} placeholder="/health"/>
            <label>{c.publicKey}<textarea name="webhookPublicKeyPem" required/></label>
          </>}
        </div>
        <button className={styles.primary}>{c.create}</button>
      </form>
    </section>

    <section className={styles.panel}>
      <h3>{c.mapping}</h3>
      <form onSubmit={createMapping}>
        <div className={styles.grid2}>
          <label>Connector<select name="configId" required>{configs.map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.code)} · {String(row.environment)}</option>)}</select></label>
          {kind==="fhir"?<>
            <Field name="resourceType" label={c.resource} placeholder="Patient" required/>
            <label>{c.direction}<select name="direction" defaultValue="OUTBOUND"><option>OUTBOUND</option><option>INBOUND</option><option>BIDIRECTIONAL</option></select></label>
            <label>{c.mappingJson}<textarea name="mapping" defaultValue={JSON.stringify({fields:[{sourcePath:"id",targetPath:"id",transform:"DIRECT"}]})} required/></label>
          </>:<>
            <Field name="externalCode" label={c.externalCode} required/>
            <Field name="internalCodeSystem" label={c.codeSystem} required/>
            <Field name="internalCode" label={c.internalCode} required/>
            <Field name="internalDisplay" label={c.display} required/>
            <Field name="canonicalUnit" label={c.unit}/>
          </>}
        </div>
        <button className={styles.primary} disabled={configs.length===0}>{c.create}</button>
      </form>
    </section>

    <section className={styles.panel}>
      <h3>{kind==="fhir"?"FHIR Gateway": "Lab Gateway"}</h3>
      <div className={styles.tableWrap}><table><thead><tr><th>{c.code}</th><th>{c.environment}</th><th>{c.status}</th><th>{c.lastTest}</th><th>{c.mappings}</th><th>Actions</th></tr></thead>
      <tbody>{configs.map(row=><tr key={String(row.id)}>
        <td><strong>{String(row.displayName)}</strong><small>{String(row.code)} · {String(row.baseUrl)}</small></td>
        <td>{String(row.environment)}</td>
        <td>{row.enabled?"ACTIVE":"INACTIVE"}<small>{String(row.lastErrorCode??"")}</small></td>
        <td>{String(row.lastTestStatus??"—")}<small>{fmt(row.lastTestAt)}</small></td>
        <td>{Array.isArray(row.mappings)?row.mappings.map((m:Row)=><div key={String(m.id)}><span>{kind==="fhir"?String(m.resourceType):String(m.externalCode)} · v{String(m.version)} · {String(m.status)}</span>{m.status==="DRAFT"?<button type="button" onClick={()=>void mutate("/integrations/"+kind+"/mappings/"+encodeURIComponent(String(m.id))+"/publish")}>{c.publish}</button>:null}</div>):null}</td>
        <td><button type="button" onClick={()=>void mutate("/integrations/"+kind+"/configs/"+encodeURIComponent(String(row.id))+"/test")}>{c.test}</button><button type="button" onClick={()=>void mutate("/integrations/"+kind+"/configs/"+encodeURIComponent(String(row.id))+"/activate")}>{c.activate}</button></td>
      </tr>)}</tbody></table></div>
    </section>

    {kind==="labs"?<section className={styles.panel}>
      <h3>{c.events}</h3>
      <div className={styles.tableWrap}><table><thead><tr><th>ID</th><th>{c.order}</th><th>{c.sourceSystem}</th><th>{c.status}</th><th>{c.error}</th><th>{c.retry}</th></tr></thead>
      <tbody>{asList(data.events).map(row=><tr key={String(row.id)}><td><small>{String(row.externalEventId)}</small></td><td>{String(row.clinicalOrderId)}</td><td>{String(row.sourceSystem)}</td><td>{String(row.status)}<small>patientVisible={String(row.patientVisible)}</small></td><td>{String(row.lastErrorCode??"—")}</td><td>{row.status==="QUARANTINED"?<button onClick={()=>void mutate("/integrations/labs/events/"+encodeURIComponent(String(row.id))+"/retry")}>{c.retry}</button>:"—"}</td></tr>)}</tbody></table></div>
    </section>:null}
  </div>;
}

function Field({name,label,placeholder,required=false}:{name:string;label:string;placeholder?:string;required?:boolean}){
  return <label>{label}<input name={name} placeholder={placeholder} required={required}/></label>;
}
async function api(path:string,options?:{method?:"POST";body?:unknown}){
  const init:RequestInit={method:options?.method??"GET",cache:"no-store"};
  if(options?.body!==undefined){init.headers={"content-type":"application/json"};init.body=JSON.stringify(options.body);}
  const response=await fetch("/api/admin/b6"+path,init);
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof payload?.message==="string"?payload.message:"HTTP "+response.status);
  return payload;
}
function asRow(value:any):Row{return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function list(value:any):Row[]{return Array.isArray(value?.items)?value.items.map(asRow):[];}
function asList(value:any):Row[]{return Array.isArray(value)?value.map(asRow):[];}
function text(fd:FormData,key:string){return String(fd.get(key)??"").trim();}
function csv(value:FormDataEntryValue|null){return String(value??"").split(",").map(x=>x.trim()).filter(Boolean);}
function fmt(value:any){return value?new Date(String(value)).toLocaleString():"—";}
function message(value:unknown,fallback:string){return value instanceof Error?value.message:fallback;}
