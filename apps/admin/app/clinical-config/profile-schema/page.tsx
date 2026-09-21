"use client";

import { AppShell } from "@/components/AppShell";
import { ClinicalProfileSchemaAdmin } from "@/components/ClinicalProfileSchemaAdmin";
import { useI18n, type Locale } from "@/lib/i18n";

const copy: Record<Locale, { eyebrow: string; title: string }> = {
  en: { eyebrow: "CLINICAL CONFIGURATION GOVERNANCE", title: "Clinical Profile Schema" },
  ar: { eyebrow: "حوكمة الإعدادات السريرية", title: "مخطط الملف السريري" },
  fr: { eyebrow: "GOUVERNANCE DE CONFIGURATION CLINIQUE", title: "Schéma du profil clinique" },
  es: { eyebrow: "GOBIERNO DE CONFIGURACIÓN CLÍNICA", title: "Esquema del perfil clínico" },
};

export default function ClinicalProfileSchemaPage() {
  const { locale } = useI18n();
  const labels = copy[locale];
  return <AppShell active="00" eyebrow={labels.eyebrow} title={labels.title}>
    <ClinicalProfileSchemaAdmin />
  </AppShell>;
}
