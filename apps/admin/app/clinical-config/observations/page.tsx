"use client";

import { AppShell } from "@/components/AppShell";
import { ClinicalMetricsManager } from "@/components/ClinicalMetricsManager";
import { useI18n } from "@/lib/i18n";

const copy = {
  en: { eyebrow: "Clinical configuration", title: "Clinical metrics & units" },
  ar: { eyebrow: "الإعداد السريري", title: "المقاييس والوحدات السريرية" },
  fr: { eyebrow: "Configuration clinique", title: "Métriques & unités cliniques" },
  es: { eyebrow: "Configuración clínica", title: "Métricas y unidades clínicas" },
} as const;

export default function ClinicalObservationsPage() {
  const { locale } = useI18n();
  return (
    <AppShell active="13" eyebrow={copy[locale].eyebrow} title={copy[locale].title}>
      <ClinicalMetricsManager />
    </AppShell>
  );
}
