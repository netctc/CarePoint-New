"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ProviderGovernanceQueue } from "@/components/ProviderGovernanceQueue";
import { ProfessionalAdministrationCenter } from "@/components/ProfessionalAdministrationCenter";
import { useI18n } from "@/lib/i18n";

export default function ProvidersPage() {
  const { t } = useI18n();
  return <AppShell active="02" eyebrowKey="providers.eyebrow" titleKey="providers.title">
    <section className="notice-card">
      <div>
        <span>{t("providers.domainRule")}</span>
        <h3>{t("providers.ruleTitle")}</h3>
        <p>{t("providers.ruleText")}</p>
      </div>
    </section>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}><Link className="secondary-button" href="/master-data">Master Data Maintenance</Link><Link className="secondary-button" href="/providers/taxonomy">Provider taxonomy · ADM-106/107</Link></div>
    <ProfessionalAdministrationCenter kind="OTHER_PROVIDER" />
    <div style={{ marginTop: 24 }}><ProviderGovernanceQueue kind="OTHER_PROVIDER" /></div>
  </AppShell>;
}
