"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n, type Locale } from "@/lib/i18n";

interface SessionAccount {
  id: string;
  email: string;
  role: "ADMIN";
  status: "ACTIVE";
}

const logoutCopy: Record<Locale, { logout: string; ending: string }> = {
  en: { logout: "Sign out", ending: "Signing out…" },
  ar: { logout: "تسجيل الخروج", ending: "جارٍ تسجيل الخروج…" },
  fr: { logout: "Déconnexion", ending: "Déconnexion…" },
  es: { logout: "Cerrar sesión", ending: "Cerrando sesión…" },
};

export function AdminOperator() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("session unavailable");
        const payload = await response.json() as { account?: SessionAccount };
        if (!payload.account || payload.account.role !== "ADMIN") throw new Error("admin session unavailable");
        setAccount(payload.account);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        router.replace("/login");
        router.refresh();
      });
    return () => controller.abort();
  }, [router]);

  async function logout() {
    setEnding(true);
    try {
      await fetch("/api/admin/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const email = account?.email ?? t("shell.platformAdministrator");
  const initials = account?.email ? account.email.slice(0, 2).toUpperCase() : "PA";
  const c = logoutCopy[locale];

  return (
    <div className="operator admin-operator">
      <span className="notification">●</span>
      <div className="admin-operator-identity">
        <strong>{email}</strong>
        <small>{t("common.secureSession")}</small>
      </div>
      <div className="avatar">{initials}</div>
      <button type="button" className="admin-logout" onClick={logout} disabled={ending}>{ending ? c.ending : c.logout}</button>
    </div>
  );
}
