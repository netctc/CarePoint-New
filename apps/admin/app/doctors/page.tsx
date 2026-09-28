"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ProviderGovernanceQueue } from "@/components/ProviderGovernanceQueue";
import { ProfessionalAdministrationCenter } from "@/components/ProfessionalAdministrationCenter";
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
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}><Link className="secondary-button" href="/master-data">Master Data Maintenance</Link></div>
    <ProfessionalAdministrationCenter kind="DOCTOR" />
    <div style={{ marginTop: 24 }}><ProviderGovernanceQueue kind="DOCTOR" /></div>
  </AppShell>;
}
