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
  ["06", "nav.telehealth", "#"],
  ["07", "nav.analytics", "#"],
  ["08", "nav.security", "/security"],
] as const;

const financeLabels: Record<Locale, string> = {
  en: "Finance & Revenue",
  ar: "المالية ودورة الإيرادات",
  fr: "Finance & revenus",
  es: "Finanzas e ingresos",
};

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
      <nav>{nav.map(([id, key, href]) => <Link key={id} className={`nav-item ${active === id ? "active" : ""}`} href={href}><small>{id}</small><span>{id === "05" ? financeLabels[locale] : t(key)}</span><b>{direction === "rtl" ? "‹" : "›"}</b></Link>)}</nav>
      <div className="security-pill"><div><small>{t("shell.e2eeStatus")}</small><strong>{t("shell.shieldPolicy")}</strong></div><i /></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div className="network-pill"><span>◎</span> {t("shell.globalCareNetwork")}</div><div className="topbar-actions"><LanguageSwitcher /><AdminOperator /></div></header>
      <main className="content"><div className="page-title"><div><span>{renderedEyebrow}</span><h1>{renderedTitle}</h1></div><button className="secondary-button">{t("common.exportSnapshot")}</button></div>{children}</main>
    </section>
  </div>;
}
