import { AppShell } from "@/components/AppShell";
import { DeviceGovernanceConsole } from "@/components/DeviceGovernanceConsole";

export default function DevicesPage() {
  return <AppShell active="24" eyebrow="V2 · ADM-087" title="Medical Devices"><DeviceGovernanceConsole section="registry" /></AppShell>;
}
