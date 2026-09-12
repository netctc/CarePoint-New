import { AnalyticsIntelligence } from "@/components/AnalyticsIntelligence";
import { AppShell } from "@/components/AppShell";

export default function AnalyticsPage() {
  return <AppShell active="07" titleKey="nav.analytics" eyebrow="OPERATIONAL INTELLIGENCE">
    <AnalyticsIntelligence />
  </AppShell>;
}
