import { AppShell } from "@/components/AppShell";
import { RetentionGovernance } from "@/components/RetentionGovernance";

export default function PrivacyRetentionPage() {
  return <AppShell active="11" title="Retention & legal hold" eyebrow="Privacy & data governance"><RetentionGovernance /></AppShell>;
}
