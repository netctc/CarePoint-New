"use client";

import { AppShell } from "@/components/AppShell";
import { ConsentAccessMatrix } from "@/components/ClinicalGovernanceConsole";
import { ConsentPolicyManager } from "@/components/ConsentPolicyManager";
import { useI18n } from "@/lib/i18n";

const copy = {
  en:{eyebrow:"ADM-091 / ADM-092 · Clinical governance",title:"Consent policies & access matrix"},
  ar:{eyebrow:"ADM-091 / ADM-092 · الحوكمة السريرية",title:"سياسات الموافقة ومصفوفة الوصول"},
  fr:{eyebrow:"ADM-091 / ADM-092 · Gouvernance clinique",title:"Politiques de consentement & matrice d’accès"},
  es:{eyebrow:"ADM-091 / ADM-092 · Gobernanza clínica",title:"Políticas de consentimiento y matriz de acceso"},
} as const;

export default function ConsentPoliciesPage(){
  const {locale}=useI18n();
  return <AppShell active="15" eyebrow={copy[locale].eyebrow} title={copy[locale].title}>
    <div style={{display:"grid",gap:18}}>
      <ConsentPolicyManager/>
      <ConsentAccessMatrix/>
    </div>
  </AppShell>;
}
