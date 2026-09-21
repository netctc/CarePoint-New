"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { patientGovernanceText as pg } from "@/lib/patient-governance-i18n";
import styles from "./PatientGovernance.module.css";

type PatientRow = {
  id: string;
  displayName: string;
  accountStatus: string;
  identity: { emailMasked: string };
  verification: { mfaEnabled: boolean };
  operationalFlags: {
    temporarilyLocked: boolean;
    hasActiveConsent: boolean;
    hasActiveCoverage: boolean;
    dependentRelationshipCount: number;
    activeEmergencyCount: number;
    activeTransportCount: number;
  };
};

type DirectoryResponse = { privacyBoundary: string; clinicalDataIncluded: boolean; items: PatientRow[] };

export function AdminPatientDirectory() {
  const { locale } = useI18n();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    params.set("limit", "100");
    try {
      const response = await fetch(`/api/admin/patients?${params}`, { cache: "no-store" });
      const payload = await response.json() as DirectoryResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || pg(locale, "error"));
      if (payload.clinicalDataIncluded !== false || payload.privacyBoundary !== "ADMINISTRATIVE_ONLY") throw new Error("Administrative privacy boundary is missing.");
      setRows(payload.items ?? []);
    } catch (value) { setError(value instanceof Error ? value.message : pg(locale, "error")); }
    finally { setLoading(false); }
  }, [locale, q, status]);

  useEffect(() => { void load(); }, [load]);

  return <>
    <div className={styles.notice}>{pg(locale, "privacy")}</div>
    {error ? <div className={styles.error}>{error}</div> : null}
    <div className={styles.toolbar}>
      <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} placeholder={pg(locale, "search")} />
      <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={pg(locale, "status")}>
        <option value="">{pg(locale, "all")}</option><option value="ACTIVE">ACTIVE</option><option value="SUSPENDED">SUSPENDED</option><option value="ARCHIVED">ARCHIVED</option>
      </select>
      <button className={styles.ghost} disabled={loading} onClick={() => void load()}>{pg(locale, "refresh")}</button>
    </div>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{pg(locale, "patient")}</th><th>{pg(locale, "identity")}</th><th>{pg(locale, "verification")}</th><th>{pg(locale, "signals")}</th><th /></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><strong>{row.displayName}</strong><div className={styles.muted}>{row.accountStatus}</div></td><td>{row.identity.emailMasked}</td><td><span className={`${styles.badge} ${row.verification.mfaEnabled ? styles.good : styles.warn}`}>{pg(locale, "mfa")}: {row.verification.mfaEnabled ? "ON" : "OFF"}</span>{row.operationalFlags.temporarilyLocked ? <span className={`${styles.badge} ${styles.danger}`}>{pg(locale, "locked")}</span> : null}</td><td>
        {row.operationalFlags.hasActiveConsent ? <span className={`${styles.badge} ${styles.good}`}>{pg(locale, "activeConsent")}</span> : null}
        {row.operationalFlags.hasActiveCoverage ? <span className={`${styles.badge} ${styles.good}`}>{pg(locale, "coverage")}</span> : null}
        {row.operationalFlags.activeEmergencyCount ? <span className={`${styles.badge} ${styles.danger}`}>{pg(locale, "emergency")}: {row.operationalFlags.activeEmergencyCount}</span> : null}
        {row.operationalFlags.activeTransportCount ? <span className={styles.badge}>{pg(locale, "transport")}: {row.operationalFlags.activeTransportCount}</span> : null}
      </td><td><Link className={styles.ghost} href={`/patients/${encodeURIComponent(row.id)}`}>{pg(locale, "open")}</Link></td></tr>)}
      {!loading && rows.length === 0 ? <tr><td colSpan={5} className={styles.empty}>{pg(locale, "noRows")}</td></tr> : null}
    </tbody></table></div>
  </>;
}
