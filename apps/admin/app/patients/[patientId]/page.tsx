"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PatientAdminDetail } from "@/components/PatientAdminDetail";
import { useI18n, type Locale } from "@/lib/i18n";

const titles: Record<Locale, { eyebrow: string; title: string }> = {
  en: { eyebrow: "ADMINISTRATIVE PATIENT RECORD", title: "Patient Administration" },
  ar: { eyebrow: "السجل الإداري للمريض", title: "إدارة المريض" },
  fr: { eyebrow: "DOSSIER ADMINISTRATIF PATIENT", title: "Administration du patient" },
  es: { eyebrow: "FICHA ADMINISTRATIVA DEL PACIENTE", title: "Administración del paciente" },
};

export default function PatientAdminPage() {
  const { locale } = useI18n();
  const params = useParams<{ patientId: string }>();
  const copy = titles[locale];
  return <AppShell active="09" eyebrow={copy.eyebrow} title={copy.title}>
    <PatientAdminDetail patientId={params.patientId} />
  </AppShell>;
}
