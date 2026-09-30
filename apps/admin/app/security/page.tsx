import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { SecurityOperations } from "@/components/SecurityOperations";

export default function SecurityPage() {
  return (
    <AppShell active="08" titleKey="nav.security" eyebrowKey="doctors.credentialGovernance">
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}><Link className="secondary-button" href="/break-glass">ADM-094 · Emergency access review</Link></div>
      <SecurityOperations />
    </AppShell>
  );
}
