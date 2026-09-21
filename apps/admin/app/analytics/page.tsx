import Link from "next/link";
import { AnalyticsIntelligence } from "@/components/AnalyticsIntelligence";
import { AppShell } from "@/components/AppShell";

export default function AnalyticsPage() {
  return <AppShell active="07" titleKey="nav.analytics" eyebrow="OPERATIONAL INTELLIGENCE">
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
      <Link href="/analytics/questionnaires" style={{ fontWeight: 700 }}>
        Questionnaire compliance →
      </Link>
    </div>
    <AnalyticsIntelligence />
  </AppShell>;
}
