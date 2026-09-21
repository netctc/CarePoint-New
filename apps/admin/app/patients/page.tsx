"use client";

import { AppShell } from "@/components/AppShell";
import { PatientAdminDirectory } from "@/components/PatientAdminDirectory";
import { useI18n, type Locale } from "@/lib/i18n";

const titles: Record<Locale, { eyebrow: string; title: string }> = {
  en: { eyebrow: "PHI-MINIMIZED ADMINISTRATION", title: "Patient Directory" },
  ar: { eyebrow: "إدارة بحد أدنى من PHI", title: "دليل المرضى" },
  fr: { eyebrow: "ADMINISTRATION PHI MINIMISÉE", title: "Annuaire patients" },
  es: { eyebrow: "ADMINISTRACIÓN CON PHI MINIMIZADA", title: "Directorio de pacientes" },
};

export default function PatientsPage() {
  const { locale } = useI18n();
  const copy = titles[locale];
  return <AppShell active="09" eyebrow={copy.eyebrow} title={copy.title}>
    <PatientAdminDirectory />
  </AppShell>;
}
