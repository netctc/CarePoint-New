import { AppShell } from "@/components/AppShell";
import { PrivacyExportMonitor } from "@/components/PrivacyExportMonitor";

export default function PrivacyExportsPage() {
  return <AppShell active="11" title="Patient export requests" eyebrow="Privacy & data governance"><PrivacyExportMonitor /></AppShell>;
}
