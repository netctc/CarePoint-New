"use client";

import { AppShell } from "@/components/AppShell";
import { ClinicalAccessAuditExplorer } from "@/components/ClinicalGovernanceConsole";
import { useI18n } from "@/lib/i18n";

const copy = {
  en:{eyebrow:"ADM-093 · Immutable audit",title:"Clinical Access Audit Explorer"},
  ar:{eyebrow:"ADM-093 · تدقيق غير قابل للتغيير",title:"مستكشف تدقيق الوصول السريري"},
  fr:{eyebrow:"ADM-093 · Audit immuable",title:"Explorateur des accès cliniques"},
  es:{eyebrow:"ADM-093 · Auditoría inmutable",title:"Audit Explorer de acceso clínico"},
} as const;

export default function ClinicalAccessPage(){
  const {locale}=useI18n();
  return <AppShell active="16" eyebrow={copy[locale].eyebrow} title={copy[locale].title}><ClinicalAccessAuditExplorer/></AppShell>;
}
