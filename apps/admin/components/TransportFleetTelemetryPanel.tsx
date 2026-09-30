"use client";

import { useEffect, useMemo, useState } from "react";

type TelemetryItem = {
  sessionId: string;
  requestId: string;
  provider?: { id: string; displayName: string } | null;
  unit?: {
    id: string;
    code: string;
    registrationCode: string;
    mode: string;
    active: boolean;
  } | null;
  request: {
    mode: string;
    status: string;
    scheduledFor: string;
    routeEtaMinutes?: number | null;
  };
  sharingStatus: string;
  shareWithPatient: boolean;
  startedAt: string;
  expiresAt: string;
  lastHeartbeatAt?: string | null;
  freshness: "FRESH" | "STALE" | "NO_HEARTBEAT";
  ageSeconds?: number | null;
  location?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number | null;
    headingDegrees?: number | null;
    speedKph?: number | null;
    capturedAt: string;
    receivedAt: string;
    source: string;
  } | null;
  trackingPositionIsRouteEta: false;
};

type TelemetryPayload = {
  generatedAt: string;
  trackingMode: string;
  routeEtaIsSeparate: boolean;
  freshnessSeconds: number;
  retentionHours: number;
  sessionTtlMinutes: number;
  summary: {
    activeSessions: number;
    fresh: number;
    stale: number;
    noHeartbeat: number;
  };
  items: TelemetryItem[];
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportFleetTelemetryPanel() {
  const [data, setData] = useState<TelemetryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"ALL" | "FRESH" | "STALE" | "NO_HEARTBEAT">("ALL");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/transport/telemetry", {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign(
          "/login?next=" + encodeURIComponent(window.location.pathname),
        );
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.message === "string"
            ? payload.message
            : "Transport telemetry request failed.",
        );
      }
      setData(payload as TelemetryPayload);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const items = useMemo(() => {
    const rows = data?.items ?? [];
    return filter === "ALL"
      ? rows
      : rows.filter((row) => row.freshness === filter);
  }, [data, filter]);

  const summary = data?.summary ?? {
    activeSessions: 0,
    fresh: 0,
    stale: 0,
    noHeartbeat: 0,
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section style={{ ...card, border: "2px solid #0ea5e9" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#0369a1" }}>
              PHASE 8 · FLEET TELEMETRY
            </span>
            <h2 style={{ margin: "5px 0" }}>Transport Fleet Telemetry</h2>
            <p style={{ maxWidth: 900 }}>
              Foreground provider-device telemetry for active medical transport
              only. Vehicle position and route ETA are intentionally separate
              signals; this view does not claim background or always-on GPS.
            </p>
          </div>
          <button className="secondary-button" onClick={() => void load()} disabled={loading}>
            Refresh telemetry
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
            gap: 10,
          }}
        >
          <Metric label="Active sharing sessions" value={summary.activeSessions} />
          <Metric label="Fresh" value={summary.fresh} />
          <Metric label="Stale" value={summary.stale} />
          <Metric label="No heartbeat" value={summary.noHeartbeat} />
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 14,
          }}
        >
          <label>
            Freshness{" "}
            <select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as typeof filter)
              }
            >
              <option value="ALL">All</option>
              <option value="FRESH">Fresh</option>
              <option value="STALE">Stale</option>
              <option value="NO_HEARTBEAT">No heartbeat</option>
            </select>
          </label>
          <small>
            Fresh ≤ {data?.freshnessSeconds ?? "—"} sec · retention{" "}
            {data?.retentionHours ?? "—"} h · session TTL{" "}
            {data?.sessionTtlMinutes ?? "—"} min
          </small>
        </div>
        {message ? <p style={{ marginBottom: 0 }}>{message}</p> : null}
      </section>

      {loading && !data ? (
        <p>Loading fleet telemetry…</p>
      ) : items.length === 0 ? (
        <section style={card}>
          <strong>No active telemetry sessions match this filter.</strong>
        </section>
      ) : (
        <section style={{ display: "grid", gap: 12 }}>
          {items.map((item) => (
            <article key={item.sessionId} style={card}>
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
                  <strong style={{ fontSize: 17 }}>
                    {item.provider?.displayName ?? "Transport Provider"}
                  </strong>
                  <div>
                    <small>
                      {item.unit?.code ?? "Unit unavailable"} · {item.request.mode} ·{" "}
                      {item.request.status}
                    </small>
                  </div>
                  <div>
                    <small>Request {item.requestId}</small>
                  </div>
                </div>
                <FreshnessBadge freshness={item.freshness} />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <Detail
                  label="Last heartbeat"
                  value={item.lastHeartbeatAt ? formatDate(item.lastHeartbeatAt) : "—"}
                />
                <Detail
                  label="Heartbeat age"
                  value={item.ageSeconds == null ? "—" : item.ageSeconds + " sec"}
                />
                <Detail
                  label="Vehicle position"
                  value={
                    item.location
                      ? item.location.latitude + ", " + item.location.longitude
                      : "—"
                  }
                />
                <Detail
                  label="Accuracy"
                  value={
                    item.location?.accuracyMeters == null
                      ? "—"
                      : Math.round(item.location.accuracyMeters) + " m"
                  }
                />
                <Detail
                  label="Speed"
                  value={
                    item.location?.speedKph == null
                      ? "—"
                      : item.location.speedKph.toFixed(1) + " km/h"
                  }
                />
                <Detail
                  label="Route ETA"
                  value={
                    item.request.routeEtaMinutes == null
                      ? "—"
                      : item.request.routeEtaMinutes + " min"
                  }
                />
              </div>

              <p style={{ marginBottom: 0, fontSize: 12, color: "#64748b" }}>
                Source: {item.location?.source ?? data?.trackingMode ?? "—"}.
                Coordinates are operational telemetry; route ETA remains a
                separately calculated estimate.
              </p>
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
      }}
    >
      <strong style={{ display: "block", fontSize: 24 }}>{value}</strong>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small style={{ color: "#64748b" }}>{label}</small>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function FreshnessBadge({
  freshness,
}: {
  freshness: "FRESH" | "STALE" | "NO_HEARTBEAT";
}) {
  const background =
    freshness === "FRESH"
      ? "#ecfdf5"
      : freshness === "STALE"
        ? "#fff7ed"
        : "#f8fafc";
  return (
    <span
      style={{
        border: "1px solid #cbd5e1",
        borderRadius: 999,
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 900,
        background,
      }}
    >
      {freshness}
    </span>
  );
}

function formatDate(raw: string) {
  const value = new Date(raw);
  return Number.isFinite(value.getTime()) ? value.toLocaleString() : raw;
}
