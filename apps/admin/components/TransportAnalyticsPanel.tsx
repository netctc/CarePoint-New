"use client";

import { useEffect, useMemo, useState } from "react";

type Analytics = {
  generatedAt: string;
  window: { days: number; since: string };
  requests: {
    medicalByStatus: Record<string, number>;
    emergencyByStatus: Record<string, number>;
    last30Days: { medical: number; emergency: number; total: number };
    completedLast30Days: { medical: number; emergency: number; total: number };
  };
  organization: {
    companies: number;
    activeCompanies: number;
    providersInCompanies: number;
  };
  fleet: {
    total: number;
    active: number;
    activeGround: number;
    activeAir: number;
  };
  crew: {
    total: number;
    active: number;
    assignmentReady: number;
    licenseAttention: number;
  };
};

type AuditRow = {
  id: string;
  actorId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  purpose?: string | null;
  result: string;
  occurredAt: string;
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 18,
} as const;

export function TransportAnalyticsPanel() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function request(path: string) {
    const response = await fetch(path, { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/login?next=/transport-providers");
      throw new Error("Authentication required.");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof body?.message === "string" ? body.message : "Request failed.");
    }
    return body;
  }

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const [analyticsBody, auditBody] = await Promise.all([
        request("/api/admin/transport/analytics"),
        request("/api/admin/transport/audit"),
      ]);
      setAnalytics(analyticsBody as Analytics);
      setAudit(Array.isArray(auditBody?.items) ? auditBody.items : []);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const completionRate = useMemo(() => {
    const total = analytics?.requests.last30Days.total ?? 0;
    const completed = analytics?.requests.completedLast30Days.total ?? 0;
    return total === 0 ? 0 : Math.round((completed / total) * 100);
  }, [analytics]);

  return (
    <section style={{ display: "grid", gap: 18, marginTop: 24 }}>
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
              TRANSPORT · ANALYTICS / AUDIT
            </span>
            <h2 style={{ margin: "6px 0" }}>Transport Operations Analytics</h2>
            <p style={{ marginBottom: 0 }}>
              Non-clinical operational metrics for transport demand, organization readiness,
              fleet capacity, crew readiness and recent audited actions.
            </p>
          </div>
          <button className="secondary-button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {message && <p>{message}</p>}
      </section>

      {analytics && (
        <>
          <section style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
            <Metric label="Requests · 30d" value={analytics.requests.last30Days.total} />
            <Metric label="Completed · 30d" value={analytics.requests.completedLast30Days.total} />
            <Metric label="Completion rate" value={completionRate + "%"} />
            <Metric label="Active companies" value={analytics.organization.activeCompanies} />
            <Metric label="Active fleet" value={analytics.fleet.active} />
            <Metric label="Crew ready" value={analytics.crew.assignmentReady} />
            <Metric label="License attention" value={analytics.crew.licenseAttention} />
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 18 }}>
            <StatusCard title="Scheduled medical transport" values={analytics.requests.medicalByStatus} />
            <StatusCard title="Emergency ambulance" values={analytics.requests.emergencyByStatus} />
            <section style={card}>
              <h3 style={{ marginTop: 0 }}>Operational capacity</h3>
              <Definition label="Companies" value={analytics.organization.companies} />
              <Definition label="Providers in companies" value={analytics.organization.providersInCompanies} />
              <Definition label="Fleet units" value={analytics.fleet.total} />
              <Definition label="Active ground units" value={analytics.fleet.activeGround} />
              <Definition label="Active air units" value={analytics.fleet.activeAir} />
              <Definition label="Crew members" value={analytics.crew.total} />
              <Definition label="Active crew" value={analytics.crew.active} />
            </section>
          </section>
        </>
      )}

      <section style={{ ...card, overflowX: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Recent Operational Audit</h3>
        <p>Latest transport-related audit events. Clinical content is intentionally excluded.</p>
        {audit.length === 0 ? (
          <p>No transport audit events available.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Time</th>
                <th align="left">Action</th>
                <th align="left">Object</th>
                <th align="left">Purpose</th>
                <th align="left">Result</th>
                <th align="left">Actor</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>{displayDate(row.occurredAt)}</td>
                  <td style={{ padding: "10px 8px" }}><strong>{row.action}</strong></td>
                  <td style={{ padding: "10px 8px" }}>{row.objectType}<br /><small>{row.objectId ?? "—"}</small></td>
                  <td style={{ padding: "10px 8px" }}>{row.purpose ?? "—"}</td>
                  <td style={{ padding: "10px 8px" }}>{row.result}</td>
                  <td style={{ padding: "10px 8px" }}><small>{row.actorId ?? "SYSTEM"}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
      <strong style={{ display: "block", fontSize: 22 }}>{value}</strong>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
    </div>
  );
}

function StatusCard({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  return (
    <section style={card}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {entries.length === 0 ? <p>No requests recorded.</p> : entries.map(([status, count]) => (
        <Definition key={status} label={status} value={count} />
      ))}
    </section>
  );
}

function Definition({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
      <span>{label}</span><strong>{value}</strong>
    </div>
  );
}

function displayDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
