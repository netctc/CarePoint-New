"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./ClinicalGovernanceConsole.module.css";

type Labels={en?:string;ar?:string;fr?:string;es?:string};
type SafetyPolicy={scopePattern:string;version:string;resource:string;access:"READ"|"WRITE";allowedPurposes:string[];eligibleRoles:string[];temporaryShareable:boolean};
type Version={id:string;version:number;status:"DRAFT"|"ACTIVE"|"RETIRED";jurisdiction:string;titleLabels:Labels;bodyLabels:Labels;allowedPurposes:string[];eligibleRoles:string[];temporaryShareable:boolean;requireExpiry:boolean;maxGrantMinutes:number|null;regrantAllowed:boolean};
type Policy={id:string;scopePattern:string;jurisdiction:string;active:boolean;versions:Version[]};
type Catalog={runtimeJurisdiction:string;safetyCeiling:SafetyPolicy[];policies:Policy[];invariants:Record<string,boolean>;message?:string};

const copy:Record<Locale,Record<string,string>>={
  en:{title:"Consent policy versions",notice:"Managed policies may only restrict the core clinical-consent safety contract. Activated revisions are immutable and new consents pin the exact revision.",scope:"Core scope",jurisdiction:"Jurisdiction",createPolicy:"Create policy",policy:"Policy",titleLabels:"Title",bodyLabels:"Consent text",roles:"Eligible roles",temporary:"Temporary share",expiry:"Require expiry",maxMinutes:"Maximum grant minutes",regrant:"Allow re-grant",draft:"Create draft revision",activate:"Activate",versions:"Revisions",refresh:"Refresh",error:"Request failed.",global:"Runtime jurisdiction",empty:"No managed consent policies yet."},
  ar:{title:"إصدارات سياسات الموافقة",notice:"يمكن للسياسات المُدارة تقييد عقد أمان الموافقة السريرية الأساسي فقط. الإصدارات المفعلة غير قابلة للتعديل وتثبت الموافقات الجديدة الإصدار الدقيق.",scope:"النطاق الأساسي",jurisdiction:"الاختصاص",createPolicy:"إنشاء سياسة",policy:"السياسة",titleLabels:"العنوان",bodyLabels:"نص الموافقة",roles:"الأدوار المؤهلة",temporary:"مشاركة مؤقتة",expiry:"يتطلب انتهاء",maxMinutes:"الحد الأقصى بالدقائق",regrant:"السماح بإعادة المنح",draft:"إنشاء إصدار مسودة",activate:"تفعيل",versions:"الإصدارات",refresh:"تحديث",error:"فشل الطلب.",global:"اختصاص التشغيل",empty:"لا توجد سياسات موافقة مُدارة بعد."},
  fr:{title:"Versions des politiques de consentement",notice:"Les politiques gérées ne peuvent que restreindre le contrat de sécurité clinique de base. Les révisions activées sont immuables et les nouveaux consentements épinglent la révision exacte.",scope:"Périmètre de base",jurisdiction:"Juridiction",createPolicy:"Créer la politique",policy:"Politique",titleLabels:"Titre",bodyLabels:"Texte de consentement",roles:"Rôles éligibles",temporary:"Partage temporaire",expiry:"Expiration obligatoire",maxMinutes:"Durée maximale en minutes",regrant:"Autoriser le réaccord",draft:"Créer une révision brouillon",activate:"Activer",versions:"Révisions",refresh:"Actualiser",error:"Échec de la requête.",global:"Juridiction runtime",empty:"Aucune politique gérée."},
  es:{title:"Versiones de políticas de consentimiento",notice:"Las políticas gestionadas sólo pueden restringir el contrato de seguridad clínica base. Las revisiones activadas son inmutables y los nuevos consentimientos fijan la revisión exacta.",scope:"Scope base",jurisdiction:"Jurisdicción",createPolicy:"Crear política",policy:"Política",titleLabels:"Título",bodyLabels:"Texto de consentimiento",roles:"Roles elegibles",temporary:"Compartición temporal",expiry:"Exigir caducidad",maxMinutes:"Máximo de minutos",regrant:"Permitir regrant",draft:"Crear revisión borrador",activate:"Activar",versions:"Revisiones",refresh:"Actualizar",error:"La solicitud falló.",global:"Jurisdicción runtime",empty:"Aún no hay políticas gestionadas."},
};
const emptyLabels={en:"",ar:"",fr:"",es:""};

export function ConsentPolicyManager(){
  const {locale}=useI18n(); const t=copy[locale];
  const [catalog,setCatalog]=useState<Catalog>({runtimeJurisdiction:"GLOBAL",safetyCeiling:[],policies:[],invariants:{}});
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const [scope,setScope]=useState(""); const [jurisdiction,setJurisdiction]=useState("GLOBAL");
  const [policyId,setPolicyId]=useState(""); const [titles,setTitles]=useState({...emptyLabels}); const [bodies,setBodies]=useState({...emptyLabels});
  const [roles,setRoles]=useState<Set<string>>(new Set()); const [temporary,setTemporary]=useState(false);
  const [requireExpiry,setRequireExpiry]=useState(false); const [maxMinutes,setMaxMinutes]=useState("1440"); const [regrant,setRegrant]=useState(true);

  const load=useCallback(async()=>{
    setError("");
    try{
      const response=await fetch("/api/admin/consent-policies",{cache:"no-store"});
      const payload=await response.json() as Catalog;
      if(!response.ok)throw new Error(payload.message||t.error);
      setCatalog(payload); setScope(v=>v||payload.safetyCeiling[0]?.scopePattern||"");
      setPolicyId(v=>v&&payload.policies.some(p=>p.id===v)?v:(payload.policies[0]?.id||""));
    }catch(value){setError(value instanceof Error?value.message:(t.error ?? "Request failed."))}
  },[t.error]);
  useEffect(()=>{void load()},[load]);

  const selected=useMemo(()=>catalog.policies.find(p=>p.id===policyId)??null,[catalog.policies,policyId]);
  const ceiling=useMemo(()=>catalog.safetyCeiling.find(p=>p.scopePattern===(selected?.scopePattern||scope))??null,[catalog.safetyCeiling,selected,scope]);
  useEffect(()=>{if(ceiling){setRoles(new Set(ceiling.eligibleRoles));setTemporary(false)}},[ceiling?.scopePattern]);

  async function mutate(path:string,body:unknown){
    setBusy(true);setError("");
    try{
      const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json() as {message?:string};
      if(!response.ok)throw new Error(payload.message||t.error);
      await load();return true;
    }catch(value){setError(value instanceof Error?value.message:(t.error ?? "Request failed."));return false}
    finally{setBusy(false)}
  }
  async function createPolicy(){if(scope)await mutate("/api/admin/consent-policies",{scopePattern:scope,jurisdiction:jurisdiction.trim().toUpperCase()||"GLOBAL"})}
  async function createVersion(){
    if(!selected||!ceiling)return;
    const ok=await mutate("/api/admin/consent-policies/"+encodeURIComponent(selected.id)+"/versions",{
      titleLabels:titles,bodyLabels:bodies,allowedPurposes:ceiling.allowedPurposes,eligibleRoles:[...roles],
      temporaryShareable:temporary,requireExpiry,maxGrantMinutes:requireExpiry?Number(maxMinutes):null,regrantAllowed:regrant,
    });
    if(ok){setTitles({...emptyLabels});setBodies({...emptyLabels})}
  }
  async function activate(id:string,version:number){await mutate("/api/admin/consent-policies/"+encodeURIComponent(id)+"/versions/"+version+"/activate",{})}

  const inputStyle={border:"1px solid #cbd5e1",borderRadius:9,padding:9,background:"white",color:"#0f172a"} as const;
  return <div className={styles.stack}>
    <div className={styles.notice}>{t.notice}<br/><strong>{t.global}: {catalog.runtimeJurisdiction}</strong></div>
    {error?<div className={styles.error}>{error}</div>:null}
    <section className={styles.card}>
      <div className={styles.toolbar}><button disabled={busy} onClick={()=>void load()}>{t.refresh}</button></div>
      <h2>{t.title}</h2>
      <div className={styles.filters}>
        <label><span>{t.scope}</span><select style={inputStyle} value={scope} onChange={e=>setScope(e.target.value)}>{catalog.safetyCeiling.map(item=><option key={item.scopePattern}>{item.scopePattern}</option>)}</select></label>
        <label><span>{t.jurisdiction}</span><input value={jurisdiction} onChange={e=>setJurisdiction(e.target.value)} placeholder="GLOBAL"/></label>
      </div>
      <div className={styles.toolbar}><button disabled={busy||!scope} onClick={()=>void createPolicy()}>{t.createPolicy}</button></div>
    </section>

    <section className={styles.card}>
      <h2>{t.policy}</h2>
      {catalog.policies.length===0?<div className={styles.empty}>{t.empty}</div>:<>
        <div className={styles.filters}>
          <label><span>{t.policy}</span><select style={inputStyle} value={policyId} onChange={e=>setPolicyId(e.target.value)}>{catalog.policies.map(p=><option key={p.id} value={p.id}>{p.scopePattern} · {p.jurisdiction}</option>)}</select></label>
        </div>
        {selected&&ceiling?<div className={styles.stack}>
          <div className={styles.filters}>{(["en","ar","fr","es"] as const).map(lang=><label key={"title-"+lang}><span>{t.titleLabels} · {lang.toUpperCase()}</span><input value={titles[lang]} onChange={e=>setTitles({...titles,[lang]:e.target.value})}/></label>)}</div>
          <div className={styles.filters}>{(["en","ar","fr","es"] as const).map(lang=><label key={"body-"+lang}><span>{t.bodyLabels} · {lang.toUpperCase()}</span><textarea style={inputStyle} rows={3} value={bodies[lang]} onChange={e=>setBodies({...bodies,[lang]:e.target.value})}/></label>)}</div>
          <div><strong>{t.roles}</strong><div className={styles.pills}>{ceiling.eligibleRoles.map(role=><label key={role}><input type="checkbox" checked={roles.has(role)} onChange={e=>setRoles(prev=>{const next=new Set(prev);e.target.checked?next.add(role):next.delete(role);return next})}/>{role}</label>)}</div></div>
          <div className={styles.filters}><label><span>{t.maxMinutes}</span><input type="number" min="5" max="525600" value={maxMinutes} disabled={!requireExpiry} onChange={e=>setMaxMinutes(e.target.value)}/></label></div>
          <div className={styles.pills}>
            <label><input type="checkbox" checked={temporary} disabled={!ceiling.temporaryShareable} onChange={e=>setTemporary(e.target.checked)}/>{t.temporary}</label>
            <label><input type="checkbox" checked={requireExpiry} onChange={e=>setRequireExpiry(e.target.checked)}/>{t.expiry}</label>
            <label><input type="checkbox" checked={regrant} onChange={e=>setRegrant(e.target.checked)}/>{t.regrant}</label>
          </div>
          <div className={styles.toolbar}><button disabled={busy||roles.size===0} onClick={()=>void createVersion()}>{t.draft}</button></div>
        </div>:null}
      </>}
    </section>

    {catalog.policies.map(policy=><section className={styles.card} key={policy.id}>
      <h2>{policy.scopePattern} · {policy.jurisdiction}</h2>
      <div className={styles.tableWrap}><table><thead><tr><th>{t.versions}</th><th>Status</th><th>{t.roles}</th><th>{t.expiry}</th><th>{t.regrant}</th><th/></tr></thead><tbody>
        {policy.versions.map(version=><tr key={version.id}>
          <td>v{version.version}</td><td>{version.status}</td><td>{version.eligibleRoles.join(", ")}</td>
          <td>{version.requireExpiry?String(version.maxGrantMinutes):"—"}</td><td>{String(version.regrantAllowed)}</td>
          <td>{version.status==="DRAFT"?<button disabled={busy} onClick={()=>void activate(policy.id,version.version)}>{t.activate}</button>:null}</td>
        </tr>)}
      </tbody></table></div>
    </section>)}
  </div>;
}
