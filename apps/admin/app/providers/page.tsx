"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ProviderGovernanceQueue } from "@/components/ProviderGovernanceQueue";
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
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}><Link className="secondary-button" href="/providers/taxonomy">Provider taxonomy · ADM-106/107</Link></div>
    <ProviderGovernanceQueue kind="OTHER_PROVIDER" />
  </AppShell>;
}
