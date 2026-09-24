"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./MedicationCatalogStatus.module.css";

type CodingSystem = { uri:string; name:string; active:boolean; updatedAt:string };
type LatestMapping = { sourceSystem:string; targetSystem:string; mappingVersion:number; recordedAt:string };
type StatusPayload = {
  generatedAt:string;
  state:"HEALTHY"|"DEGRADED"|"NOT_CONFIGURED";
  catalogConfigured:boolean;
  externalMappingsConfigured:boolean;
  syncMode:string;
  externalSyncConfigured:boolean;
  lastExternalSyncAt:string|null;
  lastCatalogUpdateAt:string|null;
  lastMappingUpdateAt:string|null;
  medicationCodingSystems:CodingSystem[];
  activeConceptCount:number;
  totalConceptCount:number;
  activeMappingCount:number;
  externalSourceSystems:string[];
  latestMapping:LatestMapping|null;
  errorCodes:string[];
  secretsExposed:false;
  credentialValuesIncluded:false;
  clinicalDataIncluded:false;
  externalCatalogSeparateFromClinicalData:true;
  message?:string;
};

const copy:Record<Locale,Record<string,string>>={
  en:{title:"Medication catalog status",eyebrow:"P2 · ADM-085",intro:"Operational view of the versioned medication terminology and external mappings. This page never returns patient clinical data or secret credential values.",refresh:"Refresh",state:"State",catalog:"Medication catalog",concepts:"Active concepts",mappings:"Active mappings",systems:"Medication coding systems",sources:"External source systems",catalogUpdate:"Last catalog update",mappingUpdate:"Last mapping update",externalSync:"Last external sync",mode:"Integration mode",errors:"Configuration notices",none:"None",configured:"Configured",notConfigured:"Not configured",separation:"External catalog mappings are kept separate from clinical patient records.",error:"Request failed.",generated:"Generated",yes:"Yes",no:"No",version:"Mapping version"},
  ar:{title:"حالة كتالوج الأدوية",eyebrow:"P2 · ADM-085",intro:"عرض تشغيلي لمصطلحات الأدوية ذات الإصدارات والربط الخارجي. لا تعرض الصفحة بيانات سريرية للمرضى أو قيماً سرية للاعتمادات.",refresh:"تحديث",state:"الحالة",catalog:"كتالوج الأدوية",concepts:"المفاهيم النشطة",mappings:"الروابط النشطة",systems:"أنظمة ترميز الأدوية",sources:"أنظمة المصدر الخارجية",catalogUpdate:"آخر تحديث للكتالوج",mappingUpdate:"آخر تحديث للربط",externalSync:"آخر مزامنة خارجية",mode:"نمط التكامل",errors:"ملاحظات الإعداد",none:"لا يوجد",configured:"مهيأ",notConfigured:"غير مهيأ",separation:"تبقى روابط الكتالوج الخارجي منفصلة عن السجلات السريرية للمرضى.",error:"فشل الطلب.",generated:"تم الإنشاء",yes:"نعم",no:"لا",version:"إصدار الربط"},
  fr:{title:"État du catalogue de médicaments",eyebrow:"P2 · ADM-085",intro:"Vue opérationnelle de la terminologie médicamenteuse versionnée et des mappings externes. Aucune donnée clinique patient ni valeur secrète n’est renvoyée.",refresh:"Actualiser",state:"État",catalog:"Catalogue médicament",concepts:"Concepts actifs",mappings:"Mappings actifs",systems:"Systèmes de codage médicament",sources:"Systèmes sources externes",catalogUpdate:"Dernière mise à jour catalogue",mappingUpdate:"Dernière mise à jour mapping",externalSync:"Dernière synchronisation externe",mode:"Mode d’intégration",errors:"Avis de configuration",none:"Aucun",configured:"Configuré",notConfigured:"Non configuré",separation:"Les mappings du catalogue externe restent séparés des dossiers cliniques patient.",error:"Échec de la requête.",generated:"Généré",yes:"Oui",no:"Non",version:"Version du mapping"},
  es:{title:"Estado del catálogo de medicamentos",eyebrow:"P2 · ADM-085",intro:"Vista operativa de terminología de medicamentos versionada y mapeos externos. Esta página nunca devuelve datos clínicos del paciente ni valores secretos de credenciales.",refresh:"Actualizar",state:"Estado",catalog:"Catálogo de medicamentos",concepts:"Conceptos activos",mappings:"Mapeos activos",systems:"Sistemas de codificación de medicamentos",sources:"Sistemas origen externos",catalogUpdate:"Última actualización del catálogo",mappingUpdate:"Última actualización de mapeos",externalSync:"Última sincronización externa",mode:"Modo de integración",errors:"Avisos de configuración",none:"Ninguno",configured:"Configurado",notConfigured:"No configurado",separation:"Los mapeos del catálogo externo permanecen separados de los registros clínicos del paciente.",error:"Error en la solicitud.",generated:"Generado",yes:"Sí",no:"No",version:"Versión del mapeo"}
};

export default function MedicationCatalogStatusPage(){
  const {locale}=useI18n();
  const t=copy[locale];
  const [data,setData]=useState<StatusPayload|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    setLoading(true);
    setError("");
    try{
      const response=await fetch("/api/admin/medication-catalog/status",{cache:"no-store"});
      const payload=await response.json().catch(()=>({})) as Partial<StatusPayload>;
      if(!response.ok) throw new Error(typeof payload.message==="string"?payload.message:t.error);
      setData(payload as StatusPayload);
    }catch(value){
      setError(value instanceof Error?value.message:t.error);
    }finally{
      setLoading(false);
    }
  },[t.error]);

  useEffect(()=>{void load()},[load]);

  return <AppShell active="21" eyebrow={t.eyebrow} title={t.title}>
    <div className={styles.stack}>
      <div className={styles.notice}>{t.intro}</div>
      <div className={styles.toolbar}>
        <div>{error?<span className={styles.error}>{error}</span>:null}</div>
        <button disabled={loading} onClick={()=>void load()}>{t.refresh}</button>
      </div>
      {data?<><section className={styles.metrics}>
        <Metric label={t.state} value={data.state}/>
        <Metric label={t.catalog} value={data.catalogConfigured?t.configured:t.notConfigured}/>
        <Metric label={t.concepts} value={data.activeConceptCount}/>
        <Metric label={t.mappings} value={data.activeMappingCount}/>
      </section>
      <section className={styles.card}>
        <h2>{t.mode}</h2>
        <dl className={styles.details}>
          <Row label={t.mode} value={data.syncMode}/>
          <Row label={t.externalSync} value={date(data.lastExternalSyncAt,locale)}/>
          <Row label={t.catalogUpdate} value={date(data.lastCatalogUpdateAt,locale)}/>
          <Row label={t.mappingUpdate} value={date(data.lastMappingUpdateAt,locale)}/>
          <Row label={t.generated} value={date(data.generatedAt,locale)}/>
        </dl>
        <div className={styles.separation}>{t.separation} clinicalDataIncluded={String(data.clinicalDataIncluded)} · secretsExposed={String(data.secretsExposed)}</div>
      </section>
      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>{t.systems}</h2>
          {data.medicationCodingSystems.length?data.medicationCodingSystems.map(system=><article className={styles.item} key={system.uri}>
            <strong>{system.name}</strong><code>{system.uri}</code><span>{system.active?t.yes:t.no} · {date(system.updatedAt,locale)}</span>
          </article>):<p>{t.none}</p>}
        </section>
        <section className={styles.card}>
          <h2>{t.sources}</h2>
          {data.externalSourceSystems.length?data.externalSourceSystems.map(source=><div className={styles.item} key={source}><strong>{source}</strong></div>):<p>{t.none}</p>}
          {data.latestMapping?<div className={styles.latest}><strong>{data.latestMapping.sourceSystem} → {data.latestMapping.targetSystem}</strong><span>{t.version}: {data.latestMapping.mappingVersion} · {date(data.latestMapping.recordedAt,locale)}</span></div>:null}
        </section>
      </div>
      <section className={styles.card}>
        <h2>{t.errors}</h2>
        {data.errorCodes.length?<ul>{data.errorCodes.map(code=><li key={code}><code>{code}</code></li>)}</ul>:<p>{t.none}</p>}
      </section></>:loading?<div className={styles.notice}>…</div>:null}
    </div>
  </AppShell>;
}

function Metric({label,value}:{label:string;value:string|number}){return <article><span>{label}</span><strong>{value}</strong></article>}
function Row({label,value}:{label:string;value:string}){return <><dt>{label}</dt><dd>{value}</dd></>}
function date(value:string|null,locale:Locale){if(!value)return "—";const parsed=new Date(value);return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(parsed):"—"}
