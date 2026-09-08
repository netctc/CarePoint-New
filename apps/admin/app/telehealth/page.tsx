import { AppShell } from "@/components/AppShell";
import { TelehealthOperations } from "@/components/TelehealthOperations";

export default function TelehealthPage() {
  return <AppShell active="06" titleKey="nav.telehealth" eyebrow="CARE DELIVERY">
    <TelehealthOperations />
  </AppShell>;
}
