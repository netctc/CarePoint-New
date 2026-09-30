"use client";

import { AppShell } from "@/components/AppShell";
import { AppointmentsOperations } from "@/components/AppointmentsOperations";

export default function AppointmentsPage() {
  return <AppShell active="04" eyebrowKey="appointments.eyebrow" titleKey="appointments.title"><AppointmentsOperations /></AppShell>;
}
