"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { patientGovernanceText as pg } from "@/lib/patient-governance-i18n";
import styles from "./PatientGovernance.module.css";

type Detail = {
  privacyBoundary: string; clinicalDataIncluded: boolean;
  patient: { id:string; displayName:string; firstName:string; lastName:string; contact:{email:string;phone:string|null}; account:{id:string;status:string;mfaEnabled:boolean;temporarilyLocked:boolean;failedLoginCount:number;createdAt:string;updatedAt:string}; createdAt:string; updatedAt:string };
  dependents:{asDependent:Array<Record<string,unknown>>;asGuardian:Array<Record<string,unknown>>};
  consents:Array<{id:string;scope:string;version:string;purpose:string|null;state:string;effectiveState:string;grantedAt:string;expiresAt:string|null}>;
  insurance:Array<{id:string;payerCode:string;payerName:string;displayLabel:string;status:string;effectiveFrom:string;effectiveUntil:string|null}>;
  incidents:{activeEmergencyCount:number;activeTransportCount:number;deniedSecurityEventsLast30Days:Array<{action:string;objectType:string;result:string;occurredAt:string}>};
};

export function AdminPatientDetail({ patientId }: { patientId: string }) {
  const { locale } = useI18n(); const [data,setData]=useState<Detail|null>(null); const [error,setError]=useState("");
  useEffect(() => { let active=true; void (async()=>{ try { const r=await fetch(`/api/admin/patients/${encodeURIComponent(patientId)}`,{cache:"no-store"}); const p=await r.json() as Detail & {message?:string}; if(!r.ok) throw new Error(p.message||pg(locale,"error")); if(p.clinicalDataIncluded!==false||p.privacyBoundary!=="ADMINISTRATIVE_ONLY") throw new Error("Administrative privacy boundary is missing."); if(active)setData(p); } catch(e){ if(active)setError(e instanceof Error?e.message:pg(locale,"error")); } })(); return()=>{active=false}; },[patientId,locale]);
  if(error) return <><div className={styles.error}>{error}</div><Link href="/patients">{pg(locale,"back")}</Link></>;
  if(!data) return <div className={styles.empty}>…</div>;
  const p=data.patient;
  return <><div className={styles.notice}>{pg(locale,"privacy")}</div><div className={styles.headerRow}><div><strong>{p.displayName}</strong><div className={styles.muted}>{p.id}</div></div><Link className={styles.ghost} href="/patients">{pg(locale,"back")}</Link></div>
    <div className={styles.grid}>
      <section className={styles.card}><h3>{pg(locale,"account")}</h3><div className={styles.list}><div className={styles.row}><span>Email</span><strong>{p.contact.email}</strong></div><div className={styles.row}><span>Phone</span><strong>{p.contact.phone||"—"}</strong></div><div className={styles.row}><span>{pg(locale,"status")}</span><strong>{p.account.status}</strong></div><div className={styles.row}><span>{pg(locale,"mfa")}</span><strong>{p.account.mfaEnabled?"ON":"OFF"}</strong></div><div className={styles.row}><span>Failed logins</span><strong>{p.account.failedLoginCount}</strong></div></div></section>
      <section className={styles.card}><h3>{pg(locale,"incidents")}</h3><div className={styles.list}><div className={styles.row}><span>{pg(locale,"emergency")}</span><strong>{data.incidents.activeEmergencyCount}</strong></div><div className={styles.row}><span>{pg(locale,"transport")}</span><strong>{data.incidents.activeTransportCount}</strong></div><div className={styles.row}><span>Denied events · 30d</span><strong>{data.incidents.deniedSecurityEventsLast30Days.length}</strong></div></div></section>
      <section className={styles.card}><h3>{pg(locale,"dependents")}</h3><div className={styles.muted}>As dependent: {data.dependents.asDependent.length} · As guardian: {data.dependents.asGuardian.length}</div>{[...data.dependents.asDependent,...data.dependents.asGuardian].slice(0,12).map((row,i)=><div className={styles.row} key={String(row.id??i)}><span>{String(row.relationshipType??"RELATION")}</span><strong>{String(row.status??"")}</strong></div>)}</section>
      <section className={styles.card}><h3>{pg(locale,"consents")}</h3>{data.consents.slice(0,12).map(c=><div className={styles.row} key={c.id}><span>{c.scope}<div className={styles.muted}>{c.version}{c.purpose?` · ${c.purpose}`:""}</div></span><strong>{c.effectiveState}</strong></div>)}{!data.consents.length?<div className={styles.muted}>{pg(locale,"noRows")}</div>:null}</section>
      <section className={styles.card}><h3>{pg(locale,"insurance")}</h3>{data.insurance.map(c=><div className={styles.row} key={c.id}><span>{c.displayLabel||c.payerName}<div className={styles.muted}>{c.payerCode}</div></span><strong>{c.status}</strong></div>)}{!data.insurance.length?<div className={styles.muted}>{pg(locale,"noRows")}</div>:null}</section>
      <section className={styles.card}><h3>Security events · 30d</h3>{data.incidents.deniedSecurityEventsLast30Days.map((e,i)=><div className={styles.row} key={`${e.occurredAt}-${i}`}><span>{e.action}<div className={styles.muted}>{e.objectType}</div></span><strong>{new Date(e.occurredAt).toLocaleString(locale)}</strong></div>)}{!data.incidents.deniedSecurityEventsLast30Days.length?<div className={styles.muted}>{pg(locale,"noRows")}</div>:null}</section>
    </div></>;
}
