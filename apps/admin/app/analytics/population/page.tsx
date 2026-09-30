import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PopulationAnalytics } from "@/components/PopulationAnalytics";

export default function PopulationAnalyticsPage() {
  return <AppShell active="07" title="Population analytics" eyebrow="PRIVACY-PRESERVING ANALYTICS">
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
      <Link href="/analytics" style={{ fontWeight: 700 }}>← Operational analytics</Link>
    </div>
    <PopulationAnalytics />
  </AppShell>;
}
