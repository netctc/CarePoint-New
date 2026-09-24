"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./AnalyticsIntelligence.module.css";

type Days = 90 | 180 | 365;
type Point = { month: string; patientCount: number; eventCount: number };
type Series = { points: Point[]; suppressedCellCount: number };
type PopulationPayload = {
  generatedAt: string;
  window: { days: Days; from: string; to: string };
  privacy: {
    aggregateOnly: boolean;
    minimumCellSize: number;
    suppressedCellsOmitted: boolean;
    patientIdentifiersReturned: false;
    providerIdentifiersReturned: false;
    drillDownEnabled: false;
  };
  series: {
    observations: Series;
    carePlans: Series;
    questionnaires: Series;
    laboratoryResults: Series;
  };
};

const copy: Record<Locale, Record<string, string>> = {
  en: {
    title:"Population analytics", intro:"Monthly aggregate trends with small-cell suppression enforced by the API. No patient or provider drill-down is available.",
    privacy:"Privacy boundary", threshold:"Minimum distinct patients per visible cell", omitted:"Suppressed cells omitted", period:"Period", updated:"Updated",
    observations:"Observations", carePlans:"Care plans", questionnaires:"Questionnaires", laboratoryResults:"Released lab results",
    month:"Month", patients:"Distinct patients", events:"Events", suppressed:"suppressed small cells", loading:"Loading population analytics…", failed:"Population analytics could not be loaded.", empty:"No visible cells in this period."
  },
  ar: {
    title:"تحليلات سكانية", intro:"اتجاهات شهرية مجمعة مع إخفاء الخلايا الصغيرة على مستوى API. لا يتوفر انتقال إلى هوية المريض أو مقدم الخدمة.",
    privacy:"حدود الخصوصية", threshold:"الحد الأدنى للمرضى المميزين في الخلية الظاهرة", omitted:"تم حذف الخلايا المخفية", period:"الفترة", updated:"آخر تحديث",
    observations:"الملاحظات", carePlans:"خطط الرعاية", questionnaires:"الاستبيانات", laboratoryResults:"نتائج المختبر المُفرج عنها",
    month:"الشهر", patients:"مرضى مميزون", events:"الأحداث", suppressed:"خلايا صغيرة مخفية", loading:"جارٍ تحميل التحليلات السكانية…", failed:"تعذر تحميل التحليلات السكانية.", empty:"لا توجد خلايا ظاهرة في هذه الفترة."
  },
  fr: {
    title:"Analytique populationnelle", intro:"Tendances mensuelles agrégées avec suppression des petites cellules appliquée par l’API. Aucun accès individuel patient/prestataire.",
    privacy:"Frontière de confidentialité", threshold:"Patients distincts minimum par cellule visible", omitted:"Cellules supprimées omises", period:"Période", updated:"Actualisé",
    observations:"Observations", carePlans:"Plans de soins", questionnaires:"Questionnaires", laboratoryResults:"Résultats labo libérés",
    month:"Mois", patients:"Patients distincts", events:"Événements", suppressed:"petites cellules supprimées", loading:"Chargement de l’analytique populationnelle…", failed:"Impossible de charger l’analytique populationnelle.", empty:"Aucune cellule visible pour cette période."
  },
  es: {
    title:"Analítica poblacional", intro:"Tendencias mensuales agregadas con supresión de celdas pequeñas aplicada por la API. No existe drill-down a paciente o proveedor.",
    privacy:"Frontera de privacidad", threshold:"Pacientes distintos mínimos por celda visible", omitted:"Celdas suprimidas omitidas", period:"Periodo", updated:"Actualizado",
    observations:"Observaciones", carePlans:"Planes de cuidado", questionnaires:"Cuestionarios", laboratoryResults:"Resultados de laboratorio liberados",
    month:"Mes", patients:"Pacientes distintos", events:"Eventos", suppressed:"celdas pequeñas suprimidas", loading:"Cargando analítica poblacional…", failed:"No se pudo cargar la analítica poblacional.", empty:"No hay celdas visibles en este periodo."
  },
};

export function PopulationAnalytics() {
  const { locale } = useI18n();
  const c = copy[locale];
  const [days, setDays] = useState<Days>(180);
  const [data, setData] = useState<PopulationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/admin/analytics/population?days=${days}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`);
      setData(payload as PopulationPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (c.failed ?? "Population analytics could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [c.failed, days]);

  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <section className={styles.loading}>{c.loading}</section>;
  if (!data) return <section className={styles.error}>{error ?? c.failed}</section>;

  const entries = Object.entries(data.series) as Array<[keyof PopulationPayload["series"], Series]>;
  return <div className={styles.workspace}>
    <section className={styles.hero}>
      <div><span>{c.privacy}</span><h2>{c.title}</h2><p>{c.intro}</p><small>{c.threshold}: {data.privacy.minimumCellSize} · {c.omitted}</small></div>
      <div className={styles.periodBox}><small>{c.period}</small><div>{([90,180,365] as Days[]).map(value =>
        <button key={value} data-active={days===value} onClick={() => setDays(value)}>{value}</button>
      )}</div><em>{days} days</em></div>
    </section>
    {error ? <div className={styles.error}>{error}</div> : null}
    <div className={styles.updated}>{c.updated}: {new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(data.generatedAt))}</div>
    <div className={styles.twoColumn}>{entries.map(([key, series]) =>
      <section className={styles.panel} key={key}>
        <header><div><h3>{c[key]}</h3><p>{series.suppressedCellCount} {c.suppressed}</p></div></header>
        {series.points.length===0 ? <div className={styles.empty}>{c.empty}</div> :
          <div className={styles.tableWrap}><table><thead><tr><th>{c.month}</th><th>{c.patients}</th><th>{c.events}</th></tr></thead>
          <tbody>{series.points.map(point => <tr key={point.month}><td>{point.month}</td><td>{point.patientCount}</td><td>{point.eventCount}</td></tr>)}</tbody></table></div>}
      </section>
    )}</div>
  </div>;
}
