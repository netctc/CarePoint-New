import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ProfessionalAdministrationCenter } from "@/components/ProfessionalAdministrationCenter";
import { ProviderGovernanceQueue } from "@/components/ProviderGovernanceQueue";
import { TransportOperationsPanel } from "@/components/TransportOperationsPanel";
import { adminRuntimeFeatures } from "@/lib/runtime-features";
import { TRANSPORT_PROVIDER_FAMILIES } from "@/lib/transport-provider-scope";

export const dynamic = "force-dynamic";

export default function TransportProvidersPage() {
  if (!adminRuntimeFeatures().transportModuleEnabled) notFound();

  return (
    <AppShell
      active="27"
      eyebrow="TRANSPORT · PROVIDER GOVERNANCE"
      title="Transport Providers"
    >
      <section className="notice-card">
        <div>
          <span>Dedicated transport-provider domain</span>
          <h3>Ground, air and emergency ambulance transport providers</h3>
          <p>
            Manage transport-provider accounts, onboarding, credential validity,
            operational status and audit history without mixing transport
            organizations into the general Health Provider directory.
          </p>
        </div>
      </section>

      <TransportOperationsPanel />

      <div style={{ marginTop: 24 }}>
      <ProfessionalAdministrationCenter
        kind="OTHER_PROVIDER"
        includeFamilies={TRANSPORT_PROVIDER_FAMILIES}
        title="Transport Provider Administration Center"
        intro="Manage transport-provider accounts, licenses, credential evidence and operational status for ground, air and emergency ambulance medical transport."
      />
      </div>

      <div style={{ marginTop: 24 }}>
        <ProviderGovernanceQueue
          kind="OTHER_PROVIDER"
          includeFamilies={TRANSPORT_PROVIDER_FAMILIES}
        />
      </div>
    </AppShell>
  );
}
