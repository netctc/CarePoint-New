import { AppShell } from "@/components/AppShell";
import { SecurityOperations } from "@/components/SecurityOperations";

export default function SecurityPage() {
  return (
    <AppShell active="08" titleKey="nav.security" eyebrowKey="doctors.credentialGovernance">
      <SecurityOperations />
    </AppShell>
  );
}
