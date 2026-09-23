import { AppShell } from "@/components/AppShell";
import { B6OperationsCenter } from "@/components/B6OperationsCenter";

export default function ClinicalOperationsPage() {
  return <AppShell active="12" eyebrow="V2 · ADM-112" title="Clinical Continuity Operations"><B6OperationsCenter section="clinical-operations" /></AppShell>;
}
