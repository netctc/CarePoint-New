import { AppShell } from "@/components/AppShell";
import { IntegrationGatewayConsole } from "@/components/IntegrationGatewayConsole";

export default function FhirIntegrationsPage() {
  return <AppShell active="12" eyebrow="V2 · ADM-103 / BE-040" title="FHIR Gateway"><IntegrationGatewayConsole kind="fhir" /></AppShell>;
}
