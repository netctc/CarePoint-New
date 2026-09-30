"use client";

import { useEffect, useState } from "react";

type Run = {
  id: string;
  scheduleId: string;
  schedule: {
    id: string;
    name: string;
    cadence: string;
    windowDays: number;
    mode: string;
    sla: string;
    providerId: string | null;
    enabled: boolean;
  } | null;
  scheduledFor: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  attemptCount: number;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  reportFilename: string | null;
  rowCount: number | null;
  truncatedSource: boolean;
  snapshotHash: string | null;
  artifactObjectKey: string | null;
  artifactSha256: string | null;
  artifactBytes: number | null;
  artifactContentType: string | null;
  artifactStorageProvider: string | null;
  artifactStoredAt: string | null;
  deliveryStatus: string;
  deliveryHandoffPreparedAt: string | null;
  automaticDeliveryAvailable: false;
  reportDeliveryPerformed: false;
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportReportExecutionPanel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [status, setStatus] = useState("ALL");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function request(path: string, init?: RequestInit) {
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
          : "Transport report execution request failed.",
      );
    }
    return body;
  }

  async function load() {
    setBusy("load");
    setMessage("");
    try {
      const body = await request(
        "/api/admin/transport/report-runs?status=" +
          encodeURIComponent(status) +
          "&limit=100",
      );
      setRuns(Array.isArray(body?.items) ? body.items : []);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function action(name: string, path: string) {
    setBusy(name);
    setMessage("");
    try {
      const body = await request(path, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (name === "queue") {
        setMessage(
          "Due schedules processed: " +
            String(body?.dueSchedules ?? 0) +
            "; queued: " +
            String(body?.queued ?? 0) +
            ".",
        );
      } else if (name === "recover") {
        setMessage(
          "Recovered stale runs: " +
            String(body?.recovered ?? 0) +
            "; exhausted: " +
            String(body?.exhausted ?? 0) +
            ".",
        );
      } else {
        setMessage("Transport report execution ledger updated.");
      }
      await load();
    } catch (error) {
      setMessage(String(error));
      setBusy("");
    }
  }

  return (
    <section style={{ ...card, marginTop: 24, border: "2px solid #0f766e" }}>
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
          <span style={{ fontSize: 12, fontWeight: 900, color: "#0f766e" }}>
            PHASE 16 · SECURE REPORT ARTIFACT + DELIVERY HANDOFF
          </span>
          <h2 style={{ margin: "5px 0" }}>Scheduled Report Execution</h2>
          <p style={{ maxWidth: 960, marginBottom: 0 }}>
            Durable report runs now persist a sanitized CSV artifact in private
            object storage. Delivery remains external: this panel can prepare an
            auditable handoff descriptor but does not create public links or claim
            that delivery occurred.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() => void action("queue", "/api/admin/transport/report-runs/queue-due")}
          >
            Queue due
          </button>
          <button
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() =>
              void action("recover", "/api/admin/transport/report-runs/recover-stale")
            }
          >
            Recover stale
          </button>
          <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <label>
          Status{" "}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">All</option>
            <option value="QUEUED">Queued</option>
            <option value="RUNNING">Running</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
        <span style={{ fontSize: 12 }}>
          Lease: 5 min · Retry limit: 5 · Delivery: external
        </span>
      </div>

      {message ? <p>{message}</p> : null}

      <div style={{ overflowX: "auto", marginTop: 14 }}>
        <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Schedule</th>
              <th align="left">Due</th>
              <th align="left">Status</th>
              <th align="right">Attempts</th>
              <th align="right">Rows</th>
              <th align="left">Artifact</th>
              <th align="left">Delivery</th>
              <th align="left">Action</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "9px 6px" }}>
                  <strong>{run.schedule?.name ?? run.scheduleId}</strong>
                  <div style={{ fontSize: 12 }}>
                    {run.schedule
                      ? run.schedule.windowDays +
                        "d · " +
                        run.schedule.mode +
                        " · " +
                        run.schedule.sla
                      : "Schedule metadata unavailable"}
                  </div>
                </td>
                <td>{new Date(run.scheduledFor).toLocaleString()}</td>
                <td>
                  <strong>{run.status}</strong>
                  {run.lastError ? (
                    <div style={{ fontSize: 12, maxWidth: 320 }}>{run.lastError}</div>
                  ) : null}
                </td>
                <td align="right">{run.attemptCount}</td>
                <td align="right">{run.rowCount ?? "—"}</td>
                <td style={{ fontSize: 12 }}>
                  {run.artifactSha256 ? (
                    <>
                      <div>{run.artifactStorageProvider ?? "PRIVATE_STORAGE"}</div>
                      <div>{run.artifactSha256.slice(0, 16) + "…"}</div>
                      <div>{run.artifactBytes == null ? "—" : String(run.artifactBytes) + " bytes"}</div>
                    </>
                  ) : run.snapshotHash ? (
                    run.snapshotHash.slice(0, 16) + "…"
                  ) : (
                    "—"
                  )}
                  {run.truncatedSource ? <div>source capped</div> : null}
                </td>
                <td style={{ fontSize: 12 }}>
                  <strong>{run.deliveryStatus}</strong>
                  {run.deliveryHandoffPreparedAt ? (
                    <div>{new Date(run.deliveryHandoffPreparedAt).toLocaleString()}</div>
                  ) : null}
                </td>
                <td>
                  {run.status === "QUEUED" ? (
                    <button
                      className="secondary-button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void action(
                          "execute-" + run.id,
                          "/api/admin/transport/report-runs/" +
                            encodeURIComponent(run.id) +
                            "/execute",
                        )
                      }
                    >
                      Execute
                    </button>
                  ) : run.status === "FAILED" && run.attemptCount < 5 ? (
                    <button
                      className="secondary-button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void action(
                          "retry-" + run.id,
                          "/api/admin/transport/report-runs/" +
                            encodeURIComponent(run.id) +
                            "/retry",
                        )
                      }
                    >
                      Requeue
                    </button>
                  ) : run.status === "SUCCEEDED" &&
                    run.artifactSha256 &&
                    !run.deliveryHandoffPreparedAt ? (
                    <button
                      className="secondary-button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void action(
                          "handoff-" + run.id,
                          "/api/admin/transport/report-runs/" +
                            encodeURIComponent(run.id) +
                            "/prepare-delivery-handoff",
                        )
                      }
                    >
                      Prepare handoff
                    </button>
                  ) : run.reportFilename ? (
                    <span style={{ fontSize: 12 }}>{run.reportFilename}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {!runs.length ? (
              <tr>
                <td colSpan={7} style={{ padding: 16 }}>
                  {busy === "load" ? "Loading report runs…" : "No report runs match this filter."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
