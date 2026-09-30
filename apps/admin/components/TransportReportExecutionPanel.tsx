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
  artifactDeletedAt: string | null;
  artifactIntegrityStatus: string;
  artifactIntegrityLastCheckedAt: string | null;
  artifactIntegrityFailureAt: string | null;
  artifactIntegrityFailureCode: string | null;
  artifactLegalHold: boolean;
  artifactLegalHoldReason: string | null;
  artifactLegalHoldSetAt: string | null;
  artifactLegalHoldSetByAccountId: string | null;
  artifactPurgeClaimedAt: string | null;
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

  async function action(
    name: string,
    path: string,
    payload: unknown = {},
  ) {
    setBusy(name);
    setMessage("");
    try {
      const body = await request(path, {
        method: "POST",
        body: JSON.stringify(payload),
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

  async function changeLegalHold(run: Run, enabled: boolean) {
    if (enabled) {
      const reason = window.prompt(
        "Enter the legal/retention hold reason (3-500 printable characters):",
      );
      if (!reason?.trim()) return;
      await action(
        "legal-hold-" + run.id,
        "/api/admin/transport/report-runs/" +
          encodeURIComponent(run.id) +
          "/legal-hold",
        { reason: reason.trim() },
      );
      return;
    }
    await action(
      "legal-hold-clear-" + run.id,
      "/api/admin/transport/report-runs/" +
        encodeURIComponent(run.id) +
        "/legal-hold/clear",
    );
  }

  async function secureDownload(run: Run) {
    setBusy("download-" + run.id);
    setMessage("");
    try {
      const grant = await request(
        "/api/admin/transport/report-runs/" +
          encodeURIComponent(run.id) +
          "/download-grant",
        { method: "POST", body: JSON.stringify({}) },
      );
      if (typeof grant?.grantToken !== "string") {
        throw new Error("Secure download grant was not issued.");
      }

      const response = await fetch(
        "/api/admin/transport/report-runs/" +
          encodeURIComponent(run.id) +
          "/download",
        {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ grantToken: grant.grantToken }),
        },
      );
      if (response.status === 401) {
        window.location.assign(
          "/login?next=" + encodeURIComponent(window.location.pathname),
        );
        throw new Error("Authentication required.");
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.message === "string"
            ? body.message
            : "Secure report download failed.",
        );
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download =
          run.reportFilename || "carepoint-transport-management-report.csv";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      setMessage(
        "Secure one-time download completed. No public or signed artifact URL was issued.",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
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
            PHASE 22 · LEGAL HOLD + PURGE GOVERNANCE
          </span>
          <h2 style={{ margin: "5px 0" }}>Scheduled Report Execution</h2>
          <p style={{ maxWidth: 960, marginBottom: 0 }}>
            Successful report artifacts remain private. An authenticated ADMIN can
            request a five-minute one-time download grant and retrieve the CSV by
            same-origin POST after server-side SHA-256 integrity verification.
            No public or signed artifact URL is created.
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
                  {run.artifactDeletedAt ? (
                    <>
                      <strong>PURGED</strong>
                      <div>{new Date(run.artifactDeletedAt).toLocaleString()}</div>
                      <div>{run.artifactSha256?.slice(0, 16) ?? "hash retained"}…</div>
                    </>
                  ) : run.artifactSha256 ? (
                    <>
                      <div>{run.artifactStorageProvider ?? "PRIVATE_STORAGE"}</div>
                      <div>
                        Integrity: <strong>{run.artifactIntegrityStatus}</strong>
                      </div>
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
                  {run.artifactLegalHold ? (
                    <div style={{ marginTop: 4 }}>
                      <strong>LEGAL HOLD</strong>
                      {run.artifactLegalHoldReason ? (
                        <div>{run.artifactLegalHoldReason}</div>
                      ) : null}
                    </div>
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
                    !run.artifactDeletedAt ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {!run.deliveryHandoffPreparedAt ? (
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
                      ) : null}
                      <button
                        className="secondary-button"
                        disabled={Boolean(busy)}
                        onClick={() => void secureDownload(run)}
                      >
                        Secure download
                      </button>
                      <button
                        className="secondary-button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void changeLegalHold(run, !run.artifactLegalHold)
                        }
                      >
                        {run.artifactLegalHold ? "Clear hold" : "Set legal hold"}
                      </button>
                    </div>
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
                <td colSpan={8} style={{ padding: 16 }}>
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
