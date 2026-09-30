"use client";
import { AppShell } from "@/components/AppShell";
import { ClinicalProfileSchemaManager } from "@/components/ClinicalProfileSchemaManager";
import { useI18n } from "@/lib/i18n";
import { patientGovernanceText as pg } from "@/lib/patient-governance-i18n";
export default function ClinicalProfileSchemaPage(){const{locale}=useI18n();return <AppShell active="10" eyebrow={pg(locale,"schemaEyebrow")} title={pg(locale,"schemaTitle")}><ClinicalProfileSchemaManager/></AppShell>}
