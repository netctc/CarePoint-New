"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./QuestionnaireComplianceMonitor.module.css";

type Days = 7 | 30 | 90;
type QuestionnaireRow = {
  code: string;
  labels: Record<string, string> | null;
  activeVersion: number | null;
  responseCount: number;
  respondentCount: number;
  coverageRate: number;
  gapCount: number;
  latestCompletedAt: string | null;
};
type Snapshot = {
  responseCount: number;
  respondentCount: number;
  coverageRate: number;
  gapCount: number;
  questionnaires: QuestionnaireRow[];
};
type Compliance = {
  generatedAt: string;
  window: {
    days: Days;
    current: { from: string; to: string };
    previous: { from: string; to: string };
  };
  privacy: Record<string, boolean>;
  denominator: { registeredPatients: number; description: string };
  activeQuestionnaires: number;
  current: Snapshot;
  previous: Snapshot;
  trend: { coverageRateDelta: number; responseCountDelta: number };
};

type Copy = {
  eyebrow: string;
  title: string;
  intro: string;
  privacy: string;
  loading: string;
  failed: string;
  period: string;
  patients: string;
  active: string;
  respondents: string;
  responses: string;
  coverage: string;
  gap: string;
  questionnaire: string;
  version: string;
  latest: string;
  previous: string;
  noData: string;
  updated: string;
  points: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    eyebrow: "QUESTIONNAIRE GOVERNANCE",
    title: "Questionnaire compliance monitor",
    intro: "Monitor completion coverage across active institutional questionnaires without exposing patient identity or questionnaire answers.",
    privacy: "Aggregate only · ciphertext never read · no patient/provider identity · no free text",
    loading: "Loading questionnaire compliance…",
    failed: "Questionnaire compliance could not be loaded.",
    period: "Rolling period",
    patients: "Registered patients",
    active: "Active questionnaires",
    respondents: "Patients with responses",
    responses: "Responses",
    coverage: "Coverage",
    gap: "Coverage gap",
    questionnaire: "Questionnaire",
    version: "Active version",
    latest: "Latest completion",
    previous: "Previous period",
    noData: "No active questionnaires.",
    updated: "Updated",
    points: "percentage points",
  },
  ar: {
    eyebrow: "حوكمة الاستبيانات",
    title: "مراقبة الالتزام بالاستبيانات",
    intro: "راقب تغطية الاستكمال للاستبيانات المؤسسية النشطة دون كشف هوية المريض أو إجابات الاستبيان.",
    privacy: "بيانات مجمعة فقط · لا تتم قراءة النص المشفر · دون هوية مريض/مقدم · دون نص حر",
    loading: "جارٍ تحميل التزام الاستبيانات…",
    failed: "تعذر تحميل التزام الاستبيانات.",
    period: "الفترة المتحركة",
    patients: "المرضى المسجلون",
    active: "الاستبيانات النشطة",
    respondents: "مرضى لديهم إجابات",
    responses: "الإجابات",
    coverage: "التغطية",
    gap: "فجوة التغطية",
    questionnaire: "الاستبيان",
    version: "الإصدار النشط",
    latest: "آخر إكمال",
    previous: "الفترة السابقة",
    noData: "لا توجد استبيانات نشطة.",
    updated: "آخر تحديث",
    points: "نقطة مئوية",
  },
  fr: {
    eyebrow: "GOUVERNANCE DES QUESTIONNAIRES",
    title: "Suivi de conformité des questionnaires",
    intro: "Suivez la couverture de complétion des questionnaires institutionnels actifs sans exposer l’identité du patient ni les réponses.",
    privacy: "Agrégats uniquement · ciphertext non lu · aucune identité patient/prestataire · aucun texte libre",
    loading: "Chargement de la conformité…",
    failed: "Impossible de charger la conformité des questionnaires.",
    period: "Période glissante",
    patients: "Patients enregistrés",
    active: "Questionnaires actifs",
    respondents: "Patients répondants",
    responses: "Réponses",
    coverage: "Couverture",
    gap: "Écart de couverture",
    questionnaire: "Questionnaire",
    version: "Version active",
    latest: "Dernière complétion",
    previous: "Période précédente",
    noData: "Aucun questionnaire actif.",
    updated: "Mis à jour",
    points: "points de pourcentage",
  },
  es: {
    eyebrow: "GOBERNANZA DE QUESTIONNAIRES",
    title: "Monitor de cumplimiento de questionnaires",
    intro: "Supervisa la cobertura de finalización de questionnaires institucionales activos sin exponer identidad de pacientes ni respuestas.",
    privacy: "Solo agregados · no se lee ciphertext · sin identidad paciente/proveedor · sin texto libre",
    loading: "Cargando cumplimiento de questionnaires…",
    failed: "No se pudo cargar el cumplimiento de questionnaires.",
    period: "Periodo móvil",
    patients: "Pacientes registrados",
    active: "Questionnaires activos",
    respondents: "Pacientes con respuestas",
    responses: "Respuestas",
    coverage: "Cobertura",
    gap: "Brecha de cobertura",
    questionnaire: "Questionnaire",
    version: "Versión activa",
    latest: "Última finalización",
    previous: "Periodo anterior",
    noData: "No hay questionnaires activos.",
    updated: "Actualizado",
    points: "puntos porcentuales",
  },
};

export function QuestionnaireComplianceMonitor() {
  const { locale } = useI18n();
  const c = copy[locale];
  const [days, setDays] = useState<Days>(30);
  const [data, setData] = useState<Compliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/analytics/questionnaires?days=${days}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.message === "string"
            ? payload.message
            : `HTTP ${response.status}`,
        );
      }
      setData(payload as Compliance);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c.failed);
    } finally {
      setLoading(false);
    }
  }, [c.failed, days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <section className={styles.state}>{c.loading}</section>;
  if (!data) return <section className={styles.state}>{error ?? c.failed}</section>;

  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div>
          <span>{c.eyebrow}</span>
          <h2>{c.title}</h2>
          <p>{c.intro}</p>
          <small>{c.privacy}</small>
        </div>
        <div className={styles.period}>
          <small>{c.period}</small>
          <div>
            {([7, 30, 90] as Days[]).map((value) => (
              <button
                key={value}
                data-active={days === value}
                onClick={() => setDays(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      <div className={styles.updated}>
        {c.updated}: {formatDate(data.generatedAt, locale)}
      </div>

      <section className={styles.metrics}>
        <Metric label={c.patients} value={data.denominator.registeredPatients} />
        <Metric label={c.active} value={data.activeQuestionnaires} />
        <Metric label={c.respondents} value={data.current.respondentCount} />
        <Metric label={c.responses} value={data.current.responseCount} />
        <Metric label={c.coverage} value={`${data.current.coverageRate}%`} />
        <Metric label={c.gap} value={data.current.gapCount} />
      </section>

      <section className={styles.trend}>
        <strong>
          {c.coverage}: {signed(data.trend.coverageRateDelta)} {c.points}
        </strong>
        <span>
          {c.previous}: {data.previous.coverageRate}% · {data.previous.responseCount} {c.responses.toLowerCase()}
        </span>
      </section>

      <section className={styles.panel}>
        {data.current.questionnaires.length === 0 ? (
          <p>{c.noData}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{c.questionnaire}</th>
                  <th>{c.version}</th>
                  <th>{c.respondents}</th>
                  <th>{c.responses}</th>
                  <th>{c.coverage}</th>
                  <th>{c.gap}</th>
                  <th>{c.latest}</th>
                </tr>
              </thead>
              <tbody>
                {data.current.questionnaires.map((row) => (
                  <tr key={row.code}>
                    <td>
                      <strong>{label(row, locale)}</strong>
                      <small>{row.code}</small>
                    </td>
                    <td>{row.activeVersion ?? "—"}</td>
                    <td>{row.respondentCount}</td>
                    <td>{row.responseCount}</td>
                    <td>{row.coverageRate}%</td>
                    <td>{row.gapCount}</td>
                    <td>{row.latestCompletedAt ? formatDate(row.latestCompletedAt, locale) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function label(row: QuestionnaireRow, locale: Locale) {
  return row.labels?.[locale] ?? row.labels?.en ?? row.code;
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
