"use client";

import { useEffect, useMemo, useState } from "react";

type Severity = "CRITICAL" | "WARNING" | "INFO";
type ExceptionRow = {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  since: string;
  overdueMinutes: number | null;
  recommendedAction: string;
};
type LiveItem = {
  requestId: string;
  patientLabel: string;
  mode: "GROUND" | "AIR";
  status: string;
  scheduledFor: string;
  assignedProvider?: { id: string; displayName: string } | null;
  etaMinutes?: number | null;
  exceptionCount: number;
  highestSeverity: Severity;
  exceptions: ExceptionRow[];
};
type LivePayload = {
  generatedAt: string;
  trackingMode: string;
  liveGpsTrackingAvailable: boolean;
  thresholds: {
    assignmentSlaMinutes: number;
    resourceReadySlaMinutes: number;
    etaRefreshSlaMinutes: number;
    departureGraceMinutes: number;
  };
  summary: {
    exceptionRequests: number;
    criticalRequests: number;
    warningRequests: number;
    totalExceptions: number;
  };
  items: LiveItem[];
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportLiveOperationsPanel() {
  const [data, setData] = useState<LivePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<"ALL" | Severity>("ALL");

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (response.status === 401) {
      window.location.assign(
        "/login?next=" + encodeURIComponent(window.location.pathname),
      );
      throw new Error("Authentication required.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof payload?.message === "string"
          ? payload.message
          : "Transport live-operations request failed.",
      );
    }
    return payload;
  }

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      setData(
        (await request("/api/admin/transport/live-operations")) as LivePayload,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const items = useMemo(() => {
    const rows = data?.items ?? [];
    return severity === "ALL"
      ? rows
      : rows.filter((row) => row.highestSeverity === severity);
  }, [data, severity]);

  async function notifyProvider(item: LiveItem, exceptionCode: string) {
    setWorking(item.requestId + ":" + exceptionCode);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/live-operations/" +
          encodeURIComponent(item.requestId) +
          "/notify-provider",
        {
          method: "POST",
          body: JSON.stringify({ exceptionCode }),
        },
      );
      setMessage(
        "Operational attention was sent to the assigned Transport Provider.",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  const summary = data?.summary ?? {
    exceptionRequests: 0,
    criticalRequests: 0,
    warningRequests: 0,
    totalExceptions: 0,
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section style={{ ...card, border: "2px solid #f59e0b" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#92400e" }}>
              PHASE 7 · LIVE OPERATIONS & EXCEPTIONS
            </span>
            <h2 style={{ margin: "5px 0" }}>
              Transport Exception Control
            </h2>
            <p style={{ maxWidth: 860 }}>
              Prioritize active transport exceptions from dispatch SLA,
              provider readiness, crew/unit readiness, ETA freshness,
              departure timing and reported incidents. This surface uses
              route estimates only; it does not claim real-time GPS tracking.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => void load()}
            disabled={loading || Boolean(working)}
          >
            Refresh exceptions
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
            gap: 10,
          }}
        >
          <Metric label="Exception requests" value={summary.exceptionRequests} />
          <Metric label="Critical" value={summary.criticalRequests} />
          <Metric label="Warning" value={summary.warningRequests} />
          <Metric label="Total exceptions" value={summary.totalExceptions} />
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 14,
          }}
        >
          <label>
            Severity{" "}
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as "ALL" | Severity)
              }
            >
              <option value="ALL">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </label>
          <small>
            Assignment SLA {data?.thresholds.assignmentSlaMinutes ?? "—"} min ·
            resources {data?.thresholds.resourceReadySlaMinutes ?? "—"} min ·
            ETA refresh {data?.thresholds.etaRefreshSlaMinutes ?? "—"} min ·
            departure grace {data?.thresholds.departureGraceMinutes ?? "—"} min
          </small>
        </div>

        <p style={{ marginBottom: 0 }}>
          Tracking: <strong>{data?.trackingMode ?? "ESTIMATED_ROUTE_ONLY"}</strong>
          {" · "}
          live GPS: <strong>{data?.liveGpsTrackingAvailable ? "AVAILABLE" : "NOT IMPLEMENTED"}</strong>
        </p>
        {message ? <p style={{ marginBottom: 0 }}>{message}</p> : null}
      </section>

      {loading ? (
        <p>Loading transport exceptions…</p>
      ) : items.length === 0 ? (
        <section style={card}>
          <strong>No active transport exceptions match the selected severity.</strong>
        </section>
      ) : (
        <section style={{ display: "grid", gap: 12 }}>
          {items.map((item) => (
            <article
              key={item.requestId}
              style={{
                ...card,
                border:
                  item.highestSeverity === "CRITICAL"
                    ? "2px solid #dc2626"
                    : item.highestSeverity === "WARNING"
                      ? "2px solid #f59e0b"
                      : "1px solid #cbd5e1",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  alignItems: "start",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong style={{ fontSize: 18 }}>{item.patientLabel}</strong>
                  <div>
                    <small>
                      {item.mode} · {item.status} · scheduled{" "}
                      {formatDate(item.scheduledFor)}
                    </small>
                  </div>
                  <div>
                    <small>
                      Provider:{" "}
                      {item.assignedProvider?.displayName ?? "UNASSIGNED"} · ETA:{" "}
                      {item.etaMinutes != null ? item.etaMinutes + " min" : "—"}
                    </small>
                  </div>
                </div>
                <SeverityBadge severity={item.highestSeverity} />
              </div>

              <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                {item.exceptions.map((exception, index) => (
                  <div
                    key={exception.code + ":" + index}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: 12,
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(130px,180px) minmax(260px,1fr) auto",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <SeverityBadge severity={exception.severity} />
                      <div style={{ marginTop: 5 }}>
                        <small>{exception.code}</small>
                      </div>
                    </div>
                    <div>
                      <strong>{exception.title}</strong>
                      <div>
                        <small>{exception.detail}</small>
                      </div>
                      <div>
                        <small>
                          Since {formatDate(exception.since)}
                          {exception.overdueMinutes != null
                            ? " · overdue " + exception.overdueMinutes + " min"
                            : ""}
                          {" · "}
                          action {exception.recommendedAction}
                        </small>
                      </div>
                    </div>
                    <div>
                      {item.assignedProvider ? (
                        <button
                          className="secondary-button"
                          disabled={
                            working ===
                            item.requestId + ":" + exception.code
                          }
                          onClick={() =>
                            void notifyProvider(item, exception.code)
                          }
                        >
                          Notify provider
                        </button>
                      ) : (
                        <small>Assign provider in Dispatch Board</small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 12,
        display: "grid",
        gap: 3,
      }}
    >
      <strong style={{ fontSize: 24 }}>{value}</strong>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const background =
    severity === "CRITICAL"
      ? "#fef2f2"
      : severity === "WARNING"
        ? "#fff7ed"
        : "#f8fafc";
  return (
    <span
      style={{
        display: "inline-flex",
        border: "1px solid #cbd5e1",
        borderRadius: 999,
        padding: "4px 8px",
        fontSize: 10,
        fontWeight: 900,
        background,
      }}
    >
      {severity}
    </span>
  );
}

function formatDate(raw: string) {
  const value = new Date(raw);
  return Number.isFinite(value.getTime()) ? value.toLocaleString() : raw;
}
