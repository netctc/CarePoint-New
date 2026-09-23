"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./ClinicalMetricsManager.module.css";

type Labels = { en?: string; ar?: string; fr?: string; es?: string };
type Unit = { code:string; labels:Labels; dimension:string; active:boolean };
type Conversion = { id:string; dimension:string; fromUnitCode:string; toUnitCode:string; multiplier:number; offset:number; version:number; active:boolean };
type MetricVersion = { id:string; version:number; status:"DRAFT"|"ACTIVE"|"RETIRED"; canonicalUnitCode:string; allowedUnitCodes:string[]; minCanonical:number|null; maxCanonical:number|null; precision:number; activatedAt:string|null; retiredAt:string|null };
type Metric = { id:string; code:string; labels:Labels; category:string; active:boolean; versions:MetricVersion[] };
type Catalog = { units:Unit[]; conversions:Conversion[]; metrics:Metric[]; message?:string };

const text = {
  en: {
    notice:"Metrics and conversions are versioned. Historical observations keep their original value/unit and the metric version used at capture.",
    refresh:"Refresh", unit:"Unit", units:"Units", dimension:"Dimension", labels:"Labels EN / AR / FR / ES", createUnit:"Create unit",
    conversion:"Unit conversion", from:"From", to:"To", multiplier:"Multiplier", offset:"Offset", createConversion:"Create conversion",
    metric:"Clinical metric", metrics:"Clinical metrics", code:"Code", category:"Category", createMetric:"Create metric",
    newVersion:"New version", canonical:"Canonical unit", allowed:"Allowed units", min:"Min canonical", max:"Max canonical", precision:"Precision",
    createVersion:"Create draft version", activate:"Activate", active:"ACTIVE", draft:"DRAFT", retired:"RETIRED",
    noMetrics:"No clinical metrics configured.", noUnits:"No units configured.", error:"Request failed.", version:"Version", latest:"Latest versions",
  },
  ar: {
    notice:"المقاييس والتحويلات ذات إصدارات. تحتفظ الملاحظات التاريخية بالقيمة والوحدة الأصلية وإصدار المقياس المستخدم.",
    refresh:"تحديث", unit:"الوحدة", units:"الوحدات", dimension:"البعد", labels:"التسميات EN / AR / FR / ES", createUnit:"إنشاء وحدة",
    conversion:"تحويل الوحدات", from:"من", to:"إلى", multiplier:"المعامل", offset:"الإزاحة", createConversion:"إنشاء تحويل",
    metric:"مقياس سريري", metrics:"المقاييس السريرية", code:"الرمز", category:"الفئة", createMetric:"إنشاء مقياس",
    newVersion:"إصدار جديد", canonical:"الوحدة القياسية", allowed:"الوحدات المسموحة", min:"الحد الأدنى القياسي", max:"الحد الأعلى القياسي", precision:"الدقة",
    createVersion:"إنشاء إصدار مسودة", activate:"تفعيل", active:"نشط", draft:"مسودة", retired:"متقاعد",
    noMetrics:"لا توجد مقاييس سريرية مهيأة.", noUnits:"لا توجد وحدات مهيأة.", error:"فشل الطلب.", version:"الإصدار", latest:"أحدث الإصدارات",
  },
  fr: {
    notice:"Les métriques et conversions sont versionnées. Les observations historiques conservent leur valeur/unité d’origine et la version utilisée.",
    refresh:"Actualiser", unit:"Unité", units:"Unités", dimension:"Dimension", labels:"Libellés EN / AR / FR / ES", createUnit:"Créer l’unité",
    conversion:"Conversion d’unités", from:"De", to:"Vers", multiplier:"Multiplicateur", offset:"Décalage", createConversion:"Créer la conversion",
    metric:"Métrique clinique", metrics:"Métriques cliniques", code:"Code", category:"Catégorie", createMetric:"Créer la métrique",
    newVersion:"Nouvelle version", canonical:"Unité canonique", allowed:"Unités autorisées", min:"Min canonique", max:"Max canonique", precision:"Précision",
    createVersion:"Créer une version brouillon", activate:"Activer", active:"ACTIVE", draft:"DRAFT", retired:"RETIRED",
    noMetrics:"Aucune métrique clinique configurée.", noUnits:"Aucune unité configurée.", error:"Échec de la requête.", version:"Version", latest:"Dernières versions",
  },
  es: {
    notice:"Las métricas y conversiones se versionan. Las observaciones históricas conservan su valor/unidad original y la versión usada al capturar.",
    refresh:"Actualizar", unit:"Unidad", units:"Unidades", dimension:"Dimensión", labels:"Etiquetas EN / AR / FR / ES", createUnit:"Crear unidad",
    conversion:"Conversión de unidades", from:"Desde", to:"Hacia", multiplier:"Multiplicador", offset:"Offset", createConversion:"Crear conversión",
    metric:"Métrica clínica", metrics:"Métricas clínicas", code:"Código", category:"Categoría", createMetric:"Crear métrica",
    newVersion:"Nueva versión", canonical:"Unidad canónica", allowed:"Unidades permitidas", min:"Mínimo canónico", max:"Máximo canónico", precision:"Precisión",
    createVersion:"Crear versión borrador", activate:"Activar", active:"ACTIVA", draft:"BORRADOR", retired:"RETIRADA",
    noMetrics:"No hay métricas clínicas configuradas.", noUnits:"No hay unidades configuradas.", error:"La solicitud falló.", version:"Versión", latest:"Últimas versiones",
  },
} as const;

function local(labels: Labels, locale: Locale, fallback: string) {
  const value = labels?.[locale]?.trim();
  return value || labels?.en?.trim() || fallback;
}

function labelsPayload(en:string, ar:string, fr:string, es:string) {
  return { en:en.trim(), ar:ar.trim(), fr:fr.trim(), es:es.trim() };
}

export function ClinicalMetricsManager() {
  const { locale } = useI18n();
  const t = text[locale];
  const [catalog,setCatalog]=useState<Catalog>({units:[],conversions:[],metrics:[]});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const [unitCode,setUnitCode]=useState(""); const [dimension,setDimension]=useState("");
  const [unitEn,setUnitEn]=useState(""); const [unitAr,setUnitAr]=useState(""); const [unitFr,setUnitFr]=useState(""); const [unitEs,setUnitEs]=useState("");
  const [fromUnit,setFromUnit]=useState(""); const [toUnit,setToUnit]=useState(""); const [multiplier,setMultiplier]=useState("1"); const [offset,setOffset]=useState("0");
  const [metricCode,setMetricCode]=useState(""); const [category,setCategory]=useState("");
  const [metricEn,setMetricEn]=useState(""); const [metricAr,setMetricAr]=useState(""); const [metricFr,setMetricFr]=useState(""); const [metricEs,setMetricEs]=useState("");
  const [metricId,setMetricId]=useState(""); const [canonical,setCanonical]=useState(""); const [allowed,setAllowed]=useState<Set<string>>(new Set());
  const [minCanonical,setMinCanonical]=useState(""); const [maxCanonical,setMaxCanonical]=useState(""); const [precision,setPrecision]=useState("2");

  const load=useCallback(async()=>{
    setError("");
    try{
      const response=await fetch("/api/admin/clinical-metrics",{cache:"no-store"});
      const payload=await response.json() as Catalog;
      if(!response.ok) throw new Error(payload.message||t.error);
      setCatalog(payload);
      setFromUnit(v=>v||payload.units[0]?.code||"");
      setToUnit(v=>v||payload.units[1]?.code||payload.units[0]?.code||"");
      setMetricId(v=>v||payload.metrics[0]?.id||"");
      setCanonical(v=>v||payload.units[0]?.code||"");
    }catch(value){setError(value instanceof Error?value.message:t.error)}
  },[t.error]);

  useEffect(()=>{void load()},[load]);

  async function mutate(path:string, body:unknown){
    setBusy(true);setError("");
    try{
      const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json() as {message?:string};
      if(!response.ok) throw new Error(payload.message||t.error);
      await load();
      return true;
    }catch(value){setError(value instanceof Error?value.message:t.error);return false}
    finally{setBusy(false)}
  }

  async function createUnit(){
    if(await mutate("/api/admin/clinical-metrics/units",{code:unitCode.trim().toUpperCase(),dimension:dimension.trim().toUpperCase(),labels:labelsPayload(unitEn,unitAr,unitFr,unitEs)})){
      setUnitCode("");setDimension("");setUnitEn("");setUnitAr("");setUnitFr("");setUnitEs("");
    }
  }
  async function createConversion(){
    await mutate("/api/admin/clinical-metrics/unit-conversions",{fromUnitCode:fromUnit,toUnitCode:toUnit,multiplier:Number(multiplier),offset:Number(offset)});
  }
  async function createMetric(){
    if(await mutate("/api/admin/clinical-metrics",{code:metricCode.trim().toUpperCase(),category:category.trim().toUpperCase(),labels:labelsPayload(metricEn,metricAr,metricFr,metricEs)})){
      setMetricCode("");setCategory("");setMetricEn("");setMetricAr("");setMetricFr("");setMetricEs("");
    }
  }
  async function createVersion(){
    if(!metricId)return;
    const body={
      canonicalUnitCode:canonical,
      allowedUnitCodes:[...allowed],
      minCanonical:minCanonical.trim()===""?null:Number(minCanonical),
      maxCanonical:maxCanonical.trim()===""?null:Number(maxCanonical),
      precision:Number(precision),
    };
    await mutate(`/api/admin/clinical-metrics/${encodeURIComponent(metricId)}/versions`,body);
  }
  async function activate(id:string,version:number){
    await mutate(`/api/admin/clinical-metrics/${encodeURIComponent(id)}/versions/${version}/activate`,{});
  }

  const selectedMetric=useMemo(()=>catalog.metrics.find(item=>item.id===metricId)??null,[catalog.metrics,metricId]);
  const conversions=useMemo(()=>catalog.conversions.slice(0,100),[catalog.conversions]);

  return <div className={styles.stack}>
    <div className={styles.notice}>{t.notice}</div>
    {error?<div className={styles.error}>{error}</div>:null}
    <div className={styles.toolbar}><button className={styles.ghost} disabled={busy} onClick={()=>void load()}>{t.refresh}</button></div>

    <div className={styles.grid}>
      <section className={styles.card}>
        <h2>{t.units}</h2>
        <div className={styles.formGrid}>
          <input value={unitCode} onChange={e=>setUnitCode(e.target.value)} placeholder={t.code}/>
          <input value={dimension} onChange={e=>setDimension(e.target.value)} placeholder={t.dimension}/>
          <input value={unitEn} onChange={e=>setUnitEn(e.target.value)} placeholder="Label EN"/>
          <input value={unitAr} onChange={e=>setUnitAr(e.target.value)} placeholder="Label AR"/>
          <input value={unitFr} onChange={e=>setUnitFr(e.target.value)} placeholder="Label FR"/>
          <input value={unitEs} onChange={e=>setUnitEs(e.target.value)} placeholder="Label ES"/>
        </div>
        <button className={styles.primary} disabled={busy} onClick={()=>void createUnit()}>{t.createUnit}</button>
        <div className={styles.list}>
          {catalog.units.map(item=><div className={styles.row} key={item.code}><strong>{item.code}</strong><span>{local(item.labels,locale,item.code)}</span><small>{item.dimension}</small></div>)}
          {!catalog.units.length?<div className={styles.empty}>{t.noUnits}</div>:null}
        </div>
      </section>

      <section className={styles.card}>
        <h2>{t.conversion}</h2>
        <div className={styles.formGrid}>
          <select value={fromUnit} onChange={e=>setFromUnit(e.target.value)}>{catalog.units.map(u=><option key={u.code} value={u.code}>{u.code}</option>)}</select>
          <select value={toUnit} onChange={e=>setToUnit(e.target.value)}>{catalog.units.map(u=><option key={u.code} value={u.code}>{u.code}</option>)}</select>
          <input type="number" step="any" value={multiplier} onChange={e=>setMultiplier(e.target.value)} placeholder={t.multiplier}/>
          <input type="number" step="any" value={offset} onChange={e=>setOffset(e.target.value)} placeholder={t.offset}/>
        </div>
        <button className={styles.primary} disabled={busy||!fromUnit||!toUnit} onClick={()=>void createConversion()}>{t.createConversion}</button>
        <div className={styles.list}>
          {conversions.map(item=><div className={styles.row} key={item.id}><strong>{item.fromUnitCode} → {item.toUnitCode}</strong><span>× {item.multiplier} + {item.offset}</span><small>v{item.version}</small></div>)}
        </div>
      </section>
    </div>

    <section className={styles.card}>
      <h2>{t.metrics}</h2>
      <div className={styles.formGridWide}>
        <input value={metricCode} onChange={e=>setMetricCode(e.target.value)} placeholder={t.code}/>
        <input value={category} onChange={e=>setCategory(e.target.value)} placeholder={t.category}/>
        <input value={metricEn} onChange={e=>setMetricEn(e.target.value)} placeholder="Label EN"/>
        <input value={metricAr} onChange={e=>setMetricAr(e.target.value)} placeholder="Label AR"/>
        <input value={metricFr} onChange={e=>setMetricFr(e.target.value)} placeholder="Label FR"/>
        <input value={metricEs} onChange={e=>setMetricEs(e.target.value)} placeholder="Label ES"/>
      </div>
      <button className={styles.primary} disabled={busy} onClick={()=>void createMetric()}>{t.createMetric}</button>
      <div className={styles.metricGrid}>
        {catalog.metrics.map(metric=><article className={styles.metric} key={metric.id}>
          <div className={styles.metricHead}><div><strong>{local(metric.labels,locale,metric.code)}</strong><small>{metric.code} · {metric.category}</small></div><span>{metric.active?"ACTIVE":"INACTIVE"}</span></div>
          <div className={styles.versions}>{metric.versions.slice(0,5).map(version=><div className={styles.version} key={version.id}>
            <div><strong>v{version.version}</strong> · {version.status}</div>
            <small>{version.canonicalUnitCode} · {version.allowedUnitCodes.join(", ")} · p{version.precision}</small>
            {version.status==="DRAFT"?<button className={styles.ghostSmall} disabled={busy} onClick={()=>void activate(metric.id,version.version)}>{t.activate}</button>:null}
          </div>)}</div>
        </article>)}
        {!catalog.metrics.length?<div className={styles.empty}>{t.noMetrics}</div>:null}
      </div>
    </section>

    <section className={styles.card}>
      <h2>{t.newVersion}</h2>
      <div className={styles.formGridWide}>
        <select value={metricId} onChange={e=>setMetricId(e.target.value)}>{catalog.metrics.map(m=><option key={m.id} value={m.id}>{m.code} · {local(m.labels,locale,m.code)}</option>)}</select>
        <select value={canonical} onChange={e=>{setCanonical(e.target.value);setAllowed(prev=>new Set([...prev,e.target.value]))}}>{catalog.units.map(u=><option key={u.code} value={u.code}>{u.code}</option>)}</select>
        <input type="number" step="any" value={minCanonical} onChange={e=>setMinCanonical(e.target.value)} placeholder={t.min}/>
        <input type="number" step="any" value={maxCanonical} onChange={e=>setMaxCanonical(e.target.value)} placeholder={t.max}/>
        <input type="number" min="0" max="6" value={precision} onChange={e=>setPrecision(e.target.value)} placeholder={t.precision}/>
      </div>
      <div className={styles.checks}>
        {catalog.units.map(unit=><label key={unit.code}><input type="checkbox" checked={allowed.has(unit.code)} onChange={e=>setAllowed(prev=>{const next=new Set(prev);e.target.checked?next.add(unit.code):next.delete(unit.code);return next})}/>{unit.code}</label>)}
      </div>
      <button className={styles.primary} disabled={busy||!selectedMetric||!canonical||allowed.size===0} onClick={()=>void createVersion()}>{t.createVersion}</button>
    </section>
  </div>;
}
