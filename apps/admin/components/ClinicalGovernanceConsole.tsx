"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./ClinicalGovernanceConsole.module.css";

type ConsentPolicy = {
  scopePattern:string; version:string; resource:string; access:"READ"|"WRITE";
  allowedPurposes:string[]; eligibleRoles:string[]; temporaryShareable:boolean;
};
type RoleMatrix = { role:string; permissions:string[] };
type ProviderCategory = {
  id:string; slug:string; family:string;
  capabilities:{
    enabledModalities:string[]; clinicalOrderCapabilities:string[];
    clinicalSummarySections:string[]; observationCodes:string[];
    questionnaireCodes:string[]; workflowCapabilities:string[];
  };
};
type MatrixResponse = {
  roles:RoleMatrix[]; clinicalConsentPolicies:ConsentPolicy[];
  otherProviderCategories:ProviderCategory[];
  invariants:Record<string,boolean>;
  message?:string;
};
type PoliciesResponse = { purposeModel:string[]; policies:ConsentPolicy[]; temporaryShareMaximumMinutes:number; message?:string };
type AuditEvent = {
  id:string; actorId:string|null; action:string; objectType:string; objectId:string|null;
  purpose:string|null; result:string; metadata:Record<string,unknown>; occurredAt:string;
};
type AuditResponse = { limit:number; candidateLimit:number; items:AuditEvent[]; message?:string };

const copy = {
  en: {
    refresh:"Refresh", error:"Request failed.", policyTitle:"Effective consent policies",
    matrixTitle:"Role / scope access matrix", categoryTitle:"Other Provider capability overlays",
    invariants:"Enforced invariants", temporary:"Temporary-share maximum", minutes:"minutes",
    scope:"Scope", version:"Version", resource:"Resource", access:"Access", purposes:"Purposes", roles:"Eligible roles",
    role:"Role", permissions:"Effective permissions", category:"Category", capabilities:"Capabilities",
    auditTitle:"Clinical access audit explorer", filters:"Filters", actor:"Actor ID", patient:"Patient ID",
    provider:"Provider ID", action:"Action", objectType:"Object type", objectId:"Object ID",
    purpose:"Purpose", result:"Outcome", from:"From", to:"To", apply:"Apply filters", clear:"Clear",
    export:"Export authorized CSV", occurred:"Occurred", object:"Object", metadata:"Sanitized metadata",
    empty:"No matching events.", auditNotice:"Only audit fields already authorized and sanitized by the API are displayed or exported.",
    matrixNotice:"This matrix is read from the same backend policy/capability sources used for authorization. It does not grant access by itself.",
  },
  ar: {
    refresh:"تحديث", error:"فشل الطلب.", policyTitle:"سياسات الموافقة الفعلية",
    matrixTitle:"مصفوفة وصول الأدوار والنطاقات", categoryTitle:"قدرات فئات مقدمي الخدمة الآخرين",
    invariants:"ثوابت مفروضة", temporary:"الحد الأقصى للمشاركة المؤقتة", minutes:"دقيقة",
    scope:"النطاق", version:"الإصدار", resource:"المورد", access:"الوصول", purposes:"الأغراض", roles:"الأدوار المؤهلة",
    role:"الدور", permissions:"الصلاحيات الفعلية", category:"الفئة", capabilities:"القدرات",
    auditTitle:"مستكشف تدقيق الوصول السريري", filters:"المرشحات", actor:"معرّف المنفذ", patient:"معرّف المريض",
    provider:"معرّف مقدم الخدمة", action:"الإجراء", objectType:"نوع الكائن", objectId:"معرّف الكائن",
    purpose:"الغرض", result:"النتيجة", from:"من", to:"إلى", apply:"تطبيق المرشحات", clear:"مسح",
    export:"تصدير CSV المصرح", occurred:"الوقت", object:"الكائن", metadata:"بيانات وصفية منقحة",
    empty:"لا توجد أحداث مطابقة.", auditNotice:"يتم عرض وتصدير الحقول التي سمحت بها الواجهة البرمجية ونقحتها فقط.",
    matrixNotice:"تُقرأ هذه المصفوفة من نفس مصادر السياسة والقدرات التي يطبقها الخادم ولا تمنح وصولاً بحد ذاتها.",
  },
  fr: {
    refresh:"Actualiser", error:"Échec de la requête.", policyTitle:"Politiques de consentement effectives",
    matrixTitle:"Matrice d’accès rôles / périmètres", categoryTitle:"Capacités des catégories Other Provider",
    invariants:"Invariants appliqués", temporary:"Partage temporaire maximum", minutes:"minutes",
    scope:"Périmètre", version:"Version", resource:"Ressource", access:"Accès", purposes:"Finalités", roles:"Rôles éligibles",
    role:"Rôle", permissions:"Permissions effectives", category:"Catégorie", capabilities:"Capacités",
    auditTitle:"Explorateur d’audit des accès cliniques", filters:"Filtres", actor:"ID acteur", patient:"ID patient",
    provider:"ID prestataire", action:"Action", objectType:"Type d’objet", objectId:"ID objet",
    purpose:"Finalité", result:"Résultat", from:"De", to:"À", apply:"Appliquer", clear:"Effacer",
    export:"Exporter le CSV autorisé", occurred:"Date", object:"Objet", metadata:"Métadonnées assainies",
    empty:"Aucun événement correspondant.", auditNotice:"Seuls les champs d’audit déjà autorisés et assainis par l’API sont affichés ou exportés.",
    matrixNotice:"Cette matrice provient des mêmes sources de politiques/capacités que l’autorisation backend. Elle n’accorde aucun accès.",
  },
  es: {
    refresh:"Actualizar", error:"La solicitud falló.", policyTitle:"Políticas efectivas de consentimiento",
    matrixTitle:"Matriz de acceso por rol / scope", categoryTitle:"Capacidades de categorías Other Provider",
    invariants:"Invariantes aplicadas", temporary:"Máximo de compartición temporal", minutes:"minutos",
    scope:"Scope", version:"Versión", resource:"Recurso", access:"Acceso", purposes:"Finalidades", roles:"Roles elegibles",
    role:"Rol", permissions:"Permisos efectivos", category:"Categoría", capabilities:"Capabilities",
    auditTitle:"Audit Explorer de acceso clínico", filters:"Filtros", actor:"ID de actor", patient:"ID de paciente",
    provider:"ID de proveedor", action:"Acción", objectType:"Tipo de objeto", objectId:"ID de objeto",
    purpose:"Finalidad", result:"Resultado", from:"Desde", to:"Hasta", apply:"Aplicar filtros", clear:"Limpiar",
    export:"Exportar CSV autorizado", occurred:"Fecha", object:"Objeto", metadata:"Metadatos sanitizados",
    empty:"No hay eventos coincidentes.", auditNotice:"Solo se muestran o exportan los campos ya autorizados y sanitizados por la API.",
    matrixNotice:"Esta matriz se obtiene de las mismas políticas/capabilities que aplica el backend. No concede acceso por sí sola.",
  },
} as const;

export function ConsentAccessMatrix() {
  const { locale } = useI18n();
  const t = copy[locale];
  const [policies,setPolicies]=useState<PoliciesResponse|null>(null);
  const [matrix,setMatrix]=useState<MatrixResponse|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    setBusy(true); setError("");
    try {
      const [p,m]=await Promise.all([
        fetch("/api/admin/clinical-access/policies",{cache:"no-store"}),
        fetch("/api/admin/clinical-access/matrix",{cache:"no-store"}),
      ]);
      const pp=await p.json() as PoliciesResponse;
      const mm=await m.json() as MatrixResponse;
      if(!p.ok) throw new Error(pp.message||t.error);
      if(!m.ok) throw new Error(mm.message||t.error);
      setPolicies(pp); setMatrix(mm);
    } catch(value) { setError(value instanceof Error?value.message:t.error); }
    finally { setBusy(false); }
  },[t.error]);

  useEffect(()=>{void load()},[load]);
  if(busy) return <div className={styles.notice}>…</div>;
  return <div className={styles.stack}>
    <div className={styles.notice}>{t.matrixNotice}</div>
    {error?<div className={styles.error}>{error}</div>:null}
    <div className={styles.toolbar}><button onClick={()=>void load()}>{t.refresh}</button></div>
    <section className={styles.card}>
      <h2>{t.policyTitle}</h2>
      <p>{t.temporary}: <strong>{policies?.temporaryShareMaximumMinutes ?? 0}</strong> {t.minutes}</p>
      <div className={styles.tableWrap}><table><thead><tr>
        <th>{t.scope}</th><th>{t.version}</th><th>{t.resource}</th><th>{t.access}</th><th>{t.purposes}</th><th>{t.roles}</th>
      </tr></thead><tbody>
        {(policies?.policies??[]).map(item=><tr key={item.scopePattern}>
          <td><code>{item.scopePattern}</code></td><td>{item.version}</td><td>{item.resource}</td><td>{item.access}</td>
          <td>{item.allowedPurposes.join(", ")}</td><td>{item.eligibleRoles.join(", ")}</td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className={styles.card}>
      <h2>{t.matrixTitle}</h2>
      <div className={styles.matrixGrid}>
        {(matrix?.roles??[]).map(item=><article key={item.role}><strong>{item.role}</strong><p>{item.permissions.join(" · ")}</p></article>)}
      </div>
    </section>

    <section className={styles.card}>
      <h2>{t.categoryTitle}</h2>
      <div className={styles.matrixGrid}>
        {(matrix?.otherProviderCategories??[]).map(item=><article key={item.id}>
          <strong>{item.slug}</strong><small>{item.family}</small>
          <p>{flattenCapabilities(item.capabilities).join(" · ")||"—"}</p>
        </article>)}
      </div>
    </section>

    <section className={styles.card}>
      <h2>{t.invariants}</h2>
      <div className={styles.pills}>{Object.entries(matrix?.invariants??{}).map(([key,value])=><span key={key} data-ok={value}>{key}: {String(value)}</span>)}</div>
    </section>
  </div>;
}

const emptyFilters = {
  actorId:"", patientId:"", providerId:"", action:"", objectType:"", objectId:"",
  purpose:"", result:"", from:"", to:"",
};

export function ClinicalAccessAuditExplorer() {
  const { locale } = useI18n();
  const t = copy[locale];
  const [filters,setFilters]=useState(emptyFilters);
  const [applied,setApplied]=useState(emptyFilters);
  const [data,setData]=useState<AuditResponse>({limit:100,candidateLimit:500,items:[]});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const query=useMemo(()=>{
    const q=new URLSearchParams({limit:"100"});
    for(const [key,value] of Object.entries(applied)) if(value.trim()) q.set(key,value.trim());
    return q.toString();
  },[applied]);

  const load=useCallback(async()=>{
    setBusy(true); setError("");
    try{
      const response=await fetch("/api/admin/clinical-access/audit?"+query,{cache:"no-store"});
      const payload=await response.json() as AuditResponse;
      if(!response.ok) throw new Error(payload.message||t.error);
      setData(payload);
    }catch(value){setError(value instanceof Error?value.message:t.error)}
    finally{setBusy(false)}
  },[query,t.error]);

  useEffect(()=>{void load()},[load]);

  function update(key:keyof typeof emptyFilters,value:string){setFilters(prev=>({...prev,[key]:value}))}
  function clear(){setFilters(emptyFilters);setApplied(emptyFilters)}
  function exportCsv(){
    const header=["id","occurredAt","actorId","action","objectType","objectId","purpose","result","metadata"];
    const rows=data.items.map(item=>[
      item.id,item.occurredAt,item.actorId??"",item.action,item.objectType,item.objectId??"",
      item.purpose??"",item.result,JSON.stringify(item.metadata??{}),
    ]);
    const csv=[header,...rows].map(row=>row.map(csvCell).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url; anchor.download="carepoint-clinical-access-audit.csv"; anchor.click();
    URL.revokeObjectURL(url);
  }

  const fields: Array<[keyof typeof emptyFilters,string,string]> = [
    ["actorId",t.actor,"text"],["patientId",t.patient,"text"],["providerId",t.provider,"text"],
    ["action",t.action,"text"],["objectType",t.objectType,"text"],["objectId",t.objectId,"text"],
    ["purpose",t.purpose,"text"],["result",t.result,"text"],["from",t.from,"datetime-local"],["to",t.to,"datetime-local"],
  ];

  return <div className={styles.stack}>
    <div className={styles.notice}>{t.auditNotice}</div>
    <section className={styles.card}>
      <h2>{t.filters}</h2>
      <div className={styles.filters}>{fields.map(([key,label,type])=><label key={key}><span>{label}</span><input type={type} value={filters[key]} onChange={e=>update(key,e.target.value)}/></label>)}</div>
      <div className={styles.toolbar}>
        <button onClick={()=>setApplied(filters)} disabled={busy}>{t.apply}</button>
        <button onClick={clear} disabled={busy}>{t.clear}</button>
        <button onClick={exportCsv} disabled={busy||data.items.length===0}>{t.export}</button>
      </div>
      {error?<div className={styles.error}>{error}</div>:null}
    </section>

    <section className={styles.card}>
      <h2>{t.auditTitle}</h2>
      <div className={styles.tableWrap}><table><thead><tr>
        <th>{t.occurred}</th><th>{t.actor}</th><th>{t.action}</th><th>{t.object}</th><th>{t.purpose}</th><th>{t.result}</th><th>{t.metadata}</th>
      </tr></thead><tbody>
        {data.items.map(item=><tr key={item.id}>
          <td>{formatDate(item.occurredAt,locale)}</td><td><code>{item.actorId??"—"}</code></td><td>{item.action}</td>
          <td>{item.objectType}<br/><code>{item.objectId??"—"}</code></td><td>{item.purpose??"—"}</td><td>{item.result}</td>
          <td><code>{JSON.stringify(item.metadata??{})}</code></td>
        </tr>)}
      </tbody></table></div>
      {!data.items.length?<div className={styles.empty}>{t.empty}</div>:null}
    </section>
  </div>;
}

function flattenCapabilities(value:ProviderCategory["capabilities"]){
  return [
    ...value.enabledModalities,...value.clinicalOrderCapabilities,...value.clinicalSummarySections,
    ...value.observationCodes,...value.questionnaireCodes,...value.workflowCapabilities,
  ];
}
function csvCell(value:string){return '"' + value.replaceAll('"','""') + '"'}
function formatDate(value:string,locale:Locale){
  const d=new Date(value); if(!Number.isFinite(d.getTime()))return value;
  return new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short"}).format(d);
}
