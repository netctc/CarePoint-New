"use client";

import Link from "next/link";
import { AdminOperator } from "@/components/AdminOperator";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n, type Locale, type MessageKey } from "@/lib/i18n";

const nav = [
  ["01", "nav.commandCenter", "/"],
  ["02", "nav.otherProviders", "/providers"],
  ["03", "nav.doctors", "/doctors"],
  ["04", "nav.appointments", "/appointments"],
  ["05", "nav.patientWorkspaces", "/finance"],
  ["06", "nav.telehealth", "/telehealth"],
  ["07", "nav.analytics", "/analytics"],
  ["08", "nav.security", "/security"],
] as const;

const financeLabels: Record<Locale, string> = {
  en: "Finance & Revenue", ar: "المالية ودورة الإيرادات", fr: "Finance & revenus", es: "Finanzas e ingresos",
};
const patientLabels: Record<Locale, string> = { en:"Patients", ar:"المرضى", fr:"Patients", es:"Pacientes" };
const profileSchemaLabels: Record<Locale, string> = { en:"Clinical Profile Schema", ar:"مخطط الملف السريري", fr:"Schéma du profil clinique", es:"Esquema del perfil clínico" };
const clinicalMetricsLabels: Record<Locale, string> = { en:"Clinical Metrics & Units", ar:"المقاييس والوحدات السريرية", fr:"Métriques & unités cliniques", es:"Métricas y unidades clínicas" };
const alertPolicyLabels: Record<Locale, string> = { en:"Clinical Alert Policies", ar:"سياسات التنبيهات السريرية", fr:"Politiques d’alertes cliniques", es:"Políticas de alertas clínicas" };
const privacyLabels: Record<Locale, string> = { en:"Privacy & Governance", ar:"الخصوصية والحوكمة", fr:"Confidentialité & gouvernance", es:"Privacidad y governance" };
const v2GovernanceLabels: Record<Locale, string> = { en:"V2 Governance", ar:"حوكمة V2", fr:"Gouvernance V2", es:"Gobernanza V2" };
const consentMatrixLabels: Record<Locale, string> = { en:"Consent Access Matrix", ar:"مصفوفة وصول الموافقات", fr:"Matrice d’accès consentement", es:"Matriz de acceso por consentimiento" };
const clinicalAccessLabels: Record<Locale, string> = { en:"Clinical Access Audit", ar:"تدقيق الوصول السريري", fr:"Audit des accès cliniques", es:"Auditoría de acceso clínico" };
const credentialExpiryLabels: Record<Locale, string> = { en:"Credential Expirations", ar:"انتهاء صلاحية الاعتمادات", fr:"Expirations des justificatifs", es:"Vencimiento de credenciales" };
const dependentReviewLabels: Record<Locale, string> = { en:"Dependent Reviews", ar:"مراجعة التابعين", fr:"Revue des personnes à charge", es:"Revisión de dependientes" };
const provenanceLabels: Record<Locale, string> = { en:"Clinical Provenance", ar:"مصدر البيانات السريرية", fr:"Provenance clinique", es:"Procedencia clínica" };
const patientEducationLabels: Record<Locale, string> = { en:"Patient Education", ar:"تثقيف المريض", fr:"Éducation du patient", es:"Educación del paciente" };
const medicationCatalogLabels: Record<Locale, string> = { en:"Medication Catalog", ar:"كتالوج الأدوية", fr:"Catalogue des médicaments", es:"Catálogo de medicamentos" };
const questionnaireBuilderLabels: Record<Locale, string> = { en:"Questionnaire Builder", ar:"منشئ الاستبيانات", fr:"Créateur de questionnaires", es:"Constructor de cuestionarios" };
const questionnaireTriggerLabels: Record<Locale, string> = { en:"Questionnaire Triggers", ar:"قواعد تفعيل الاستبيانات", fr:"Déclencheurs de questionnaires", es:"Triggers de cuestionarios" };

type Props = Readonly<{
  active: string;
  titleKey?: MessageKey;
  eyebrowKey?: MessageKey;
  title?: string;
  eyebrow?: string;
  children: React.ReactNode;
}>;

export function AppShell({ active, titleKey, eyebrowKey, title, eyebrow, children }: Props) {
  const { t, direction, locale } = useI18n();
  const renderedTitle = title ?? (titleKey ? t(titleKey) : "");
  const renderedEyebrow = eyebrow ?? (eyebrowKey ? t(eyebrowKey) : "");
  return <div className="app-shell" data-direction={direction}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">C+</div><div><strong>CarePoint</strong><span>{t("shell.clinicalOperations")}</span></div><i className="live-dot" /></div>
      <div className="command">⌘ <span>{t("shell.globalCommand")}</span><kbd>⌘K</kbd></div>
      <div className="nav-label">{t("shell.systemModules")}</div>
      <nav>{nav.map(([id, key, href]) => <Link key={id} className={`nav-item ${active === id ? "active" : ""}`} href={href}><small>{id}</small><span>{id === "05" ? financeLabels[locale] : t(key)}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>)}
        <Link className={`nav-item ${active === "09" ? "active" : ""}`} href="/patients"><small>09</small><span>{patientLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "10" ? "active" : ""}`} href="/clinical-config/profile-schema"><small>10</small><span>{profileSchemaLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "13" ? "active" : ""}`} href="/clinical-config/observations"><small>13</small><span>{clinicalMetricsLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "14" ? "active" : ""}`} href="/clinical-config/alert-policies"><small>14</small><span>{alertPolicyLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "11" ? "active" : ""}`} href="/privacy/exports"><small>11</small><span>{privacyLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "12" ? "active" : ""}`} href="/governance"><small>12</small><span>{v2GovernanceLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "15" ? "active" : ""}`} href="/consent-policies"><small>15</small><span>{consentMatrixLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "16" ? "active" : ""}`} href="/clinical-access"><small>16</small><span>{clinicalAccessLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "17" ? "active" : ""}`} href="/governance/expirations"><small>17</small><span>{credentialExpiryLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "18" ? "active" : ""}`} href="/patients/dependents"><small>18</small><span>{dependentReviewLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "19" ? "active" : ""}`} href="/clinical-provenance"><small>19</small><span>{provenanceLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "20" ? "active" : ""}`} href="/patient-education"><small>20</small><span>{patientEducationLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "21" ? "active" : ""}`} href="/medication-catalog"><small>21</small><span>{medicationCatalogLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "22" ? "active" : ""}`} href="/questionnaires"><small>22</small><span>{questionnaireBuilderLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
        <Link className={`nav-item ${active === "23" ? "active" : ""}`} href="/questionnaires/triggers"><small>23</small><span>{questionnaireTriggerLabels[locale]}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>
      </nav>
      <div className="security-pill"><div><small>{t("shell.e2eeStatus")}</small><strong>{t("shell.shieldPolicy")}</strong></div><i /></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div className="network-pill"><span>◎</span> {t("shell.globalCareNetwork")}</div><div className="topbar-actions"><LanguageSwitcher /><AdminOperator /></div></header>
      <main className="content"><div className="page-title"><div><span>{renderedEyebrow}</span><h1>{renderedTitle}</h1></div><button className="secondary-button">{t("common.exportSnapshot")}</button></div>{children}</main>
    </section>
  </div>;
}
