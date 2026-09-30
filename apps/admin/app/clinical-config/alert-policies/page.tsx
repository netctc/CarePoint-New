"use client";

import { AppShell } from "@/components/AppShell";
import { AlertPolicyManager } from "@/components/AlertPolicyManager";
import { useI18n } from "@/lib/i18n";

const copy = {
  en:{eyebrow:"Clinical safety",title:"Clinical alert policies"},
  ar:{eyebrow:"السلامة السريرية",title:"سياسات التنبيهات السريرية"},
  fr:{eyebrow:"Sécurité clinique",title:"Politiques d’alertes cliniques"},
  es:{eyebrow:"Seguridad clínica",title:"Políticas de alertas clínicas"},
} as const;

export default function AlertPoliciesPage(){
  const {locale}=useI18n();
  return <AppShell active="14" eyebrow={copy[locale].eyebrow} title={copy[locale].title}><AlertPolicyManager/></AppShell>;
}
