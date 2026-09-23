import { AppShell } from "@/components/AppShell";
import { B6OperationsCenter } from "@/components/B6OperationsCenter";

export default function AuditExportsPage() {
  return <AppShell active="12" eyebrow="V2 · ADM-111" title="Signed Audit Exports"><B6OperationsCenter section="audit-exports" /></AppShell>;
}
