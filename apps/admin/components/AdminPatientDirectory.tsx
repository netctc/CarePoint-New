"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import { patientGovernanceText as pg } from "@/lib/patient-governance-i18n";
import { AdminPagination, clampPage } from "@/components/AdminPagination";
import styles from "./PatientGovernance.module.css";

type PatientRow = {
  id: string;
  displayName: string;
  accountStatus: string;
  identity: { emailMasked: string };
  verification: { mfaEnabled: boolean };
  operationalFlags: {
    temporarilyLocked: boolean;
    hasActiveConsent: boolean;
    hasActiveCoverage: boolean;
    dependentRelationshipCount: number;
    activeEmergencyCount: number;
    activeTransportCount: number;
  };
};
type DirectoryResponse = {
  privacyBoundary:string; clinicalDataIncluded:boolean; items:PatientRow[];
  total:number; page:number; pageSize:number; totalPages:number;
};
const c={
  en:{newPatient:"Create patient",first:"First name",last:"Last name",email:"Email",phone:"Phone",dob:"Date of birth",sex:"Sex",initialPassword:"Initial password (optional)",create:"Create patient",cancel:"Cancel",generated:"Generated temporary password — copy it now:",status:"Initial status"},
  es:{newPatient:"Crear paciente",first:"Nombre",last:"Apellidos",email:"Correo",phone:"Teléfono",dob:"Fecha de nacimiento",sex:"Sexo",initialPassword:"Contraseña inicial (opcional)",create:"Crear paciente",cancel:"Cancelar",generated:"Contraseña temporal generada — cópiala ahora:",status:"Estado inicial"},
  fr:{newPatient:"Créer un patient",first:"Prénom",last:"Nom",email:"E-mail",phone:"Téléphone",dob:"Date de naissance",sex:"Sexe",initialPassword:"Mot de passe initial (facultatif)",create:"Créer le patient",cancel:"Annuler",generated:"Mot de passe temporaire généré — copiez-le maintenant :",status:"Statut initial"},
  ar:{newPatient:"إنشاء مريض",first:"الاسم الأول",last:"اسم العائلة",email:"البريد",phone:"الهاتف",dob:"تاريخ الميلاد",sex:"الجنس",initialPassword:"كلمة المرور الأولية (اختياري)",create:"إنشاء المريض",cancel:"إلغاء",generated:"كلمة مرور مؤقتة تم إنشاؤها — انسخها الآن:",status:"الحالة الأولية"},
} satisfies Record<Locale,Record<string,string>>;

export function AdminPatientDirectory() {
  const { locale } = useI18n(); const t=c[locale];
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [total,setTotal]=useState(0);
  const [creating,setCreating]=useState(false);
  const [temporaryPassword,setTemporaryPassword]=useState("");
  const [form,setForm]=useState({firstName:"",lastName:"",email:"",phone:"",dateOfBirth:"",sex:"",status:"ACTIVE",temporaryPassword:""});

  const load = useCallback(async (targetPage=page,targetSize=pageSize) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({page:String(targetPage),pageSize:String(targetSize)});
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    try {
      const response = await fetch(`/api/admin/patients?${params}`, { cache: "no-store" });
      const payload = await response.json() as DirectoryResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || pg(locale, "error"));
      if (payload.clinicalDataIncluded !== false || payload.privacyBoundary !== "ADMINISTRATIVE_ONLY") throw new Error("Administrative privacy boundary is missing.");
      setRows(payload.items ?? []);setTotal(Number(payload.total??0));setPage(clampPage(targetPage,Number(payload.total??0),targetSize));
    } catch (value) { setError(value instanceof Error ? value.message : pg(locale, "error")); }
    finally { setLoading(false); }
  }, [locale, q, status, page, pageSize]);

  useEffect(() => { void load(1,pageSize); }, [locale]);

  async function createPatient(){
    setError("");setTemporaryPassword("");
    try{
      const response=await fetch("/api/admin/patients",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        firstName:form.firstName,lastName:form.lastName,email:form.email,phone:form.phone||null,dateOfBirth:form.dateOfBirth||null,sex:form.sex||null,status:form.status,
        ...(form.temporaryPassword?{temporaryPassword:form.temporaryPassword}:{})
      })});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(typeof body.message==="string"?body.message:pg(locale,"error"));
      if(typeof body.temporaryPassword==="string")setTemporaryPassword(body.temporaryPassword);
      setForm({firstName:"",lastName:"",email:"",phone:"",dateOfBirth:"",sex:"",status:"ACTIVE",temporaryPassword:""});
      setCreating(false);setPage(1);await load(1,pageSize);
    }catch(e){setError(e instanceof Error?e.message:pg(locale,"error"));}
  }

  return <>
    <div className={styles.notice}>{pg(locale, "privacy")}</div>
    {temporaryPassword?<div className={styles.notice}><strong>{t.generated}</strong> <code>{temporaryPassword}</code></div>:null}
    {error ? <div className={styles.error}>{error}</div> : null}
    <div className={styles.toolbar}>
      <label className="admin-form-field"><span>{pg(locale, "search")}</span><input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") {setPage(1);void load(1,pageSize);} }} placeholder={pg(locale, "search")} /></label>
      <label className="admin-form-field"><span>{pg(locale, "status")}</span><select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={pg(locale, "status")}>
        <option value="">{pg(locale, "all")}</option><option value="ACTIVE">ACTIVE</option><option value="SUSPENDED">SUSPENDED</option><option value="ARCHIVED">ARCHIVED</option>
      </select></label>
      <button className={styles.ghost} disabled={loading} onClick={() => {setPage(1);void load(1,pageSize);}}>{pg(locale, "refresh")}</button>
      <button className={styles.button} onClick={()=>setCreating(v=>!v)}>{creating?t.cancel:t.newPatient}</button>
    </div>

    {creating?<section className={styles.card} style={{marginBottom:16}}>
      <h3>ADM-PAT-001 · {t.newPatient}</h3>
      <div className="admin-form-grid admin-form-grid--wide">
        <label><span>{t.first}</span><input value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></label>
        <label><span>{t.last}</span><input value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></label>
        <label><span>{t.email}</span><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
        <label><span>{t.phone}</span><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
        <label><span>{t.dob}</span><input type="date" value={form.dateOfBirth} onChange={e=>setForm({...form,dateOfBirth:e.target.value})}/></label>
        <label><span>{t.sex}</span><input value={form.sex} onChange={e=>setForm({...form,sex:e.target.value})}/></label>
        <label><span>{t.status}</span><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option>ACTIVE</option><option>SUSPENDED</option><option>ARCHIVED</option></select></label>
        <label><span>{t.initialPassword}</span><input type="password" value={form.temporaryPassword} onChange={e=>setForm({...form,temporaryPassword:e.target.value})}/></label>
      </div>
      <div className="admin-form-actions"><button className={styles.button} disabled={!form.firstName.trim()||!form.lastName.trim()||!form.email.trim()} onClick={()=>void createPatient()}>{t.create}</button></div>
    </section>:null}

    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{pg(locale, "patient")}</th><th>{pg(locale, "identity")}</th><th>{pg(locale, "verification")}</th><th>{pg(locale, "signals")}</th><th /></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><strong>{row.displayName}</strong><div className={styles.muted}>{row.accountStatus}</div></td><td>{row.identity.emailMasked}</td><td><span className={`${styles.badge} ${row.verification.mfaEnabled ? styles.good : styles.warn}`}>{pg(locale, "mfa")}: {row.verification.mfaEnabled ? "ON" : "OFF"}</span>{row.operationalFlags.temporarilyLocked ? <span className={`${styles.badge} ${styles.danger}`}>{pg(locale, "locked")}</span> : null}</td><td>
        {row.operationalFlags.hasActiveConsent ? <span className={`${styles.badge} ${styles.good}`}>{pg(locale, "activeConsent")}</span> : null}
        {row.operationalFlags.hasActiveCoverage ? <span className={`${styles.badge} ${styles.good}`}>{pg(locale, "coverage")}</span> : null}
        {row.operationalFlags.activeEmergencyCount ? <span className={`${styles.badge} ${styles.danger}`}>{pg(locale, "emergency")}: {row.operationalFlags.activeEmergencyCount}</span> : null}
        {row.operationalFlags.activeTransportCount ? <span className={styles.badge}>{pg(locale, "transport")}: {row.operationalFlags.activeTransportCount}</span> : null}
      </td><td><Link className={styles.ghost} href={`/patients/${encodeURIComponent(row.id)}`}>{pg(locale, "open")}</Link></td></tr>)}
      {!loading && rows.length === 0 ? <tr><td colSpan={5} className={styles.empty}>{pg(locale, "noRows")}</td></tr> : null}
    </tbody></table></div>
    <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={(next)=>{setPage(next);void load(next,pageSize);}} onPageSizeChange={(size)=>{setPageSize(size);setPage(1);void load(1,size);}}/>
  </>;
}
