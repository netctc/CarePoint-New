"use client";

import { AppShell } from "@/components/AppShell";
import { FinanceOperations, financePageCopy } from "@/components/FinanceOperations";
import { useI18n } from "@/lib/i18n";

export default function FinancePage() {
  const { locale } = useI18n();
  const page = financePageCopy[locale];
  return <AppShell active="05" title={page.title} eyebrow={page.eyebrow}><FinanceOperations /></AppShell>;
}
