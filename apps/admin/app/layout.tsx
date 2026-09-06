import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CarePoint Next | Clinical Operations",
  description: "CarePoint Next administration and clinical operations portal",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
