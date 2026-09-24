import { AppShell } from "@/components/AppShell";
import { AdminRpmCarePlanCenter } from "@/components/AdminRpmCarePlanCenter";

export default function CarePlanTemplatesPage(){
  return <AppShell active="12" eyebrow="V2 · ADM-083" title="Care Plan Templates"><AdminRpmCarePlanCenter section="care-plan-templates"/></AppShell>;
}
