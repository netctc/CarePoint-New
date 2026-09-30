"use client";

import { useEffect, useState } from "react";

type GovernancePayload = {
  generatedAt: string;
  summary: {
    sourceRuns: number;
    sourceCapped: boolean;
    liveArtifacts: number;
    purgedArtifacts: number;
    legalHolds: number;
    purgeClaimsActive: number;
    retentionDue: number;
    expiringWithin7Days: number;
    expiringWithin30Days: number;
    recipientDownloadReceipts: number;
    deliveryAttentionRequired: number;
  };
  sensitiveDataPolicy: {
    patientIdentityIncluded: false;
    patientLocationIncluded: false;
    objectStorageKeyIncluded: false;
  };
  items: Array<{
    runId: string;
    reportFilename: string | null;
    scheduledFor: string;
    artifactStoredAt: string;
    artifactDeletedAt: string | null;
    artifactBytes: number | null;
    artifactLegalHold: boolean;
    artifactLegalHoldReason: string | null;
    artifactLegalHoldSetAt: string | null;
    artifactPurgeClaimedAt: string | null;
    expiresAt: string;
    daysUntilExpiry: number;
    state: "LIVE" | "DUE" | "LEGAL_HOLD" | "PURGE_CLAIMED" | "PURGED";
    deliveryStatus: string;
    recipientDownloadReceipts: number;
    schedule: {
      id: string;
      name: string;
      artifactRetentionDays: number;
    };
  }>;
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportReportGovernancePanel() {
  const [payload, setPayload] = useState<GovernancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/transport/report-governance", {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign(
          "/login?next=" + encodeURIComponent(window.location.pathname),
        );
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body?.message === "string"
            ? body.message
            : "Transport report governance request failed.",
        );
      }
      setPayload(body as GovernancePayload);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = payload?.summary;

  return (
    <section style={{ ...card, marginTop: 24, border: "2px solid #475569" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <span style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>
            PHASE 23 · REPORT GOVERNANCE DASHBOARD
          </span>
          <h2 style={{ margin: "5px 0" }}>Report Retention & Access Governance</h2>
          <p style={{ maxWidth: 980 }}>
            Descriptive inventory of private report artifacts, retention due
            dates, legal holds, purge activity and recipient download receipts.
            Patient identity, patient location and private object-storage keys
            are excluded.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {message ? <p>{message}</p> : null}

      {summary ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            <Metric label="Live artifacts" value={summary.liveArtifacts} />
            <Metric label="Retention due" value={summary.retentionDue} />
            <Metric label="Legal holds" value={summary.legalHolds} />
            <Metric label="Active purge claims" value={summary.purgeClaimsActive} />
            <Metric label="Expiring ≤7d" value={summary.expiringWithin7Days} />
            <Metric label="Expiring ≤30d" value={summary.expiringWithin30Days} />
            <Metric label="Purged" value={summary.purgedArtifacts} />
            <Metric
              label="Download receipts"
              value={summary.recipientDownloadReceipts}
            />
            <Metric
              label="Delivery attention"
              value={summary.deliveryAttentionRequired}
            />
          </div>

          {summary.sourceCapped ? (
            <p style={{ marginTop: 12 }}>
              Governance source reached the bounded 2,000-run cap; displayed
              counts cover the bounded source window only.
            </p>
          ) : null}

          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table
              style={{
                width: "100%",
                minWidth: 1100,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  <th align="left">State</th>
                  <th align="left">Report</th>
                  <th align="left">Schedule</th>
                  <th align="left">Stored</th>
                  <th align="left">Retention</th>
                  <th align="left">Expires</th>
                  <th align="right">Days</th>
                  <th align="right">Bytes</th>
                  <th align="right">Receipts</th>
                  <th align="left">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((item) => (
                  <tr
                    key={item.runId}
                    style={{ borderTop: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: "8px 6px" }}>
                      <strong>{item.state}</strong>
                      {item.artifactLegalHoldReason ? (
                        <div style={{ fontSize: 12 }}>
                          {item.artifactLegalHoldReason}
                        </div>
                      ) : null}
                    </td>
                    <td>{item.reportFilename ?? item.runId}</td>
                    <td>{item.schedule.name}</td>
                    <td>{dateTime(item.artifactStoredAt)}</td>
                    <td>{item.schedule.artifactRetentionDays}d</td>
                    <td>
                      {item.artifactDeletedAt
                        ? "Purged " + dateTime(item.artifactDeletedAt)
                        : dateTime(item.expiresAt)}
                    </td>
                    <td align="right">
                      {item.artifactDeletedAt ? "—" : item.daysUntilExpiry}
                    </td>
                    <td align="right">{item.artifactBytes ?? "—"}</td>
                    <td align="right">{item.recipientDownloadReceipts}</td>
                    <td>{item.deliveryStatus}</td>
                  </tr>
                ))}
                {!payload.items.length ? (
                  <tr>
                    <td colSpan={10} style={{ padding: 12 }}>
                      No successful Transport report artifacts are available in
                      the governance source window.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : loading ? (
        <p>Loading report governance…</p>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10 }}>
      <strong style={{ display: "block", fontSize: 21 }}>{value}</strong>
      <span style={{ fontSize: 12 }}>{label}</span>
    </div>
  );
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
