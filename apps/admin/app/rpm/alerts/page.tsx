import { AppShell } from "@/components/AppShell";
import { AdminRpmCarePlanCenter } from "@/components/AdminRpmCarePlanCenter";

export default function RpmAlertsPage(){
  return <AppShell active="12" eyebrow="V2 · ADM-082" title="RPM Alert Queue"><AdminRpmCarePlanCenter section="rpm-alerts"/></AppShell>;
}
