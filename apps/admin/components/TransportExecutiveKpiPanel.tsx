"use client";

import { useEffect, useMemo, useState } from "react";

type MetricSet = {
  requests: number;
  completed: number;
  cancelled: number;
  completionRatePercent: number | null;
  cancellationRatePercent: number | null;
  ground: number;
  air: number;
  assignmentSlaCompliancePercent: number | null;
  resourceReadinessSlaCompliancePercent: number | null;
  departureSlaCompliancePercent: number | null;
  requestsWithAnySlaBreach: number;
  slaBreachRatePercent: number | null;
  requestsWithCriticalIncidents: number;
  requestsWithActiveEscalations: number;
};

type DeltaEntry = {
  current: number | null;
  previous: number | null;
  absolute: number | null;
};

type KpiPayload = {
  generatedAt: string;
  windowDays: number;
  comparison: {
    method: "EQUAL_PREVIOUS_PERIOD";
    current: { from: string; to: string; metrics: MetricSet };
    previous: { from: string; to: string; metrics: MetricSet };
    delta: Record<string, DeltaEntry>;
  };
  trend: {
    bucketDays: number;
    items: Array<{
      bucket: number;
      bucketDays: number;
      current: {
        from: string;
        to: string;
        requests: number;
        completed: number;
        slaBreached: number;
      };
      previous: {
        from: string;
        to: string;
        requests: number;
        completed: number;
        slaBreached: number;
      };
    }>;
  };
  interpretation: {
    automatedRating: false;
    providerRanking: false;
    machineLearning: false;
    note: string;
  };
};

type ReportSchedule = {
  id: string;
  name: string;
  cadence: "DAILY" | "WEEKLY" | "MONTHLY";
  weekday: number | null;
  dayOfMonth: number | null;
  hourUtc: number;
  minuteUtc: number;
  windowDays: number;
  artifactRetentionDays: number;
  mode: "ALL" | "GROUND" | "AIR";
  sla: "ALL" | "BREACHED" | "COMPLIANT" | "PENDING";
  providerId: string | null;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  deliveryMode: "EXTERNAL_SCHEDULER";
  automaticDeliveryAvailable: false;
};

type SchedulePayload = {
  executionMode: "EXTERNAL_SCHEDULER_REQUIRED";
  automaticDeliveryAvailable: false;
  items: ReportSchedule[];
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportExecutiveKpiPanel() {
  const [windowDays, setWindowDays] = useState(30);
  const [kpis, setKpis] = useState<KpiPayload | null>(null);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    name: "Weekly Transport Management Report",
    cadence: "WEEKLY",
    weekday: 1,
    dayOfMonth: 1,
    hourUtc: 7,
    minuteUtc: 0,
    windowDays: 30,
    artifactRetentionDays: 90,
    mode: "ALL",
    sla: "ALL",
  });

  async function jsonRequest(path: string, init?: RequestInit) {
    const response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
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
          : "Transport executive request failed.",
      );
    }
    return body;
  }

  async function loadKpis() {
    const body = (await jsonRequest(
      "/api/admin/transport/executive-kpis?windowDays=" +
        encodeURIComponent(windowDays),
    )) as KpiPayload;
    setKpis(body);
  }

  async function loadSchedules() {
    const body = (await jsonRequest(
      "/api/admin/transport/report-schedules",
    )) as SchedulePayload;
    setSchedules(body.items);
  }

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      await Promise.all([loadKpis(), loadSchedules()]);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Reload executive metrics when the comparison window changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays]);

  const current = kpis?.comparison.current.metrics;
  const delta = kpis?.comparison.delta ?? {};
  const trendRows = useMemo(() => kpis?.trend.items ?? [], [kpis]);

  async function createSchedule() {
    setSaving(true);
    setMessage("");
    try {
      await jsonRequest("/api/admin/transport/report-schedules", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          weekday: form.cadence === "WEEKLY" ? form.weekday : null,
          dayOfMonth: form.cadence === "MONTHLY" ? form.dayOfMonth : null,
        }),
      });
      setMessage(
        "Schedule saved. Execution remains external-scheduler controlled; CarePoint is not claiming automatic delivery.",
      );
      await loadSchedules();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSchedule(schedule: ReportSchedule) {
    setSaving(true);
    setMessage("");
    try {
      await jsonRequest(
        "/api/admin/transport/report-schedules/" + encodeURIComponent(schedule.id),
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: !schedule.enabled }),
        },
      );
      await loadSchedules();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSaving(false);
    }
  }

  async function updateRetention(
    schedule: ReportSchedule,
    artifactRetentionDays: number,
  ) {
    setSaving(true);
    setMessage("");
    try {
      await jsonRequest(
        "/api/admin/transport/report-schedules/" +
          encodeURIComponent(schedule.id),
        {
          method: "PATCH",
          body: JSON.stringify({ artifactRetentionDays }),
        },
      );
      await loadSchedules();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSaving(false);
    }
  }

  async function recordExternalRun(schedule: ReportSchedule) {
    setSaving(true);
    setMessage("");
    try {
      const body = await jsonRequest(
        "/api/admin/transport/report-schedules/" +
          encodeURIComponent(schedule.id) +
          "/mark-run",
        { method: "POST", body: JSON.stringify({}) },
      );
      setMessage(
        typeof body?.note === "string"
          ? body.note
          : "External run timing recorded.",
      );
      await loadSchedules();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 16, marginTop: 24 }}>
      <section style={{ ...card, border: "2px solid #7c3aed" }}>
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
            <span style={{ fontSize: 12, fontWeight: 900, color: "#7c3aed" }}>
              PHASE 13 · EXECUTIVE KPI / PERIOD COMPARISON
            </span>
            <h2 style={{ margin: "5px 0" }}>
              Transport Executive KPI Dashboard
            </h2>
            <p style={{ maxWidth: 980 }}>
              Current period versus the immediately preceding equal period.
              Deltas are descriptive only: no provider ranking, automated quality
              grade or machine-learning interpretation.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
            </select>
            <button className="secondary-button" onClick={() => void load()}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {message ? <p style={{ marginBottom: 0 }}>{message}</p> : null}
      </section>

      {current ? (
        <>
          <section
            style={{
              ...card,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
              gap: 10,
            }}
          >
            <ExecutiveMetric
              label="Requests"
              value={current.requests}
              delta={delta.requests?.absolute}
            />
            <ExecutiveMetric
              label="Completion rate"
              value={pct(current.completionRatePercent)}
              delta={delta.completionRatePercent?.absolute}
              unit="pp"
            />
            <ExecutiveMetric
              label="Assignment SLA"
              value={pct(current.assignmentSlaCompliancePercent)}
              delta={delta.assignmentSlaCompliancePercent?.absolute}
              unit="pp"
            />
            <ExecutiveMetric
              label="Resource readiness SLA"
              value={pct(current.resourceReadinessSlaCompliancePercent)}
              delta={delta.resourceReadinessSlaCompliancePercent?.absolute}
              unit="pp"
            />
            <ExecutiveMetric
              label="Departure SLA"
              value={pct(current.departureSlaCompliancePercent)}
              delta={delta.departureSlaCompliancePercent?.absolute}
              unit="pp"
            />
            <ExecutiveMetric
              label="Requests with SLA breach"
              value={current.requestsWithAnySlaBreach}
              delta={delta.requestsWithAnySlaBreach?.absolute}
            />
            <ExecutiveMetric
              label="Critical-incident requests"
              value={current.requestsWithCriticalIncidents}
              delta={delta.requestsWithCriticalIncidents?.absolute}
            />
            <ExecutiveMetric
              label="Active-escalation requests"
              value={current.requestsWithActiveEscalations}
              delta={delta.requestsWithActiveEscalations?.absolute}
            />
          </section>

          <section style={{ ...card, overflowX: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Aligned period trend</h3>
            <p>
              Each row aligns the same relative bucket in the current and
              previous periods. For windows above 31 days, buckets are weekly.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr>
                  <th align="left">Bucket</th>
                  <th align="right">Current requests</th>
                  <th align="right">Previous requests</th>
                  <th align="right">Current completed</th>
                  <th align="right">Previous completed</th>
                  <th align="right">Current SLA breach</th>
                  <th align="right">Previous SLA breach</th>
                </tr>
              </thead>
              <tbody>
                {trendRows.map((row) => (
                  <tr key={row.bucket} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "8px 6px" }}>
                      {row.bucket} · {row.bucketDays}d
                    </td>
                    <td align="right">{row.current.requests}</td>
                    <td align="right">{row.previous.requests}</td>
                    <td align="right">{row.current.completed}</td>
                    <td align="right">{row.previous.completed}</td>
                    <td align="right">{row.current.slaBreached}</td>
                    <td align="right">{row.previous.slaBreached}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : loading ? (
        <p>Loading executive transport KPIs…</p>
      ) : null}

      <section style={{ ...card, border: "1px solid #a78bfa" }}>
        <h3 style={{ marginTop: 0 }}>Scheduled management-report contracts</h3>
        <p>
          Schedule definitions are persisted in CarePoint. Automatic generation
          or email delivery is <strong>not active</strong>: an external
          scheduler/worker must execute the schedule and record the run.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
            gap: 10,
          }}
        >
          <label>
            Name
            <input
              value={form.name}
              onChange={(event) =>
                setForm((value) => ({ ...value, name: event.target.value }))
              }
            />
          </label>
          <label>
            Cadence
            <select
              value={form.cadence}
              onChange={(event) =>
                setForm((value) => ({ ...value, cadence: event.target.value }))
              }
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>
          {form.cadence === "WEEKLY" ? (
            <label>
              Weekday UTC
              <select
                value={form.weekday}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    weekday: Number(event.target.value),
                  }))
                }
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
                <option value={6}>Saturday</option>
              </select>
            </label>
          ) : null}
          {form.cadence === "MONTHLY" ? (
            <label>
              Day of month
              <input
                type="number"
                min={1}
                max={28}
                value={form.dayOfMonth}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    dayOfMonth: Number(event.target.value),
                  }))
                }
              />
            </label>
          ) : null}
          <label>
            Hour UTC
            <input
              type="number"
              min={0}
              max={23}
              value={form.hourUtc}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  hourUtc: Number(event.target.value),
                }))
              }
            />
          </label>
          <label>
            Minute UTC
            <input
              type="number"
              min={0}
              max={59}
              value={form.minuteUtc}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  minuteUtc: Number(event.target.value),
                }))
              }
            />
          </label>
          <label>
            Report window
            <select
              value={form.windowDays}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  windowDays: Number(event.target.value),
                }))
              }
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          <label>
            Artifact retention
            <select
              value={form.artifactRetentionDays}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  artifactRetentionDays: Number(event.target.value),
                }))
              }
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
              <option value={730}>730 days</option>
            </select>
          </label>
          <label>
            Mode
            <select
              value={form.mode}
              onChange={(event) =>
                setForm((value) => ({ ...value, mode: event.target.value }))
              }
            >
              <option value="ALL">All</option>
              <option value="GROUND">Ground</option>
              <option value="AIR">Air</option>
            </select>
          </label>
          <label>
            SLA filter
            <select
              value={form.sla}
              onChange={(event) =>
                setForm((value) => ({ ...value, sla: event.target.value }))
              }
            >
              <option value="ALL">All</option>
              <option value="BREACHED">Breached</option>
              <option value="COMPLIANT">Compliant</option>
              <option value="PENDING">Pending</option>
            </select>
          </label>
        </div>
        <button
          className="primary-button"
          style={{ marginTop: 12 }}
          disabled={saving}
          onClick={() => void createSchedule()}
        >
          {saving ? "Saving…" : "Create schedule"}
        </button>
      </section>

      <section style={{ ...card, overflowX: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Report schedules</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1150 }}>
          <thead>
            <tr>
              <th align="left">Name</th>
              <th align="left">Cadence</th>
              <th align="left">Window</th>
              <th align="left">Retention</th>
              <th align="left">Filters</th>
              <th align="left">Next run</th>
              <th align="left">Last run</th>
              <th align="left">Status</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((schedule) => (
              <tr key={schedule.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "8px 6px" }}>{schedule.name}</td>
                <td>{schedule.cadence}</td>
                <td>{schedule.windowDays}d</td>
                <td>
                  <select
                    value={schedule.artifactRetentionDays}
                    disabled={saving}
                    onChange={(event) =>
                      void updateRetention(
                        schedule,
                        Number(event.target.value),
                      )
                    }
                  >
                    <option value={30}>30d</option>
                    <option value={90}>90d</option>
                    <option value={180}>180d</option>
                    <option value={365}>365d</option>
                    <option value={730}>730d</option>
                  </select>
                </td>
                <td>
                  {schedule.mode} · {schedule.sla}
                </td>
                <td>{dateTime(schedule.nextRunAt)}</td>
                <td>{schedule.lastRunAt ? dateTime(schedule.lastRunAt) : "—"}</td>
                <td>{schedule.enabled ? "ENABLED" : "DISABLED"}</td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="secondary-button"
                      disabled={saving}
                      onClick={() => void toggleSchedule(schedule)}
                    >
                      {schedule.enabled ? "Disable" : "Enable"}
                    </button>
                    {schedule.enabled ? (
                      <button
                        className="secondary-button"
                        disabled={saving}
                        onClick={() => void recordExternalRun(schedule)}
                      >
                        Record external run
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {schedules.length === 0 ? <p>No report schedules configured.</p> : null}
      </section>
    </section>
  );
}

function ExecutiveMetric({
  label,
  value,
  delta,
  unit,
}: {
  label: string;
  value: string | number;
  delta?: number | null | undefined;
  unit?: string | undefined;
}) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
      <strong style={{ display: "block", fontSize: 22 }}>{value}</strong>
      <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>{label}</span>
      <small>
        Δ previous: {delta == null ? "—" : signed(delta) + (unit ? " " + unit : "")}
      </small>
    </div>
  );
}

function pct(value: number | null) {
  return value == null ? "—" : value + "%";
}

function signed(value: number) {
  return value > 0 ? "+" + value : String(value);
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
