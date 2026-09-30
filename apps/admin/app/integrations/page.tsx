import { AppShell } from "@/components/AppShell";
import { B6OperationsCenter } from "@/components/B6OperationsCenter";

export default function IntegrationsPage() {
  return <AppShell active="12" eyebrow="V2 · ADM-102" title="Integration Center"><B6OperationsCenter section="integrations" /></AppShell>;
}
