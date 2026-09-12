"use client";

import { AppShell } from "@/components/AppShell";
import { ProviderGovernanceQueue } from "@/components/ProviderGovernanceQueue";
import { useI18n } from "@/lib/i18n";

export default function DoctorsPage() {
  const { t } = useI18n();
  return <AppShell active="03" eyebrowKey="doctors.eyebrow" titleKey="doctors.title">
    <section className="doctor-hero">
      <div>
        <span>{t("doctors.allBranches")}</span>
        <h2>{t("doctors.heroTitle")}</h2>
        <p>{t("doctors.heroText")}</p>
      </div>
    </section>
    <ProviderGovernanceQueue kind="DOCTOR" />
  </AppShell>;
}
