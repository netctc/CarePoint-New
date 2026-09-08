import type { Metadata } from "next";
import { LocaleProvider } from "@/lib/i18n";
import "./globals.css";
import "./admin-auth.css";
export const metadata: Metadata = { title: "CarePoint Next | Clinical Operations", description: "CarePoint Next administration and clinical operations portal" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" dir="ltr" suppressHydrationWarning><body><LocaleProvider>{children}</LocaleProvider></body></html>; }
