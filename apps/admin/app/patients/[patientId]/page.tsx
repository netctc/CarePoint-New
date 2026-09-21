"use client";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminPatientDetail } from "@/components/AdminPatientDetail";
import { useI18n } from "@/lib/i18n";
import { patientGovernanceText as pg } from "@/lib/patient-governance-i18n";
export default function PatientDetailPage(){const{locale}=useI18n();const params=useParams<{patientId:string}>();return <AppShell active="09" eyebrow={pg(locale,"patientEyebrow")} title={pg(locale,"detailTitle")}><AdminPatientDetail patientId={params.patientId}/></AppShell>}
