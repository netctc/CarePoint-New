"use client";

import { useEffect, useMemo, useState } from "react";

type Severity = "CRITICAL" | "WARNING" | "INFO";
type PriorityBand = "CRITICAL" | "HIGH" | "MEDIUM" | "NORMAL";

type Escalation = {
  id: string;
  code: string;
  severity: Severity;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  recommendedAction: string;
  firstTriggeredAt: string;
  lastTriggeredAt: string;
  occurrenceCount: number;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  autoResolved: boolean;
  resolutionNote?: string | null;
};

type Signal = {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  since: string;
  recommendedAction: string;
  escalation?: Escalation | null;
};

type CandidateRecommendation = {
  providerId: string;
  displayName: string;
  score: number;
  activeJobs: number;
  activeUnitCount: number;
  basis: string[];
};

type SmartDispatchItem = {
  requestId: string;
  patientLabel: string;
  mode: "GROUND" | "AIR";
  status: string;
  scheduledFor: string;
  assignedProvider?: { id: string; displayName: string } | null;
  etaMinutes?: number | null;
  priorityScore: number;
  priorityBand: PriorityBand;
  scheduleUrgency: string;
  topRecommendedAction?: string | null;
  signals: Signal[];
  candidateRecommendations: CandidateRecommendation[];
  autoAssignmentPerformed: false;
  automaticLifecycleMutation: false;
};

type SmartDispatchPayload = {
  generatedAt: string;
  evaluationMode: "DETERMINISTIC_RULES";
  evaluationIntervalSeconds: number;
  autoAssignmentPerformed: false;
  automaticLifecycleMutation: false;
  providerRecommendationUsesLiveLocation: false;
  thresholds: {
    assignmentSlaMinutes: number;
    resourceReadySlaMinutes: number;
    etaRefreshSlaMinutes: number;
    departureGraceMinutes: number;
    telemetryStaleSeconds: number;
    telemetryCriticalSeconds: number;
    milestoneConfirmationMinutes: number;
    milestoneCriticalMinutes: number;
  };
  summary: {
    activeRequests: number;
    critical: number;
    high: number;
    unassigned: number;
    openEscalations: number;
  };
  evaluation?: {
    evaluatedAt: string;
    detectedEscalations: number;
    opened: number;
    reopened: number;
    updated: number;
    autoResolved: number;
  };
  items: SmartDispatchItem[];
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportSmartDispatchPanel() {
  const [data, setData] = useState<SmartDispatchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [band, setBand] = useState<"ALL" | PriorityBand>("ALL");

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
          : "Smart dispatch request failed.",
      );
    }
    return payload;
  }

  async function loadSnapshot({ silent = true }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    try {
      const payload = (await request(
        "/api/admin/transport/smart-dispatch",
      )) as SmartDispatchPayload;
      setData(payload);
      return payload;
    } catch (error) {
      if (!silent) setMessage(String(error));
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function evaluate({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    setMessage("");
    try {
      const payload = (await request(
        "/api/admin/transport/smart-dispatch/evaluate",
        { method: "POST", body: "{}" },
      )) as SmartDispatchPayload;
      setData(payload);
      return payload;
    } catch (error) {
      if (!silent) setMessage(String(error));
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const payload = await evaluate({ silent: !first });
      first = false;
      if (cancelled) return;
      const seconds = Math.max(
        15,
        Math.min(600, payload?.evaluationIntervalSeconds ?? 60),
      );
      timer = setTimeout(() => void tick(), seconds * 1000);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Intentionally one evaluation loop for the lifetime of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => {
    const rows = data?.items ?? [];
    return band === "ALL"
      ? rows
      : rows.filter((row) => row.priorityBand === band);
  }, [band, data]);

  async function acknowledge(item: SmartDispatchItem, signal: Signal) {
    setWorking("ack:" + item.requestId + ":" + signal.code);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/smart-dispatch/" +
          encodeURIComponent(item.requestId) +
          "/escalations/" +
          encodeURIComponent(signal.code) +
          "/acknowledge",
        { method: "POST", body: "{}" },
      );
      setMessage("Escalation acknowledged.");
      await loadSnapshot({ silent: true });
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function resolve(item: SmartDispatchItem, signal: Signal) {
    const note = window.prompt(
      "Resolution note (optional). If the condition still exists, the next smart-dispatch evaluation will reopen the escalation.",
      "",
    );
    if (note === null) return;
    setWorking("resolve:" + item.requestId + ":" + signal.code);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/smart-dispatch/" +
          encodeURIComponent(item.requestId) +
          "/escalations/" +
          encodeURIComponent(signal.code) +
          "/resolve",
        {
          method: "POST",
          body: JSON.stringify({ note }),
        },
      );
      setMessage("Escalation resolved. Persistent conditions may reopen on the next evaluation cycle.");
      await loadSnapshot({ silent: true });
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function assignRecommended(
    item: SmartDispatchItem,
    recommendation: CandidateRecommendation,
  ) {
    setWorking("assign:" + item.requestId);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/dispatch/medical/" +
          encodeURIComponent(item.requestId) +
          "/assign",
        {
          method: "POST",
          body: JSON.stringify({
            providerId: recommendation.providerId,
            ...(item.etaMinutes != null ? { etaMinutes: item.etaMinutes } : {}),
          }),
        },
      );
      setMessage(
        "Recommended provider assigned after explicit operator confirmation.",
      );
      await evaluate({ silent: true });
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  const summary = data?.summary ?? {
    activeRequests: 0,
    critical: 0,
    high: 0,
    unassigned: 0,
    openEscalations: 0,
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
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
            <span style={{ fontSize: 12, fontWeight: 900, color: "#6d28d9" }}>
              PHASE 10 · SMART DISPATCH & ESCALATION
            </span>
            <h2 style={{ margin: "5px 0" }}>
              Smart Dispatch Prioritization
            </h2>
            <p style={{ maxWidth: 940 }}>
              Deterministic prioritization across assignment SLA, crew/unit
              readiness, ETA freshness, incidents, foreground telemetry and
              detected trip milestones. Recommendations never auto-assign a
              provider and never mutate transport lifecycle status.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => void evaluate()}
            disabled={loading || Boolean(working)}
          >
            Evaluate now
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))",
            gap: 10,
          }}
        >
          <Metric label="Active requests" value={summary.activeRequests} />
          <Metric label="Critical" value={summary.critical} />
          <Metric label="High priority" value={summary.high} />
          <Metric label="Unassigned" value={summary.unassigned} />
          <Metric label="Open escalations" value={summary.openEscalations} />
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
            Priority{" "}
            <select
              value={band}
              onChange={(event) =>
                setBand(event.target.value as "ALL" | PriorityBand)
              }
            >
              <option value="ALL">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="NORMAL">Normal</option>
            </select>
          </label>
          <small>
            Evaluate every {data?.evaluationIntervalSeconds ?? "—"} sec ·
            telemetry stale {data?.thresholds.telemetryStaleSeconds ?? "—"} sec ·
            milestone confirm {data?.thresholds.milestoneConfirmationMinutes ?? "—"} min
          </small>
        </div>

        <p style={{ marginBottom: 0 }}>
          Engine: <strong>{data?.evaluationMode ?? "DETERMINISTIC_RULES"}</strong>
          {" · "}auto assignment:{" "}
          <strong>{data?.autoAssignmentPerformed ? "YES" : "NO"}</strong>
          {" · "}automatic lifecycle mutation:{" "}
          <strong>{data?.automaticLifecycleMutation ? "YES" : "NO"}</strong>
          {" · "}provider live-location ranking:{" "}
          <strong>{data?.providerRecommendationUsesLiveLocation ? "YES" : "NO"}</strong>
        </p>

        {data?.evaluation ? (
          <p style={{ marginBottom: 0, fontSize: 12, color: "#64748b" }}>
            Last evaluation {formatDate(data.evaluation.evaluatedAt)} · detected{" "}
            {data.evaluation.detectedEscalations} · opened {data.evaluation.opened}
            {" · "}reopened {data.evaluation.reopened}
            {" · "}auto-resolved {data.evaluation.autoResolved}
          </p>
        ) : null}
        {message ? <p style={{ marginBottom: 0 }}>{message}</p> : null}
      </section>

      {loading && !data ? (
        <p>Evaluating smart dispatch…</p>
      ) : items.length === 0 ? (
        <section style={card}>
          <strong>No active transport requests match this priority filter.</strong>
        </section>
      ) : (
        <section style={{ display: "grid", gap: 12 }}>
          {items.map((item) => {
            const topCandidate = item.candidateRecommendations[0];
            return (
              <article
                key={item.requestId}
                style={{
                  ...card,
                  border:
                    item.priorityBand === "CRITICAL"
                      ? "2px solid #dc2626"
                      : item.priorityBand === "HIGH"
                        ? "2px solid #f59e0b"
                        : "1px solid #dbe4ee",
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
                        {item.assignedProvider?.displayName ?? "UNASSIGNED"}
                        {" · "}ETA{" "}
                        {item.etaMinutes != null ? item.etaMinutes + " min" : "—"}
                        {" · "}urgency {item.scheduleUrgency}
                      </small>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <PriorityBadge band={item.priorityBand} />
                    <div style={{ marginTop: 5 }}>
                      <small>score {item.priorityScore}</small>
                    </div>
                  </div>
                </div>

                {topCandidate && !item.assignedProvider ? (
                  <section
                    style={{
                      marginTop: 12,
                      padding: 12,
                      border: "1px solid #ddd6fe",
                      borderRadius: 12,
                      background: "#faf5ff",
                    }}
                  >
                    <strong>Recommended provider: {topCandidate.displayName}</strong>
                    <div>
                      <small>
                        score {topCandidate.score} · active jobs{" "}
                        {topCandidate.activeJobs} · active units{" "}
                        {topCandidate.activeUnitCount}
                      </small>
                    </div>
                    <div>
                      <small>
                        Basis: {topCandidate.basis.join(" · ")}. No provider
                        live-location/proximity signal is used.
                      </small>
                    </div>
                    <button
                      className="primary-button"
                      style={{ marginTop: 10 }}
                      disabled={working === "assign:" + item.requestId}
                      onClick={() =>
                        void assignRecommended(item, topCandidate)
                      }
                    >
                      Assign recommended provider
                    </button>
                  </section>
                ) : null}

                {item.signals.length ? (
                  <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                    {item.signals.map((signal) => {
                      const escalation = signal.escalation;
                      const key = item.requestId + ":" + signal.code;
                      return (
                        <div
                          key={signal.code}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: 12,
                            display: "grid",
                            gridTemplateColumns:
                              "minmax(135px,180px) minmax(260px,1fr) auto",
                            gap: 12,
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <SeverityBadge severity={signal.severity} />
                            <div style={{ marginTop: 5 }}>
                              <small>{signal.code}</small>
                            </div>
                            {escalation ? (
                              <div style={{ marginTop: 5 }}>
                                <small>
                                  {escalation.status} · occurrences{" "}
                                  {escalation.occurrenceCount}
                                </small>
                              </div>
                            ) : null}
                          </div>
                          <div>
                            <strong>{signal.title}</strong>
                            <div>
                              <small>{signal.detail}</small>
                            </div>
                            <div>
                              <small>
                                Since {formatDate(signal.since)}
                                {" · "}action {signal.recommendedAction}
                              </small>
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              justifyContent: "flex-end",
                            }}
                          >
                            {escalation &&
                            escalation.status === "OPEN" ? (
                              <button
                                className="secondary-button"
                                disabled={working === "ack:" + key}
                                onClick={() =>
                                  void acknowledge(item, signal)
                                }
                              >
                                Acknowledge
                              </button>
                            ) : null}
                            {escalation &&
                            escalation.status !== "RESOLVED" ? (
                              <button
                                className="secondary-button"
                                disabled={working === "resolve:" + key}
                                onClick={() => void resolve(item, signal)}
                              >
                                Resolve
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ marginBottom: 0, marginTop: 12 }}>
                    No warning or critical smart-dispatch signals for this request.
                  </p>
                )}

                <p style={{ marginBottom: 0, fontSize: 12, color: "#64748b" }}>
                  Phase 10 recommendations are advisory. Assignment and lifecycle
                  changes require explicit operator/provider actions.
                </p>
              </article>
            );
          })}
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

function PriorityBadge({ band }: { band: PriorityBand }) {
  return (
    <span
      style={{
        display: "inline-flex",
        border: "1px solid #cbd5e1",
        borderRadius: 999,
        padding: "4px 8px",
        fontSize: 10,
        fontWeight: 900,
        background:
          band === "CRITICAL"
            ? "#fef2f2"
            : band === "HIGH"
              ? "#fff7ed"
              : band === "MEDIUM"
                ? "#fefce8"
                : "#f8fafc",
      }}
    >
      {band}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      style={{
        display: "inline-flex",
        border: "1px solid #cbd5e1",
        borderRadius: 999,
        padding: "4px 8px",
        fontSize: 10,
        fontWeight: 900,
        background:
          severity === "CRITICAL"
            ? "#fef2f2"
            : severity === "WARNING"
              ? "#fff7ed"
              : "#f8fafc",
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
