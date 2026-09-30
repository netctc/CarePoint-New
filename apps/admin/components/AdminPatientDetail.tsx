"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import { patientGovernanceText as pg } from "@/lib/patient-governance-i18n";
import { AdminPagination, paginateItems, clampPage } from "@/components/AdminPagination";
import styles from "./PatientGovernance.module.css";

type ContactChange={id:string;kind:string;requestedValue:string;status:string;requestedAt:string;verifiedAt:string|null};
type HistoryItem={id:string;action:string;objectType:string;objectId:string|null;purpose:string|null;result:string;occurredAt:string};
type DuplicateItem={patientId:string;displayName:string;accountStatus:string;emailMasked:string;phoneMasked:string|null;score:number;reasons:string[]};
type Detail = {
  privacyBoundary: string; clinicalDataIncluded: boolean;
  patient: { id:string; displayName:string; firstName:string; lastName:string; dateOfBirth?:string|null; sex?:string|null; contact:{email:string;phone:string|null}; account:{id:string;status:string;mfaEnabled:boolean;temporarilyLocked:boolean;failedLoginCount:number;createdAt:string;updatedAt:string}; createdAt:string; updatedAt:string };
  contactChanges:ContactChange[];
  dependents:{asDependent:Array<Record<string,unknown>>;asGuardian:Array<Record<string,unknown>>};
  consents:Array<{id:string;scope:string;version:string;purpose:string|null;state:string;effectiveState:string;grantedAt:string;expiresAt:string|null}>;
  insurance:Array<{id:string;payerCode:string;payerName:string;displayLabel:string;status:string;effectiveFrom:string;effectiveUntil:string|null}>;
  incidents:{activeEmergencyCount:number;activeTransportCount:number;deniedSecurityEventsLast30Days:Array<{action:string;objectType:string;result:string;occurredAt:string}>};
};
const copy={
  en:{admin:"Administrative maintenance",first:"First name",last:"Last name",dob:"Date of birth",sex:"Sex",save:"Save administrative profile",accountStatus:"Account status",reason:"Reason for change",applyStatus:"Apply status",reset:"Reset access",resetMfa:"Reset MFA",logout:"Force logout all sessions",history:"Change history",duplicates:"Possible duplicates",checkDuplicates:"Check duplicates",contact:"Email / phone change",kind:"Contact type",newValue:"New value",request:"Request change",verify:"Verify change",export:"Export administrative record",temporary:"Temporary password — copy it now:",confirmStatus:"Apply this account status change?",confirmReset:"Reset access, revoke sessions and issue a temporary password?",confirmMfa:"Reset MFA enrollment and revoke sessions?",confirmLogout:"Force logout all patient sessions?",none:"No records.",score:"Score",pending:"Pending contact changes"},
  es:{admin:"Mantenimiento administrativo",first:"Nombre",last:"Apellidos",dob:"Fecha de nacimiento",sex:"Sexo",save:"Guardar perfil administrativo",accountStatus:"Estado de cuenta",reason:"Motivo del cambio",applyStatus:"Aplicar estado",reset:"Resetear acceso",resetMfa:"Resetear MFA",logout:"Forzar cierre de todas las sesiones",history:"Historial de cambios",duplicates:"Posibles duplicados",checkDuplicates:"Buscar duplicados",contact:"Cambio de email / teléfono",kind:"Tipo de contacto",newValue:"Nuevo valor",request:"Solicitar cambio",verify:"Verificar cambio",export:"Exportar ficha administrativa",temporary:"Contraseña temporal — cópiala ahora:",confirmStatus:"¿Aplicar este cambio de estado?",confirmReset:"¿Resetear acceso, revocar sesiones y generar contraseña temporal?",confirmMfa:"¿Resetear MFA y revocar sesiones?",confirmLogout:"¿Forzar el cierre de todas las sesiones?",none:"Sin registros.",score:"Puntuación",pending:"Cambios de contacto pendientes"},
  fr:{admin:"Maintenance administrative",first:"Prénom",last:"Nom",dob:"Date de naissance",sex:"Sexe",save:"Enregistrer le profil administratif",accountStatus:"Statut du compte",reason:"Motif",applyStatus:"Appliquer le statut",reset:"Réinitialiser l’accès",resetMfa:"Réinitialiser MFA",logout:"Forcer la déconnexion de toutes les sessions",history:"Historique des modifications",duplicates:"Doublons possibles",checkDuplicates:"Rechercher les doublons",contact:"Changement e-mail / téléphone",kind:"Type de contact",newValue:"Nouvelle valeur",request:"Demander le changement",verify:"Vérifier le changement",export:"Exporter la fiche administrative",temporary:"Mot de passe temporaire — copiez-le maintenant :",confirmStatus:"Appliquer ce changement de statut ?",confirmReset:"Réinitialiser l’accès, révoquer les sessions et générer un mot de passe temporaire ?",confirmMfa:"Réinitialiser MFA et révoquer les sessions ?",confirmLogout:"Forcer la déconnexion de toutes les sessions ?",none:"Aucun enregistrement.",score:"Score",pending:"Changements de contact en attente"},
  ar:{admin:"الصيانة الإدارية",first:"الاسم الأول",last:"اسم العائلة",dob:"تاريخ الميلاد",sex:"الجنس",save:"حفظ الملف الإداري",accountStatus:"حالة الحساب",reason:"سبب التغيير",applyStatus:"تطبيق الحالة",reset:"إعادة ضبط الوصول",resetMfa:"إعادة ضبط MFA",logout:"إنهاء جميع الجلسات",history:"سجل التغييرات",duplicates:"احتمالات التكرار",checkDuplicates:"فحص التكرار",contact:"تغيير البريد / الهاتف",kind:"نوع الاتصال",newValue:"القيمة الجديدة",request:"طلب التغيير",verify:"تحقق من التغيير",export:"تصدير السجل الإداري",temporary:"كلمة مرور مؤقتة — انسخها الآن:",confirmStatus:"تطبيق تغيير حالة الحساب؟",confirmReset:"إعادة ضبط الوصول وإلغاء الجلسات وإنشاء كلمة مرور مؤقتة؟",confirmMfa:"إعادة ضبط MFA وإلغاء الجلسات؟",confirmLogout:"إنهاء جميع جلسات المريض؟",none:"لا توجد سجلات.",score:"النتيجة",pending:"تغييرات الاتصال المعلقة"},
} satisfies Record<Locale,Record<string,string>>;

export function AdminPatientDetail({ patientId }: { patientId: string }) {
  const { locale } = useI18n(); const t=copy[locale];
  const [data,setData]=useState<Detail|null>(null); const [error,setError]=useState(""); const [message,setMessage]=useState("");
  const [profile,setProfile]=useState({firstName:"",lastName:"",dateOfBirth:"",sex:""});
  const [accountStatus,setAccountStatus]=useState("ACTIVE"); const [reason,setReason]=useState("");
  const [temporaryPassword,setTemporaryPassword]=useState("");
  const [history,setHistory]=useState<HistoryItem[]>([]); const [historyLoaded,setHistoryLoaded]=useState(false);
  const [duplicates,setDuplicates]=useState<DuplicateItem[]>([]); const [duplicatesLoaded,setDuplicatesLoaded]=useState(false);
  const [contact,setContact]=useState({kind:"EMAIL",value:""});
  const [historyPage,setHistoryPage]=useState(1); const [historyPageSize,setHistoryPageSize]=useState(10);

  const load=useCallback(async()=>{setError("");try{
    const r=await fetch(`/api/admin/patients/${encodeURIComponent(patientId)}`,{cache:"no-store"});
    const p=await r.json() as Detail & {message?:string};
    if(!r.ok)throw new Error(p.message||pg(locale,"error"));
    if(p.clinicalDataIncluded!==false||p.privacyBoundary!=="ADMINISTRATIVE_ONLY")throw new Error("Administrative privacy boundary is missing.");
    setData(p);setProfile({firstName:p.patient.firstName,lastName:p.patient.lastName,dateOfBirth:p.patient.dateOfBirth?.slice(0,10)??"",sex:p.patient.sex??""});setAccountStatus(p.patient.account.status);
  }catch(e){setError(e instanceof Error?e.message:pg(locale,"error"));}},[patientId,locale]);
  useEffect(()=>{void load();},[load]);

  async function json(path:string,init?:RequestInit){
    const r=await fetch(path,{cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
    const b=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(typeof b.message==="string"?b.message:pg(locale,"error"));
    return b;
  }
  async function saveProfile(){setMessage("");try{await json(`/api/admin/patients/${encodeURIComponent(patientId)}`,{method:"PATCH",body:JSON.stringify({...profile,dateOfBirth:profile.dateOfBirth||null,sex:profile.sex||null})});setMessage("Saved.");await load();}catch(e){setError(String(e));}}
  async function applyStatus(){if(!reason.trim()||!window.confirm(t.confirmStatus))return;try{await json(`/api/admin/patients/${encodeURIComponent(patientId)}/status`,{method:"PATCH",body:JSON.stringify({status:accountStatus,reason})});setReason("");setMessage("Saved.");await load();}catch(e){setError(String(e));}}
  async function resetAccess(resetMfa=false){const prompt=resetMfa?t.confirmMfa:t.confirmReset;if(!window.confirm(prompt))return;try{const b=await json(`/api/admin/patients/${encodeURIComponent(patientId)}/access-reset`,{method:"POST",body:JSON.stringify({resetPassword:!resetMfa,resetMfa})});setTemporaryPassword(typeof b.temporaryPassword==="string"?b.temporaryPassword:"");setMessage("Access reset completed.");await load();}catch(e){setError(String(e));}}
  async function forceLogout(){if(!window.confirm(t.confirmLogout))return;try{const b=await json(`/api/admin/patients/${encodeURIComponent(patientId)}/logout`,{method:"POST",body:"{}"});setMessage(`Revoked sessions: ${b.revokedSessions??0}`);}catch(e){setError(String(e));}}
  async function loadHistory(){try{const b=await json(`/api/admin/patients/${encodeURIComponent(patientId)}/history`);const items=Array.isArray(b.items)?b.items:[];setHistory(items);setHistoryLoaded(true);setHistoryPage(1);}catch(e){setError(String(e));}}
  async function loadDuplicates(){try{const b=await json(`/api/admin/patients/${encodeURIComponent(patientId)}/duplicates`);setDuplicates(Array.isArray(b.items)?b.items:[]);setDuplicatesLoaded(true);}catch(e){setError(String(e));}}
  async function requestContact(){if(!contact.value.trim())return;try{await json(`/api/admin/patients/${encodeURIComponent(patientId)}/contact-changes`,{method:"POST",body:JSON.stringify({kind:contact.kind,value:contact.value})});setContact({...contact,value:""});setMessage("Contact change requested.");await load();}catch(e){setError(String(e));}}
  async function verifyContact(changeId:string){if(!window.confirm(t.verify+"?"))return;try{await json(`/api/admin/patients/${encodeURIComponent(patientId)}/contact-changes/${encodeURIComponent(changeId)}/verify`,{method:"POST",body:"{}"});setMessage("Contact change verified.");await load();}catch(e){setError(String(e));}}
  async function exportAdministrative(){try{const b=await json(`/api/admin/patients/${encodeURIComponent(patientId)}/export`);const blob=new Blob([JSON.stringify(b,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`carepoint-patient-admin-${patientId}.json`;a.click();URL.revokeObjectURL(url);}catch(e){setError(String(e));}}

  if(error&&!data) return <><div className={styles.error}>{error}</div><Link href="/patients">{pg(locale,"back")}</Link></>;
  if(!data) return <div className={styles.empty}>…</div>;
  const p=data.patient;
  const pendingChanges=(data.contactChanges??[]).filter(x=>x.status==="PENDING");
  const currentHistoryPage=clampPage(historyPage,history.length,historyPageSize);

  return <>
    <div className={styles.notice}>{pg(locale,"privacy")} · ADM-PAT-001 → ADM-PAT-010</div>
    {temporaryPassword?<div className={styles.notice}><strong>{t.temporary}</strong> <code>{temporaryPassword}</code></div>:null}
    {message?<div className={styles.notice}>{message}</div>:null}
    {error?<div className={styles.error}>{error}</div>:null}
    <div className={styles.headerRow}><div><strong>{p.displayName}</strong><div className={styles.muted}>{p.id}</div></div><div className={styles.actions}><button className={styles.ghost} onClick={()=>void exportAdministrative()}>{t.export}</button><Link className={styles.ghost} href="/patients">{pg(locale,"back")}</Link></div></div>

    <section className={styles.card} style={{marginBottom:16}}>
      <h3>{t.admin} · ADM-PAT-002 / ADM-PAT-003</h3>
      <div className="admin-form-grid admin-form-grid--wide">
        <label><span>{t.first}</span><input value={profile.firstName} onChange={e=>setProfile({...profile,firstName:e.target.value})}/></label>
        <label><span>{t.last}</span><input value={profile.lastName} onChange={e=>setProfile({...profile,lastName:e.target.value})}/></label>
        <label><span>{t.dob}</span><input type="date" value={profile.dateOfBirth} onChange={e=>setProfile({...profile,dateOfBirth:e.target.value})}/></label>
        <label><span>{t.sex}</span><input value={profile.sex} onChange={e=>setProfile({...profile,sex:e.target.value})}/></label>
        <label><span>{t.accountStatus}</span><select value={accountStatus} onChange={e=>setAccountStatus(e.target.value)}><option>ACTIVE</option><option>SUSPENDED</option><option>ARCHIVED</option></select></label>
        <label><span>{t.reason}</span><input value={reason} onChange={e=>setReason(e.target.value)}/></label>
      </div>
      <div className="admin-form-actions"><button className={styles.button} onClick={()=>void saveProfile()}>{t.save}</button><button className={styles.ghost} onClick={()=>void applyStatus()}>{t.applyStatus}</button></div>
    </section>

    <section className={styles.card} style={{marginBottom:16}}>
      <h3>ADM-PAT-004 / ADM-PAT-005 / ADM-PAT-007</h3>
      <div className={styles.row}><span>Email</span><strong>{p.contact.email}</strong></div>
      <div className={styles.row}><span>Phone</span><strong>{p.contact.phone||"—"}</strong></div>
      <div className={styles.row}><span>{pg(locale,"mfa")}</span><strong>{p.account.mfaEnabled?"ON":"OFF"}</strong></div>
      <div className={styles.row}><span>{pg(locale,"locked")}</span><strong>{p.account.temporarilyLocked?"YES":"NO"} · Failed logins: {p.account.failedLoginCount}</strong></div>
      <div className="admin-form-actions"><button className={styles.ghost} onClick={()=>void resetAccess(false)}>{t.reset}</button><button className={styles.ghost} onClick={()=>void resetAccess(true)}>{t.resetMfa}</button><button className={styles.ghost} onClick={()=>void forceLogout()}>{t.logout}</button></div>
    </section>

    <section className={styles.card} style={{marginBottom:16}}>
      <h3>{t.contact} · ADM-PAT-009</h3>
      <div className="admin-form-grid">
        <label><span>{t.kind}</span><select value={contact.kind} onChange={e=>setContact({...contact,kind:e.target.value})}><option>EMAIL</option><option>PHONE</option></select></label>
        <label><span>{t.newValue}</span><input value={contact.value} onChange={e=>setContact({...contact,value:e.target.value})}/></label>
      </div>
      <div className="admin-form-actions"><button className={styles.button} onClick={()=>void requestContact()}>{t.request}</button></div>
      <h3>{t.pending}</h3>
      {pendingChanges.map(ch=><div className={styles.row} key={ch.id}><span>{ch.kind}: {ch.requestedValue}<div className={styles.muted}>{new Date(ch.requestedAt).toLocaleString(locale)}</div></span><button className={styles.ghost} onClick={()=>void verifyContact(ch.id)}>{t.verify}</button></div>)}
      {!pendingChanges.length?<div className={styles.muted}>{t.none}</div>:null}
    </section>

    <section className={styles.card} style={{marginBottom:16}}>
      <h3>{t.duplicates} · ADM-PAT-008</h3>
      <button className={styles.ghost} onClick={()=>void loadDuplicates()}>{t.checkDuplicates}</button>
      {duplicatesLoaded?<div className={styles.list}>{duplicates.map(d=><div className={styles.row} key={d.patientId}><span><strong>{d.displayName}</strong><div className={styles.muted}>{d.emailMasked} · {d.phoneMasked??"—"} · {d.reasons.join(", ")}</div></span><span>{t.score}: {d.score} · <Link href={`/patients/${encodeURIComponent(d.patientId)}`}>{pg(locale,"open")}</Link></span></div>)}{!duplicates.length?<div className={styles.muted}>{t.none}</div>:null}</div>:null}
    </section>

    <div className={styles.grid}>
      <section className={styles.card}><h3>{pg(locale,"incidents")}</h3><div className={styles.list}><div className={styles.row}><span>{pg(locale,"emergency")}</span><strong>{data.incidents.activeEmergencyCount}</strong></div><div className={styles.row}><span>{pg(locale,"transport")}</span><strong>{data.incidents.activeTransportCount}</strong></div><div className={styles.row}><span>Denied events · 30d</span><strong>{data.incidents.deniedSecurityEventsLast30Days.length}</strong></div></div></section>
      <section className={styles.card}><h3>{pg(locale,"dependents")}</h3><div className={styles.muted}>As dependent: {data.dependents.asDependent.length} · As guardian: {data.dependents.asGuardian.length}</div>{[...data.dependents.asDependent,...data.dependents.asGuardian].slice(0,12).map((row,i)=><div className={styles.row} key={String(row.id??i)}><span>{String(row.relationshipType??"RELATION")}</span><strong>{String(row.status??"")}</strong></div>)}</section>
      <section className={styles.card}><h3>{pg(locale,"consents")}</h3>{data.consents.slice(0,12).map(cn=><div className={styles.row} key={cn.id}><span>{cn.scope}<div className={styles.muted}>{cn.version}{cn.purpose?` · ${cn.purpose}`:""}</div></span><strong>{cn.effectiveState}</strong></div>)}{!data.consents.length?<div className={styles.muted}>{pg(locale,"noRows")}</div>:null}</section>
      <section className={styles.card}><h3>{pg(locale,"insurance")}</h3>{data.insurance.map(cov=><div className={styles.row} key={cov.id}><span>{cov.displayLabel||cov.payerName}<div className={styles.muted}>{cov.payerCode}</div></span><strong>{cov.status}</strong></div>)}{!data.insurance.length?<div className={styles.muted}>{pg(locale,"noRows")}</div>:null}</section>
    </div>

    <section className={styles.card} style={{marginTop:16}}>
      <h3>{t.history} · ADM-PAT-006</h3>
      <button className={styles.ghost} onClick={()=>void loadHistory()}>{historyLoaded?pg(locale,"refresh"):t.history}</button>
      {historyLoaded?<>{paginateItems(history,currentHistoryPage,historyPageSize).map(item=><div className={styles.row} key={item.id}><span><strong>{item.action}</strong><div className={styles.muted}>{item.objectType} · {item.result}</div></span><span>{new Date(item.occurredAt).toLocaleString(locale)}</span></div>)}<AdminPagination page={currentHistoryPage} pageSize={historyPageSize} total={history.length} onPageChange={setHistoryPage} onPageSizeChange={(size)=>{setHistoryPageSize(size);setHistoryPage(1);}}/></>:null}
    </section>
  </>;
}
