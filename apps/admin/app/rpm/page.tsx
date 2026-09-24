import { AppShell } from "@/components/AppShell";
import { AdminRpmCarePlanCenter } from "@/components/AdminRpmCarePlanCenter";

export default function RpmOperationsPage(){
  return <AppShell active="12" eyebrow="V2 · ADM-081" title="Remote Monitoring Operations"><AdminRpmCarePlanCenter section="rpm-dashboard"/></AppShell>;
}
