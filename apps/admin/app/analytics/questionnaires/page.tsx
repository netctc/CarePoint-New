import { AppShell } from "@/components/AppShell";
import { QuestionnaireComplianceMonitor } from "@/components/QuestionnaireComplianceMonitor";

export default function QuestionnaireCompliancePage() {
  return (
    <AppShell
      active="07"
      titleKey="nav.analytics"
      eyebrow="QUESTIONNAIRE GOVERNANCE"
    >
      <QuestionnaireComplianceMonitor />
    </AppShell>
  );
}
