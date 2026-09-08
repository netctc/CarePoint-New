"use client";

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
    <ProviderGovernanceQueue kind="OTHER_PROVIDER" />
  </AppShell>;
}
