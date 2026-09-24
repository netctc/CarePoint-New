"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./PatientEducationCatalog.module.css";

type Labels = { en?: string; ar?: string; fr?: string; es?: string };
type Version = {
  id:string; contentId:string; version:number; status:"DRAFT"|"PUBLISHED"|"RETIRED";
  labels:Labels; bodyLabels:Labels; sourceName:string; sourceUrl:string|null;
  publishedAt:string|null; retiredAt:string|null; createdAt:string;
};
type Content = { id:string; code:string; active:boolean; versions:Version[] };
type Catalog = { items:Content[]; message?:string };

const locales: Locale[] = ["en","ar","fr","es"];
const copy = {
  en:{title:"Patient education catalog",eyebrow:"P2 · ADM-109",notice:"Only approved, versioned education content should be assigned clinically. Publishing a new version retires the previous published version without deleting historical assignments.",definitions:"Content definitions",newContent:"New content",code:"Code",create:"Create",versions:"Versions",newVersion:"New draft version",labels:"Title",body:"Patient content",sourceName:"Source name",sourceUrl:"Source URL (HTTPS)",createVersion:"Create draft",publish:"Publish",refresh:"Refresh",empty:"No education content configured.",select:"Select a content definition.",source:"Source",published:"Published",retired:"Retired",draft:"Draft",error:"Request failed.",saved:"Saved.",active:"Active",version:"Version"},
  ar:{title:"كتالوج تثقيف المريض",eyebrow:"P2 · ADM-109",notice:"يجب إسناد محتوى تثقيفي معتمد وذو إصدار فقط. نشر إصدار جديد يُحيل الإصدار المنشور السابق للتقاعد دون حذف الإسنادات التاريخية.",definitions:"تعريفات المحتوى",newContent:"محتوى جديد",code:"الرمز",create:"إنشاء",versions:"الإصدارات",newVersion:"إصدار مسودة جديد",labels:"العنوان",body:"محتوى المريض",sourceName:"اسم المصدر",sourceUrl:"رابط المصدر (HTTPS)",createVersion:"إنشاء مسودة",publish:"نشر",refresh:"تحديث",empty:"لا يوجد محتوى تثقيفي مهيأ.",select:"اختر تعريف المحتوى.",source:"المصدر",published:"منشور",retired:"متقاعد",draft:"مسودة",error:"فشل الطلب.",saved:"تم الحفظ.",active:"نشط",version:"الإصدار"},
  fr:{title:"Catalogue d’éducation du patient",eyebrow:"P2 · ADM-109",notice:"Seul un contenu approuvé et versionné doit être attribué cliniquement. Publier une nouvelle version retire l’ancienne sans supprimer les attributions historiques.",definitions:"Définitions de contenu",newContent:"Nouveau contenu",code:"Code",create:"Créer",versions:"Versions",newVersion:"Nouvelle version brouillon",labels:"Titre",body:"Contenu patient",sourceName:"Nom de la source",sourceUrl:"URL source (HTTPS)",createVersion:"Créer le brouillon",publish:"Publier",refresh:"Actualiser",empty:"Aucun contenu éducatif configuré.",select:"Sélectionnez une définition.",source:"Source",published:"Publié",retired:"Retiré",draft:"Brouillon",error:"Échec de la requête.",saved:"Enregistré.",active:"Actif",version:"Version"},
  es:{title:"Catálogo de educación al paciente",eyebrow:"P2 · ADM-109",notice:"Solo debe asignarse contenido educativo aprobado y versionado. Publicar una nueva versión retira la publicada anterior sin borrar asignaciones históricas.",definitions:"Definiciones de contenido",newContent:"Nuevo contenido",code:"Código",create:"Crear",versions:"Versiones",newVersion:"Nueva versión borrador",labels:"Título",body:"Contenido para el paciente",sourceName:"Nombre de la fuente",sourceUrl:"URL de la fuente (HTTPS)",createVersion:"Crear borrador",publish:"Publicar",refresh:"Actualizar",empty:"No hay contenido educativo configurado.",select:"Selecciona una definición.",source:"Fuente",published:"Publicada",retired:"Retirada",draft:"Borrador",error:"Error en la solicitud.",saved:"Guardado.",active:"Activo",version:"Versión"}
} as const;

function local(labels:Labels, locale:Locale, fallback:string){return labels?.[locale]?.trim()||labels?.en?.trim()||fallback}
function emptyLocalized(){return {en:"",ar:"",fr:"",es:""}}

export default function PatientEducationCatalogPage(){
  const {locale}=useI18n();
  const t=copy[locale];
  const [catalog,setCatalog]=useState<Catalog>({items:[]});
  const [selectedId,setSelectedId]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [code,setCode]=useState("");
  const [labels,setLabels]=useState<Record<Locale,string>>(emptyLocalized());
  const [bodyLabels,setBodyLabels]=useState<Record<Locale,string>>(emptyLocalized());
  const [sourceName,setSourceName]=useState("");
  const [sourceUrl,setSourceUrl]=useState("");

  const selected=useMemo(()=>catalog.items.find(item=>item.id===selectedId)??null,[catalog.items,selectedId]);

  const load=useCallback(async()=>{
    setError("");
    try{
      const response=await fetch("/api/admin/education-content",{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Catalog;
      if(!response.ok) throw new Error(payload.message||t.error);
      const items=Array.isArray(payload.items)?payload.items:[];
      setCatalog({items});
      setSelectedId(current=>current&&items.some(item=>item.id===current)?current:(items[0]?.id??""));
    }catch(value){setError(value instanceof Error?value.message:t.error)}
  },[t.error]);

  useEffect(()=>{void load()},[load]);

  async function mutate(path:string, body:unknown){
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json().catch(()=>({})) as {message?:string};
      if(!response.ok) throw new Error(payload.message||t.error);
      await load();setMessage(t.saved);return payload;
    }catch(value){setError(value instanceof Error?value.message:t.error);return null}
    finally{setBusy(false)}
  }

  async function createDefinition(){
    const normalized=code.trim().toUpperCase();
    if(!normalized)return;
    const result=await mutate("/api/admin/education-content",{code:normalized}) as {id?:string}|null;
    if(result?.id)setSelectedId(result.id);
    setCode("");
  }

  async function createVersion(){
    if(!selected)return;
    const result=await mutate(`/api/admin/education-content/${encodeURIComponent(selected.id)}/versions`,{
      labels,bodyLabels,sourceName:sourceName.trim(),sourceUrl:sourceUrl.trim()||null,
    });
    if(result){
      setLabels(emptyLocalized());setBodyLabels(emptyLocalized());setSourceName("");setSourceUrl("");
    }
  }

  async function publish(version:Version){
    if(!selected)return;
    await mutate(`/api/admin/education-content/${encodeURIComponent(selected.id)}/versions/${version.version}/publish`,{});
  }

  function updateLocalized(setter:React.Dispatch<React.SetStateAction<Record<Locale,string>>>, key:Locale, value:string){
    setter(current=>({...current,[key]:value}));
  }

  return <AppShell active="20" eyebrow={t.eyebrow} title={t.title}>
    <div className={styles.stack}>
      <div className={styles.notice}>{t.notice}</div>
      {error?<div className={styles.error}>{error}</div>:null}
      {message?<div className={styles.success}>{message}</div>:null}
      <div className={styles.toolbar}><button className={styles.ghost} disabled={busy} onClick={()=>void load()}>{t.refresh}</button></div>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>{t.definitions}</h2>
          <div className={styles.form}>
            <label>{t.code}<input value={code} onChange={e=>setCode(e.target.value)} placeholder="DIABETES_FOOT_CARE"/></label>
            <button className={styles.primary} disabled={busy||!code.trim()} onClick={()=>void createDefinition()}>{t.create}</button>
          </div>
          <div style={{marginTop:14}}>
            {catalog.items.map(item=><button key={item.id} type="button" className={styles.definition} data-active={item.id===selectedId} onClick={()=>setSelectedId(item.id)}>
              <strong>{item.code}</strong><small>{item.active?t.active:"INACTIVE"} · {item.versions.length} {t.versions.toLowerCase()}</small>
            </button>)}
            {!catalog.items.length?<div className={styles.empty}>{t.empty}</div>:null}
          </div>
        </section>

        <section className={styles.card}>
          <h2>{t.newVersion}</h2>
          {!selected?<div className={styles.empty}>{t.select}</div>:<div className={styles.form}>
            <div className={styles.localeTabs}>{locales.map(lang=><label key={lang}>{t.labels} {lang.toUpperCase()}<input value={labels[lang]} onChange={e=>updateLocalized(setLabels,lang,e.target.value)}/></label>)}</div>
            <div className={styles.localeTabs}>{locales.map(lang=><label key={lang}>{t.body} {lang.toUpperCase()}<textarea value={bodyLabels[lang]} onChange={e=>updateLocalized(setBodyLabels,lang,e.target.value)}/></label>)}</div>
            <div className={styles.formGrid}>
              <label>{t.sourceName}<input value={sourceName} onChange={e=>setSourceName(e.target.value)}/></label>
              <label>{t.sourceUrl}<input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://"/></label>
            </div>
            <button className={styles.primary} disabled={busy||!sourceName.trim()||locales.some(lang=>!labels[lang].trim()||!bodyLabels[lang].trim())} onClick={()=>void createVersion()}>{t.createVersion}</button>
          </div>}
        </section>
      </div>

      <section className={styles.card}>
        <h2>{t.versions}{selected?` · ${selected.code}`:""}</h2>
        {!selected?<div className={styles.empty}>{t.select}</div>:selected.versions.length===0?<div className={styles.empty}>{t.empty}</div>:
          selected.versions.map(version=><article className={styles.version} key={version.id}>
            <div className={styles.versionHead}><strong>{t.version} {version.version} · {local(version.labels,locale,selected.code)}</strong><span className={styles.badge}>{version.status}</span></div>
            <div className={styles.bodyPreview}>{local(version.bodyLabels,locale,"")}</div>
            <div className={styles.source}><strong>{t.source}: {version.sourceName}</strong>{version.sourceUrl?<a href={version.sourceUrl} target="_blank" rel="noreferrer">{version.sourceUrl}</a>:null}</div>
            <div className={styles.muted}>{version.publishedAt?`${t.published}: ${new Date(version.publishedAt).toLocaleString(locale)}`:""}{version.retiredAt?` · ${t.retired}: ${new Date(version.retiredAt).toLocaleString(locale)}`:""}</div>
            {version.status==="DRAFT"?<div><button className={styles.primary} disabled={busy} onClick={()=>void publish(version)}>{t.publish}</button></div>:null}
          </article>)}
      </section>
    </div>
  </AppShell>;
}
