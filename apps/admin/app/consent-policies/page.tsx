"use client";

import { AppShell } from "@/components/AppShell";
import { ConsentAccessMatrix } from "@/components/ClinicalGovernanceConsole";
import { useI18n } from "@/lib/i18n";

const copy = {
  en:{eyebrow:"ADM-092 · Clinical governance",title:"Consent access matrix"},
  ar:{eyebrow:"ADM-092 · الحوكمة السريرية",title:"مصفوفة الوصول بالموافقة"},
  fr:{eyebrow:"ADM-092 · Gouvernance clinique",title:"Matrice d’accès par consentement"},
  es:{eyebrow:"ADM-092 · Gobernanza clínica",title:"Matriz de acceso por consentimiento"},
} as const;

export default function ConsentPoliciesPage(){
  const {locale}=useI18n();
  return <AppShell active="15" eyebrow={copy[locale].eyebrow} title={copy[locale].title}><ConsentAccessMatrix/></AppShell>;
}
