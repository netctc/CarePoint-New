import { AppShell } from "@/components/AppShell";
import { IntegrationGatewayConsole } from "@/components/IntegrationGatewayConsole";

export default function LabIntegrationsPage() {
  return <AppShell active="12" eyebrow="V2 · ADM-104 / BE-041" title="External Laboratories"><IntegrationGatewayConsole kind="labs" /></AppShell>;
}
