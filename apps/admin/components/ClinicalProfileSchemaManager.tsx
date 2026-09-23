"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { patientGovernanceText as pg } from "@/lib/patient-governance-i18n";
import styles from "./PatientGovernance.module.css";

type SchemaRow = { id:string;jurisdiction:string;version:number;revision:number;status:"DRAFT"|"PUBLISHED"|"RETIRED";definition:Record<string,unknown>;createdAt:string;updatedAt:string;publishedAt:string|null;retiredAt:string|null;mutable:boolean };
type ListPayload = { items: SchemaRow[]; invariants: Record<string,boolean>; message?:string };

const seedDefinition = {
  schemaKey:"patient-clinical-profile",
  labels:{en:"Clinical profile",ar:"الملف السريري",fr:"Profil clinique",es:"Perfil clínico"},
  sections:[{key:"general",labels:{en:"General",ar:"عام",fr:"Général",es:"General"},fields:[{key:"notes",type:"TEXTAREA",required:false,labels:{en:"Notes",ar:"ملاحظات",fr:"Notes",es:"Notas"}}]}],
};

export function ClinicalProfileSchemaManager() {
  const { locale }=useI18n(); const [jurisdiction,setJurisdiction]=useState("GLOBAL"); const [items,setItems]=useState<SchemaRow[]>([]); const [selected,setSelected]=useState<SchemaRow|null>(null); const [json,setJson]=useState(JSON.stringify(seedDefinition,null,2)); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const endpoint=useMemo(()=>`/api/admin/clinical/profile-schema?jurisdiction=${encodeURIComponent(jurisdiction.trim().toUpperCase())}`,[jurisdiction]);
  const load=useCallback(async()=>{setError("");try{const r=await fetch(endpoint,{cache:"no-store"});const p=await r.json() as ListPayload;if(!r.ok)throw new Error(p.message||pg(locale,"error"));setItems(p.items??[]);}catch(e){setError(e instanceof Error?e.message:pg(locale,"error"));}},[endpoint,locale]);
  useEffect(()=>{void load()},[load]);
  function choose(row:SchemaRow){setSelected(row);setJurisdiction(row.jurisdiction);setJson(JSON.stringify(row.definition,null,2));}
  function parsed():Record<string,unknown>{const value=JSON.parse(json) as unknown;if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Definition must be a JSON object.");return value as Record<string,unknown>}
  async function create(){setBusy(true);setError("");try{const r=await fetch("/api/admin/clinical/profile-schema",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jurisdiction:jurisdiction.trim().toUpperCase(),definition:parsed()})});const p=await r.json() as SchemaRow&{message?:string};if(!r.ok)throw new Error(p.message||pg(locale,"error"));choose(p);await load();}catch(e){setError(e instanceof Error?e.message:pg(locale,"error"));}finally{setBusy(false)}}
  async function patch(body:Record<string,unknown>){if(!selected)return;setBusy(true);setError("");try{const r=await fetch(`/api/admin/clinical/profile-schema/${encodeURIComponent(selected.id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const p=await r.json() as SchemaRow&{message?:string};if(!r.ok)throw new Error(p.message||pg(locale,"error"));choose(p);await load();}catch(e){setError(e instanceof Error?e.message:pg(locale,"error"));}finally{setBusy(false)}}
  return <><div className={styles.notice}>{pg(locale,"immutable")}</div>{error?<div className={styles.error}>{error}</div>:null}<div className={styles.toolbar}><input className={styles.input} value={jurisdiction} onChange={e=>setJurisdiction(e.target.value.toUpperCase())} placeholder={pg(locale,"jurisdiction")}/><button className={styles.ghost} disabled={busy} onClick={()=>void load()}>{pg(locale,"refresh")}</button><button className={styles.button} disabled={busy} onClick={()=>void create()}>{pg(locale,"create")}</button></div>
  <div className={styles.schemaGrid}><div className={styles.schemaList}>{items.map(row=><button className={styles.schemaItem} key={row.id} onClick={()=>choose(row)}><strong>{row.jurisdiction} · v{row.version}</strong><div className={styles.muted}>{pg(locale,"revision")} {row.revision} · {row.status}</div></button>)}{!items.length?<div className={styles.empty}>{pg(locale,"noRows")}</div>:null}</div><section className={styles.card}><div className={styles.headerRow}><div><strong>{selected?`${selected.jurisdiction} · v${selected.version}`:pg(locale,"definition")}</strong>{selected?<div className={styles.muted}>{pg(locale,"state")}: {selected.status} · {pg(locale,"revision")}: {selected.revision}</div>:null}</div></div><textarea className={styles.textarea} value={json} onChange={e=>setJson(e.target.value)} disabled={Boolean(selected&&!selected.mutable)} spellCheck={false}/><div className={styles.actions}>{selected?.mutable?<><button className={styles.button} disabled={busy} onClick={()=>void patch({expectedRevision:selected.revision,definition:parsed()})}>{pg(locale,"save")}</button><button className={styles.ghost} disabled={busy} onClick={()=>void patch({expectedRevision:selected.revision,action:"PUBLISH"})}>{pg(locale,"publish")}</button></>:null}{selected?.status==="PUBLISHED"?<button className={styles.ghost} disabled={busy} onClick={()=>void patch({expectedRevision:selected.revision,action:"RETIRE"})}>{pg(locale,"retire")}</button>:null}</div></section></div></>;
}
