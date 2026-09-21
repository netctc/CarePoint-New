"use client";
import { AppShell } from "@/components/AppShell";
import { AdminPatientDirectory } from "@/components/AdminPatientDirectory";
import { useI18n } from "@/lib/i18n";
import { patientGovernanceText as pg } from "@/lib/patient-governance-i18n";
export default function PatientsPage(){const{locale}=useI18n();return <AppShell active="09" eyebrow={pg(locale,"patientEyebrow")} title={pg(locale,"patientTitle")}><AdminPatientDirectory/></AppShell>}
