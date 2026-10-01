"use client";

import { useEffect, useMemo, useState } from "react";

type Distribution = {
  count: number;
  average: number;
  p50: number | null;
  p90: number | null;
  max: number | null;
};

type ModeCapacity = {
  activeUnits: number;
  dispatchReadyProviders: number;
  activeJobs: number;
  upcoming24h: number;
  upcoming72h: number;
  upcoming7d: number;
  upcoming24hPerActiveUnit: number | null;
  upcoming72hPerActiveUnit: number | null;
  note: string;
};

type ForecastMode = {
  historicalWeekdayAverage: number;
  booked: number;
  bookedVsHistoricalAveragePercent: number | null;
  historicalAveragePerActiveUnit: number | null;
  bookedPerActiveUnit: number | null;
  planningSignal: string;
};

type ProviderPerformance = {
  providerId: string;
  displayName: string;
  mode: "GROUND" | "AIR";
  dispatchReadyNow: boolean;
  requests: number;
  completed: number;
  cancelled: number;
  completionRatePercent: number | null;
  measurableDepartures: number;
  onTimeDepartureRatePercent: number | null;
  transportDurationMinutes: Distribution;
  incidents: number;
  escalations: number;
  activeJobs: number;
  activeUnitCount: number;
};

type Payload = {
  generatedAt: string;
  method: {
    analyticsWindowDays: number;
    forecastDays: number;
    forecastMethod: string;
    machineLearning: false;
    capacityGuarantee: false;
    providerRanking: false;
  };
  thresholds: {
    assignmentSlaMinutes: number;
    resourceReadySlaMinutes: number;
    departureGraceMinutes: number;
  };
  summary: {
    historicalRequests: number;
    completed: number;
    cancelled: number;
    currentDispatchReadyProviders: number;
    currentActiveUnits: number;
    upcomingScheduledRequests: number;
  };
  sla: {
    assignment: {
      evaluated: number;
      pendingWithinSla: number;
      measurableAssigned: number;
      withinSla: number;
      breached: number;
      compliancePercent: number | null;
      minutes: Distribution;
    };
    resourceReadiness: {
      evaluated: number;
      measurableReady: number;
      withinSla: number;
      breached: number;
      compliancePercent: number | null;
      minutes: Distribution;
    };
    departure: {
      evaluated: number;
      pendingWithinGrace: number;
      measurableDepartures: number;
      withinGrace: number;
      breached: number;
      compliancePercent: number | null;
      delayMinutes: Distribution;
    };
    etaCoverage: {
      eligibleGroundAssigned: number;
      withEtaEvidence: number;
      coveragePercent: number | null;
    };
  };
  lifecycle: {
    requestToCompletionMinutes: Distribution;
    transportingToCompletionMinutes: Distribution;
  };
  escalations: {
    total: number;
    open: number;
    acknowledged: number;
    resolved: number;
    autoResolved: number;
    acknowledgementMinutes: Distribution;
    resolutionMinutes: Distribution;
  };
  incidents: {
    total: number;
    warning: number;
    critical: number;
  };
  capacity: {
    ground: ModeCapacity;
    air: ModeCapacity;
  };
  forecast: {
    method: string;
    machineLearning: false;
    capacityGuarantee: false;
    days: Array<{
      date: string;
      weekday: string;
      ground: ForecastMode;
      air: ForecastMode;
    }>;
  };
  providerPerformance: ProviderPerformance[];
  daily: Array<{
    date: string;
    ground: number;
    air: number;
    completed: number;
    cancelled: number;
  }>;
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportPerformanceAnalyticsPanel() {
  const [windowDays, setWindowDays] = useState(90);
  const [forecastDays, setForecastDays] = useState(14);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        "/api/admin/transport/performance-analytics?windowDays=" +
          encodeURIComponent(windowDays) +
          "&forecastDays=" +
          encodeURIComponent(forecastDays),
        { cache: "no-store" },
      );
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
            : "Transport performance analytics request failed.",
        );
      }
      setData(body as Payload);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Explicitly reload when the selected analysis windows change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays, forecastDays]);

  const recentDaily = useMemo(
    () => (data?.daily ?? []).slice(-14),
    [data],
  );

  return (
    <section style={{ display: "grid", gap: 16, marginTop: 24 }}>
      <section style={{ ...card, border: "2px solid #0f766e" }}>
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
            <span style={{ fontSize: 12, fontWeight: 900, color: "#0f766e" }}>
              PHASE 11 · CAPACITY / SLA / PERFORMANCE INTELLIGENCE
            </span>
            <h2 style={{ margin: "5px 0" }}>
              Transport Capacity & SLA Intelligence
            </h2>
            <p style={{ maxWidth: 940 }}>
              Historical operational analytics, provider-level performance
              evidence, current capacity proxies and same-weekday planning
              averages. This surface is descriptive and does not rank providers,
              guarantee capacity or use machine learning.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 12,
          }}
        >
          <label>
            History{" "}
            <select
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
            >
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          <label>
            Planning horizon{" "}
            <select
              value={forecastDays}
              onChange={(event) => setForecastDays(Number(event.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <small>
            Method {data?.method.forecastMethod ?? "SAME_WEEKDAY_HISTORICAL_AVERAGE"}
            {" · "}ML {data?.method.machineLearning ? "YES" : "NO"}
            {" · "}capacity guarantee {data?.method.capacityGuarantee ? "YES" : "NO"}
          </small>
        </div>
        {message ? <p style={{ marginBottom: 0 }}>{message}</p> : null}
      </section>

      {data ? (
        <>
          <section
            style={{
              ...card,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))",
              gap: 10,
            }}
          >
            <Metric label="Historical requests" value={data.summary.historicalRequests} />
            <Metric label="Completed" value={data.summary.completed} />
            <Metric label="Cancelled" value={data.summary.cancelled} />
            <Metric
              label="Dispatch-ready providers"
              value={data.summary.currentDispatchReadyProviders}
            />
            <Metric label="Active units" value={data.summary.currentActiveUnits} />
            <Metric
              label="Upcoming scheduled"
              value={data.summary.upcomingScheduledRequests}
            />
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
              gap: 16,
            }}
          >
            <SlaCard
              title="Provider assignment SLA"
              compliance={data.sla.assignment.compliancePercent}
              evaluated={data.sla.assignment.evaluated}
              passed={data.sla.assignment.withinSla}
              breached={data.sla.assignment.breached}
              pending={data.sla.assignment.pendingWithinSla}
              distribution={data.sla.assignment.minutes}
              threshold={data.thresholds.assignmentSlaMinutes + " min"}
            />
            <SlaCard
              title="Crew / unit readiness SLA"
              compliance={data.sla.resourceReadiness.compliancePercent}
              evaluated={data.sla.resourceReadiness.evaluated}
              passed={data.sla.resourceReadiness.withinSla}
              breached={data.sla.resourceReadiness.breached}
              distribution={data.sla.resourceReadiness.minutes}
              threshold={data.thresholds.resourceReadySlaMinutes + " min"}
            />
            <SlaCard
              title="Departure grace compliance"
              compliance={data.sla.departure.compliancePercent}
              evaluated={data.sla.departure.evaluated}
              passed={data.sla.departure.withinGrace}
              breached={data.sla.departure.breached}
              pending={data.sla.departure.pendingWithinGrace}
              distribution={data.sla.departure.delayMinutes}
              threshold={data.thresholds.departureGraceMinutes + " min"}
            />
            <section style={card}>
              <h3 style={{ marginTop: 0 }}>ETA / escalation evidence</h3>
              <Definition
                label="Ground ETA coverage"
                value={percent(data.sla.etaCoverage.coveragePercent)}
              />
              <Definition
                label="ETA eligible"
                value={data.sla.etaCoverage.eligibleGroundAssigned}
              />
              <Definition
                label="Escalations"
                value={data.escalations.total}
              />
              <Definition
                label="Open / acknowledged"
                value={
                  data.escalations.open + " / " + data.escalations.acknowledged
                }
              />
              <Definition
                label="Escalation ACK p50"
                value={minutes(data.escalations.acknowledgementMinutes.p50)}
              />
              <Definition
                label="Resolution p50"
                value={minutes(data.escalations.resolutionMinutes.p50)}
              />
            </section>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
              gap: 16,
            }}
          >
            <CapacityCard title="Ground capacity proxy" value={data.capacity.ground} />
            <CapacityCard title="Air capacity proxy" value={data.capacity.air} />
            <section style={card}>
              <h3 style={{ marginTop: 0 }}>Lifecycle duration</h3>
              <Definition
                label="Request→completion p50"
                value={minutes(data.lifecycle.requestToCompletionMinutes.p50)}
              />
              <Definition
                label="Request→completion p90"
                value={minutes(data.lifecycle.requestToCompletionMinutes.p90)}
              />
              <Definition
                label="Transporting→completion p50"
                value={minutes(data.lifecycle.transportingToCompletionMinutes.p50)}
              />
              <Definition
                label="Transporting→completion p90"
                value={minutes(data.lifecycle.transportingToCompletionMinutes.p90)}
              />
              <Definition label="Incidents" value={data.incidents.total} />
              <Definition
                label="Warning / critical"
                value={data.incidents.warning + " / " + data.incidents.critical}
              />
            </section>
          </section>

          <section style={{ ...card, overflowX: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Planning horizon</h3>
            <p>
              Same-weekday historical averages are shown beside already booked
              demand. The planning signal is descriptive; it is not a capacity
              guarantee.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="left">Ground booked / avg</th>
                  <th align="left">Ground load proxy</th>
                  <th align="left">Ground signal</th>
                  <th align="left">Air booked / avg</th>
                  <th align="left">Air load proxy</th>
                  <th align="left">Air signal</th>
                </tr>
              </thead>
              <tbody>
                {data.forecast.days.map((day) => (
                  <tr key={day.date} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "9px 7px" }}>
                      <strong>{day.date}</strong>
                      <br />
                      <small>{day.weekday}</small>
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      {day.ground.booked} / {day.ground.historicalWeekdayAverage}
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      {ratio(day.ground.bookedPerActiveUnit)}
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      <PlanningSignal value={day.ground.planningSignal} />
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      {day.air.booked} / {day.air.historicalWeekdayAverage}
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      {ratio(day.air.bookedPerActiveUnit)}
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      <PlanningSignal value={day.air.planningSignal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ ...card, overflowX: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Provider performance evidence</h3>
            <p>
              Sorted by request volume only. This table is not a quality ranking
              or autonomous dispatch score.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
              <thead>
                <tr>
                  <th align="left">Provider</th>
                  <th align="left">Current readiness</th>
                  <th align="right">Requests</th>
                  <th align="right">Completion</th>
                  <th align="right">On-time departures</th>
                  <th align="right">Transport p50</th>
                  <th align="right">Incidents</th>
                  <th align="right">Escalations</th>
                  <th align="right">Active jobs / units</th>
                </tr>
              </thead>
              <tbody>
                {data.providerPerformance.map((row) => (
                  <tr
                    key={row.providerId}
                    style={{ borderTop: "1px solid #e2e8f0" }}
                  >
                    <td style={{ padding: "9px 7px" }}>
                      <strong>{row.displayName}</strong>
                      <br />
                      <small>{row.mode}</small>
                    </td>
                    <td style={{ padding: "9px 7px" }}>
                      {row.dispatchReadyNow ? "DISPATCH READY" : "ATTENTION"}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {row.requests}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {percent(row.completionRatePercent)}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {percent(row.onTimeDepartureRatePercent)}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {minutes(row.transportDurationMinutes.p50)}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {row.incidents}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {row.escalations}
                    </td>
                    <td align="right" style={{ padding: "9px 7px" }}>
                      {row.activeJobs} / {row.activeUnitCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ ...card, overflowX: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Recent daily demand</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="right">Ground</th>
                  <th align="right">Air</th>
                  <th align="right">Completed</th>
                  <th align="right">Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {recentDaily.map((row) => (
                  <tr key={row.date} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "8px 6px" }}>{row.date}</td>
                    <td align="right" style={{ padding: "8px 6px" }}>{row.ground}</td>
                    <td align="right" style={{ padding: "8px 6px" }}>{row.air}</td>
                    <td align="right" style={{ padding: "8px 6px" }}>{row.completed}</td>
                    <td align="right" style={{ padding: "8px 6px" }}>{row.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : loading ? (
        <p>Loading transport performance analytics…</p>
      ) : null}
    </section>
  );
}

function SlaCard({
  title,
  compliance,
  evaluated,
  passed,
  breached,
  pending,
  distribution,
  threshold,
}: {
  title: string;
  compliance: number | null;
  evaluated: number;
  passed: number;
  breached: number;
  pending?: number;
  distribution: Distribution;
  threshold: string;
}) {
  return (
    <section style={card}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <Definition label="Compliance" value={percent(compliance)} />
      <Definition label="Evaluated" value={evaluated} />
      <Definition label="Within target" value={passed} />
      <Definition label="Breached" value={breached} />
      {pending != null ? <Definition label="Pending in window" value={pending} /> : null}
      <Definition label="Threshold" value={threshold} />
      <Definition label="p50" value={minutes(distribution.p50)} />
      <Definition label="p90" value={minutes(distribution.p90)} />
    </section>
  );
}

function CapacityCard({
  title,
  value,
}: {
  title: string;
  value: ModeCapacity;
}) {
  return (
    <section style={card}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <Definition label="Active units" value={value.activeUnits} />
      <Definition label="Dispatch-ready providers" value={value.dispatchReadyProviders} />
      <Definition label="Active jobs" value={value.activeJobs} />
      <Definition label="Upcoming 24h" value={value.upcoming24h} />
      <Definition label="Upcoming 72h" value={value.upcoming72h} />
      <Definition label="Upcoming 7d" value={value.upcoming7d} />
      <Definition
        label="24h requests / active unit"
        value={ratio(value.upcoming24hPerActiveUnit)}
      />
      <Definition
        label="72h requests / active unit"
        value={ratio(value.upcoming72hPerActiveUnit)}
      />
      <p style={{ marginBottom: 0, fontSize: 12, color: "#64748b" }}>
        {value.note}
      </p>
    </section>
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

function PlanningSignal({ value }: { value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        border: "1px solid #cbd5e1",
        borderRadius: 999,
        padding: "4px 8px",
        fontSize: 10,
        fontWeight: 800,
        background:
          value === "NO_ACTIVE_UNITS"
            ? "#fef2f2"
            : value === "BOOKED_ABOVE_HISTORICAL_WEEKDAY_AVERAGE"
              ? "#fff7ed"
              : "#f8fafc",
      }}
    >
      {value}
    </span>
  );
}

function percent(value: number | null) {
  return value == null ? "—" : value + "%";
}

function minutes(value: number | null) {
  return value == null ? "—" : value + " min";
}

function ratio(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}
