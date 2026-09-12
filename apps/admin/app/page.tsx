"use client";

import { AppShell } from "@/components/AppShell";
import { CommandCenterLive } from "@/components/CommandCenterLive";

export default function CommandCenterPage() {
  return <AppShell active="01" eyebrowKey="command.eyebrow" titleKey="command.title"><CommandCenterLive /></AppShell>;
}
