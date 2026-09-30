import { AppShell } from "@/components/AppShell";
import { B6OperationsCenter } from "@/components/B6OperationsCenter";

export default function DuplicatePatientsPage() {
  return <AppShell active="12" eyebrow="V2 · ADM-089" title="Duplicate Patient Detection"><B6OperationsCenter section="duplicates" /></AppShell>;
}
