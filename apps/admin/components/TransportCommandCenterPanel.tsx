"use client";

import { useEffect, useMemo, useState } from "react";

type SlaState = "BREACHED" | "COMPLIANT" | "PENDING" | "NOT_APPLICABLE";
type SlaMetric = {
  state: SlaState;
  minutes: number | null;
  thresholdMinutes: number;
};

type Item = {
  requestId: string;
  mode: "GROUND" | "AIR";
  status: string;
  requestedAt: string;
  scheduledFor: string;
  assignedAt?: string | null;
  enRouteAt?: string | null;
  arrivedAt?: string | null;
  transportingAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  provider?: { id: string; displayName: string } | null;
  sla: {
    assignment: SlaMetric;
    resourceReadiness: SlaMetric;
    departure: SlaMetric;
    breachCount: number;
    pendingCount: number;
    overall: "BREACHED" | "COMPLIANT" | "PENDING";
  };
  etaEvidence: boolean;
  incidents: {
    total: number;
    warning: number;
    critical: number;
  };
  escalations: {
    total: number;
    open: number;
    acknowledged: number;
    resolved: number;
    critical: number;
  };
};

type Payload = {
  generatedAt: string;
  filters: {
    windowDays: number;
    mode: string;
    providerId?: string | null;
    sla: string;
    page: number;
    limit: number;
    providers: Array<{ id: string; displayName: string }>;
  };
  summary: {
    requests: number;
    completed: number;
    cancelled: number;
    active: number;
    slaBreached: number;
    slaPending: number;
    slaCompliant: number;
    requestsWithCriticalIncidents: number;
    requestsWithOpenEscalations: number;
    distinctProviders: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    truncatedSource: boolean;
  };
  sensitiveDataPolicy: {
    patientIdentityIncluded: false;
    patientContactIncluded: false;
    pickupAddressIncluded: false;
    destinationAddressIncluded: false;
    coordinatesIncluded: false;
    managementReportPurpose: string;
  };
  items: Item[];
};

type ReportPayload = {
  filename: string;
  format: "CSV_CLIENT_RENDERED";
  columns: string[];
  rows: Array<Record<string, string | number | boolean>>;
  truncatedSource: boolean;
  sensitiveDataPolicy: Payload["sensitiveDataPolicy"];
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportCommandCenterPanel() {
  const [windowDays, setWindowDays] = useState(90);
  const [mode, setMode] = useState("ALL");
  const [sla, setSla] = useState("ALL");
  const [providerId, setProviderId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({
      windowDays: String(windowDays),
      mode,
      sla,
      page: String(page),
      limit: "100",
    });
    if (providerId) params.set("providerId", providerId);
    return params.toString();
  }, [windowDays, mode, sla, providerId, page]);

  async function request(path: string) {
    const response = await fetch(path, { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign(
        "/login?next=" + encodeURIComponent(window.location.pathname),
      );
      throw new Error("Authentication required.");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof body?.message === "string"
          ? body.message
          : "Transport command-center request failed.",
      );
    }
    return body;
  }

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const body = (await request(
        "/api/admin/transport/command-center?" + query,
      )) as Payload;
      setData(body);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Reload whenever the bounded operational filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function changeFilter(action: () => void) {
    setPage(1);
    action();
  }

  async function exportCsv() {
    setExporting(true);
    setMessage("");
    try {
      const params = new URLSearchParams({
        windowDays: String(windowDays),
        mode,
        sla,
      });
      if (providerId) params.set("providerId", providerId);
      const report = (await request(
        "/api/admin/transport/management-report?" + params.toString(),
      )) as ReportPayload;
      const header = report.columns.map(csvCell).join(",");
      const lines = report.rows.map((row) =>
        report.columns.map((column) => csvCell(row[column] ?? "")).join(","),
      );
      const blob = new Blob(
        ["\uFEFF", [header, ...lines].join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      );
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = report.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      setMessage(
        "Management CSV exported with operational identifiers only; patient identity, contact, addresses and coordinates are excluded.",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 16, marginTop: 24 }}>
      <section style={{ ...card, border: "2px solid #1d4ed8" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "start",
          }}
        >
          <div>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8" }}>
              PHASE 12 · OPERATIONS COMMAND CENTER
            </span>
            <h2 style={{ margin: "5px 0" }}>
              Historical SLA Drill-Down & Management Reporting
            </h2>
            <p style={{ maxWidth: 980 }}>
              Request-level operational evidence for SLA analysis and management
              reporting. Patient identity, contact details, pickup/destination
              addresses and coordinates are intentionally excluded.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="secondary-button"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              className="primary-button"
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? "Preparing CSV…" : "Export management CSV"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <label>
            History{" "}
            <select
              value={windowDays}
              onChange={(event) =>
                changeFilter(() => setWindowDays(Number(event.target.value)))
              }
            >
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          <label>
            Mode{" "}
            <select
              value={mode}
              onChange={(event) =>
                changeFilter(() => setMode(event.target.value))
              }
            >
              <option value="ALL">All</option>
              <option value="GROUND">Ground</option>
              <option value="AIR">Air</option>
            </select>
          </label>
          <label>
            SLA{" "}
            <select
              value={sla}
              onChange={(event) =>
                changeFilter(() => setSla(event.target.value))
              }
            >
              <option value="ALL">All</option>
              <option value="BREACHED">Breached</option>
              <option value="COMPLIANT">Compliant</option>
              <option value="PENDING">Pending</option>
            </select>
          </label>
          <label>
            Provider{" "}
            <select
              value={providerId}
              onChange={(event) =>
                changeFilter(() => setProviderId(event.target.value))
              }
            >
              <option value="">All providers</option>
              {(data?.filters.providers ?? []).map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {message ? <p style={{ marginBottom: 0 }}>{message}</p> : null}
        {data?.pagination.truncatedSource ? (
          <p style={{ marginBottom: 0 }}>
            <strong>Source capped at 5,000 requests.</strong> Narrow the history,
            provider, mode or SLA filter for complete drill-down coverage.
          </p>
        ) : null}
      </section>

      {data ? (
        <>
          <section
            style={{
              ...card,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))",
              gap: 10,
            }}
          >
            <Metric label="Matching requests" value={data.summary.requests} />
            <Metric label="Active" value={data.summary.active} />
            <Metric label="Completed" value={data.summary.completed} />
            <Metric label="Cancelled" value={data.summary.cancelled} />
            <Metric label="SLA breached" value={data.summary.slaBreached} />
            <Metric label="SLA pending" value={data.summary.slaPending} />
            <Metric label="SLA compliant" value={data.summary.slaCompliant} />
            <Metric
              label="Critical incidents"
              value={data.summary.requestsWithCriticalIncidents}
            />
            <Metric
              label="Open escalations"
              value={data.summary.requestsWithOpenEscalations}
            />
          </section>

          <section style={{ ...card, overflowX: "auto" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <h3 style={{ marginTop: 0 }}>Historical request drill-down</h3>
                <p>
                  Operational request IDs are retained for traceability. No
                  patient name, phone, address or coordinate data is returned.
                </p>
              </div>
              <small>
                Page {data.pagination.page} / {data.pagination.totalPages} ·{" "}
                {data.pagination.total} matching
              </small>
            </div>

            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 1380,
              }}
            >
              <thead>
                <tr>
                  <th align="left">Request</th>
                  <th align="left">Provider</th>
                  <th align="left">Status</th>
                  <th align="left">Scheduled</th>
                  <th align="left">Assignment SLA</th>
                  <th align="left">Resource SLA</th>
                  <th align="left">Departure SLA</th>
                  <th align="left">ETA evidence</th>
                  <th align="right">Incidents</th>
                  <th align="right">Escalations</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.requestId}
                    style={{ borderTop: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: "9px 7px" }}>
                      <strong>{shortId(item.requestId)}</strong>
                      <br />
                      <small>{item.mode}</small>
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      {item.provider?.displayName ?? "UNASSIGNED"}
                    </td>
                    <td style={{ padding: "9px 7px" }}>{item.status}</td>
                    <td style={{ padding: "9px 7px", whiteSpace: "nowrap" }}>
                      {displayDate(item.scheduledFor)}
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      <SlaBadge metric={item.sla.assignment} />
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      <SlaBadge metric={item.sla.resourceReadiness} />
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      <SlaBadge metric={item.sla.departure} />
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      {item.mode === "GROUND"
                        ? item.etaEvidence
                          ? "YES"
                          : "NO"
                        : "N/A"}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {item.incidents.total}
                      {item.incidents.critical > 0
                        ? " (" + item.incidents.critical + " critical)"
                        : ""}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {item.escalations.total}
                      {item.escalations.open + item.escalations.acknowledged > 0
                        ? " (" +
                          (item.escalations.open +
                            item.escalations.acknowledged) +
                          " active)"
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {data.items.length === 0 ? (
              <p>No transport requests match the current filters.</p>
            ) : null}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                marginTop: 14,
              }}
            >
              <button
                className="secondary-button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <button
                className="secondary-button"
                disabled={page >= data.pagination.totalPages}
                onClick={() =>
                  setPage((current) =>
                    Math.min(data.pagination.totalPages, current + 1),
                  )
                }
              >
                Next
              </button>
            </div>
          </section>

          <section style={card}>
            <h3 style={{ marginTop: 0 }}>Management-report privacy boundary</h3>
            <Definition
              label="Patient identity included"
              value={yesNo(data.sensitiveDataPolicy.patientIdentityIncluded)}
            />
            <Definition
              label="Patient contact included"
              value={yesNo(data.sensitiveDataPolicy.patientContactIncluded)}
            />
            <Definition
              label="Pickup/destination addresses included"
              value={yesNo(
                data.sensitiveDataPolicy.pickupAddressIncluded ||
                  data.sensitiveDataPolicy.destinationAddressIncluded,
              )}
            />
            <Definition
              label="Coordinates included"
              value={yesNo(data.sensitiveDataPolicy.coordinatesIncluded)}
            />
          </section>
        </>
      ) : loading ? (
        <p>Loading Transport Operations Command Center…</p>
      ) : null}
    </section>
  );
}

function SlaBadge({ metric }: { metric: SlaMetric }) {
  return (
    <span
      style={{
        display: "inline-flex",
        gap: 5,
        alignItems: "center",
        border: "1px solid #cbd5e1",
        borderRadius: 999,
        padding: "4px 8px",
        fontSize: 10,
        fontWeight: 800,
        background:
          metric.state === "BREACHED"
            ? "#fef2f2"
            : metric.state === "PENDING"
              ? "#fff7ed"
              : metric.state === "COMPLIANT"
                ? "#f0fdf4"
                : "#f8fafc",
      }}
    >
      {metric.state}
      {metric.minutes != null ? " · " + metric.minutes + "m" : ""}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <strong style={{ display: "block", fontSize: 22 }}>{value}</strong>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
    </div>
  );
}

function Definition({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
        borderBottom: "1px solid #f1f5f9",
      }}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function displayDate(raw: string) {
  const value = new Date(raw);
  return Number.isFinite(value.getTime()) ? value.toLocaleString() : raw;
}

function shortId(value: string) {
  return value.length > 14 ? value.slice(0, 8) + "…" + value.slice(-4) : value;
}

function yesNo(value: boolean) {
  return value ? "YES" : "NO";
}

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) {
    text = '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}
