import { AppShell } from "@/components/AppShell";
import { DeviceGovernanceConsole } from "@/components/DeviceGovernanceConsole";

export default function DeviceIntegrationsPage() {
  return <AppShell active="25" eyebrow="V2 · ADM-105" title="Device Integrations"><DeviceGovernanceConsole section="integrations" /></AppShell>;
}
