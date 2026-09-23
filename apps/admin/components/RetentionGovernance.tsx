"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import styles from "./PrivacyOperations.module.css";

type PolicyVersion = { version:number; retentionDays:number; action:string; createdAt?:string };
type Policy = { id:string; code:string; domain:string; jurisdiction:string; currentVersion:number; active:boolean; versions?:PolicyVersion[] };
type LegalHold = { id:string; domain:string; jurisdiction:string; subjectType:string; subjectId?:string|null; reasonCode:string; startsAt:string; expiresAt?:string|null; releasedAt?:string|null };

const domains = ["CLINICAL_DOCUMENT","CLINICAL_MEDIA","CLINICAL_DOCUMENT_ACCESS_GRANT","CLINICAL_MEDIA_ACCESS_GRANT","AUDIT_EVENT"] as const;
const holdDomains = ["CLINICAL_DOCUMENT","CLINICAL_MEDIA","AUDIT_EVENT"] as const;
const actions = ["SOFT_REMOVE","PURGE_EXPIRED_GRANTS","PROTECT_ONLY"] as const;

const copy = {
  en:{ exports:"Patient exports", retention:"Retention & legal hold", intro:"Versioned retention policies and legal holds. Destructive execution is not performed from this screen; governance configuration remains explicit and auditable.", policies:"Policies", holds:"Legal holds", createPolicy:"Create policy", code:"Code", domain:"Domain", jurisdiction:"Jurisdiction", days:"Retention days", action:"Action", create:"Create", publish:"Publish next version", current:"Current version", active:"Active", createHold:"Create legal hold", scope:"Scope", subjectId:"Subject ID", reason:"Reason code", status:"Status", release:"Release", refresh:"Refresh", error:"Privacy governance request failed.", empty:"No records." },
  ar:{ exports:"تصدير بيانات المريض", retention:"الاحتفاظ والتعليق القانوني", intro:"سياسات احتفاظ بإصدارات وتعليقات قانونية. لا يتم تنفيذ الحذف من هذه الشاشة؛ تظل الحوكمة صريحة وقابلة للتدقيق.", policies:"السياسات", holds:"التعليقات القانونية", createPolicy:"إنشاء سياسة", code:"الرمز", domain:"المجال", jurisdiction:"الاختصاص", days:"أيام الاحتفاظ", action:"الإجراء", create:"إنشاء", publish:"نشر إصدار جديد", current:"الإصدار الحالي", active:"نشط", createHold:"إنشاء تعليق قانوني", scope:"النطاق", subjectId:"معرف الموضوع", reason:"رمز السبب", status:"الحالة", release:"إنهاء", refresh:"تحديث", error:"فشل طلب حوكمة الخصوصية.", empty:"لا توجد سجلات." },
  fr:{ exports:"Exports patient", retention:"Rétention et legal hold", intro:"Politiques de rétention versionnées et legal holds. Aucune suppression n’est exécutée depuis cet écran; la gouvernance reste explicite et auditée.", policies:"Politiques", holds:"Legal holds", createPolicy:"Créer une politique", code:"Code", domain:"Domaine", jurisdiction:"Juridiction", days:"Jours de rétention", action:"Action", create:"Créer", publish:"Publier la version suivante", current:"Version actuelle", active:"Active", createHold:"Créer un legal hold", scope:"Portée", subjectId:"ID sujet", reason:"Code motif", status:"Statut", release:"Libérer", refresh:"Actualiser", error:"Échec de la requête de gouvernance.", empty:"Aucun enregistrement." },
  es:{ exports:"Exportaciones del paciente", retention:"Retención y legal hold", intro:"Políticas de retención versionadas y legal holds. Esta pantalla no ejecuta borrado destructivo; la configuración de governance permanece explícita y auditada.", policies:"Políticas", holds:"Legal holds", createPolicy:"Crear política", code:"Código", domain:"Dominio", jurisdiction:"Jurisdicción", days:"Días de retención", action:"Acción", create:"Crear", publish:"Publicar nueva versión", current:"Versión actual", active:"Activa", createHold:"Crear legal hold", scope:"Ámbito", subjectId:"ID del sujeto", reason:"Código de motivo", status:"Estado", release:"Liberar", refresh:"Actualizar", error:"Falló la operación de governance de privacidad.", empty:"No hay registros." },
} as const;

async function jsonRequest(path:string, init?:RequestInit) {
  const response = await fetch(path, { cache:"no-store", credentials:"same-origin", ...init, headers:{ "content-type":"application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : "Request failed");
  return body;
}

export function RetentionGovernance() {
  const { locale } = useI18n();
  const t = copy[locale];
  const [policies,setPolicies] = useState<Policy[]>([]);
  const [holds,setHolds] = useState<LegalHold[]>([]);
  const [error,setError] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const [policyForm,setPolicyForm] = useState({ code:"", domain:"CLINICAL_DOCUMENT", jurisdiction:"SA", retentionDays:"3650", action:"SOFT_REMOVE" });
  const [holdForm,setHoldForm] = useState({ domain:"CLINICAL_DOCUMENT", jurisdiction:"SA", subjectType:"GLOBAL", subjectId:"", reasonCode:"LEGAL_REQUIREMENT" });

  const load = useCallback(async()=>{
    setError(null);
    try {
      const [policyBody,holdBody] = await Promise.all([
        jsonRequest("/api/admin/privacy/retention/policies"),
        jsonRequest("/api/admin/privacy/retention/legal-holds"),
      ]);
      setPolicies(Array.isArray(policyBody) ? policyBody : []);
      setHolds(Array.isArray(holdBody) ? holdBody : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.error); }
  },[t.error]);

  useEffect(()=>{ void load(); },[load]);

  const activeHoldCount = useMemo(()=>holds.filter((hold)=>!hold.releasedAt).length,[holds]);

  async function createPolicy(event:FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await jsonRequest("/api/admin/privacy/retention/policies", { method:"POST", body:JSON.stringify({ ...policyForm, retentionDays:Number(policyForm.retentionDays) }) });
      setPolicyForm((value)=>({ ...value, code:"" })); await load();
    } catch(cause){ setError(cause instanceof Error ? cause.message : t.error); } finally { setBusy(false); }
  }

  async function publish(policy:Policy) {
    const latest = policy.versions?.[0];
    if (!latest) return;
    setBusy(true); setError(null);
    try {
      await jsonRequest(`/api/admin/privacy/retention/policies/${encodeURIComponent(policy.id)}/versions`, { method:"POST", body:JSON.stringify({ expectedVersion:policy.currentVersion, retentionDays:latest.retentionDays, action:latest.action }) });
      await load();
    } catch(cause){ setError(cause instanceof Error ? cause.message : t.error); } finally { setBusy(false); }
  }

  async function createHold(event:FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const payload = { ...holdForm, subjectId:holdForm.subjectType === "GLOBAL" ? null : holdForm.subjectId };
      await jsonRequest("/api/admin/privacy/retention/legal-holds", { method:"POST", body:JSON.stringify(payload) });
      await load();
    } catch(cause){ setError(cause instanceof Error ? cause.message : t.error); } finally { setBusy(false); }
  }

  async function release(hold:LegalHold) {
    setBusy(true); setError(null);
    try {
      await jsonRequest(`/api/admin/privacy/retention/legal-holds/${encodeURIComponent(hold.id)}/release`, { method:"POST", body:JSON.stringify({ reasonCode:"ADMIN_RELEASE" }) });
      await load();
    } catch(cause){ setError(cause instanceof Error ? cause.message : t.error); } finally { setBusy(false); }
  }

  return <div className={styles.stack}>
    <div className={styles.tabs}><Link className={styles.tab} href="/privacy/exports">{t.exports}</Link><Link className={`${styles.tab} ${styles.tabActive}`} href="/privacy/retention">{t.retention}</Link></div>
    <p className={styles.muted}>{t.intro}</p>
    {error ? <div className={styles.error}>{error}</div> : null}
    <div className={styles.grid}><div className={styles.card}><span className={styles.muted}>{t.policies}</span><strong>{policies.length}</strong></div><div className={styles.card}><span className={styles.muted}>{t.holds}</span><strong>{activeHoldCount}</strong></div></div>
    <section className={styles.card}><strong>{t.createPolicy}</strong><form className={styles.form} onSubmit={createPolicy}>
      <div className={styles.field}><label>{t.code}</label><input className={styles.input} required value={policyForm.code} onChange={(e)=>setPolicyForm({...policyForm,code:e.target.value.toUpperCase()})}/></div>
      <div className={styles.field}><label>{t.domain}</label><select className={styles.select} value={policyForm.domain} onChange={(e)=>setPolicyForm({...policyForm,domain:e.target.value})}>{domains.map((value)=><option key={value}>{value}</option>)}</select></div>
      <div className={styles.field}><label>{t.jurisdiction}</label><input className={styles.input} required value={policyForm.jurisdiction} onChange={(e)=>setPolicyForm({...policyForm,jurisdiction:e.target.value.toUpperCase()})}/></div>
      <div className={styles.field}><label>{t.days}</label><input className={styles.input} type="number" min="1" required value={policyForm.retentionDays} onChange={(e)=>setPolicyForm({...policyForm,retentionDays:e.target.value})}/></div>
      <div className={styles.field}><label>{t.action}</label><select className={styles.select} value={policyForm.action} onChange={(e)=>setPolicyForm({...policyForm,action:e.target.value})}>{actions.map((value)=><option key={value}>{value}</option>)}</select></div>
      <button className={styles.button} disabled={busy}>{t.create}</button>
    </form></section>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{t.code}</th><th>{t.domain}</th><th>{t.jurisdiction}</th><th>{t.current}</th><th>{t.days}</th><th>{t.action}</th><th /></tr></thead><tbody>{policies.length===0?<tr><td className={styles.empty} colSpan={7}>{t.empty}</td></tr>:policies.map((policy)=>{const latest=policy.versions?.[0];return <tr key={policy.id}><td>{policy.code}</td><td>{policy.domain}</td><td>{policy.jurisdiction}</td><td>{policy.currentVersion}</td><td>{latest?.retentionDays ?? "—"}</td><td>{latest?.action ?? "—"}</td><td><button className={styles.buttonSecondary} disabled={busy||!latest} onClick={()=>void publish(policy)}>{t.publish}</button></td></tr>})}</tbody></table></div>
    <section className={styles.card}><strong>{t.createHold}</strong><form className={styles.form} onSubmit={createHold}>
      <div className={styles.field}><label>{t.domain}</label><select className={styles.select} value={holdForm.domain} onChange={(e)=>setHoldForm({...holdForm,domain:e.target.value})}>{holdDomains.map((value)=><option key={value}>{value}</option>)}</select></div>
      <div className={styles.field}><label>{t.jurisdiction}</label><input className={styles.input} required value={holdForm.jurisdiction} onChange={(e)=>setHoldForm({...holdForm,jurisdiction:e.target.value.toUpperCase()})}/></div>
      <div className={styles.field}><label>{t.scope}</label><select className={styles.select} value={holdForm.subjectType} onChange={(e)=>setHoldForm({...holdForm,subjectType:e.target.value})}><option>GLOBAL</option><option>PATIENT</option><option>ENTITY</option></select></div>
      {holdForm.subjectType!=="GLOBAL"?<div className={styles.field}><label>{t.subjectId}</label><input className={styles.input} required value={holdForm.subjectId} onChange={(e)=>setHoldForm({...holdForm,subjectId:e.target.value})}/></div>:null}
      <div className={styles.field}><label>{t.reason}</label><input className={styles.input} required value={holdForm.reasonCode} onChange={(e)=>setHoldForm({...holdForm,reasonCode:e.target.value.toUpperCase()})}/></div>
      <button className={styles.button} disabled={busy}>{t.create}</button>
    </form></section>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{t.domain}</th><th>{t.jurisdiction}</th><th>{t.scope}</th><th>{t.subjectId}</th><th>{t.reason}</th><th>{t.status}</th><th /></tr></thead><tbody>{holds.length===0?<tr><td className={styles.empty} colSpan={7}>{t.empty}</td></tr>:holds.map((hold)=><tr key={hold.id}><td>{hold.domain}</td><td>{hold.jurisdiction}</td><td>{hold.subjectType}</td><td>{hold.subjectId ?? "—"}</td><td>{hold.reasonCode}</td><td><span className={styles.status}>{hold.releasedAt?"RELEASED":"ACTIVE"}</span></td><td>{!hold.releasedAt?<button className={styles.buttonSecondary} disabled={busy} onClick={()=>void release(hold)}>{t.release}</button>:null}</td></tr>)}</tbody></table></div>
    <button className={styles.buttonSecondary} type="button" onClick={()=>void load()} disabled={busy}>{t.refresh}</button>
  </div>;
}
