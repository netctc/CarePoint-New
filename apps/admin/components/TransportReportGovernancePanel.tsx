"use client";

import { useEffect, useState } from "react";

type Run = {
  id: string;
  scheduleId: string;
  schedule: { id: string; name: string } | null;
  scheduledFor: string;
  status: string;
  reportFilename: string | null;
};

type GovernancePayload = {
  generatedAt: string;
  run: {
    id: string;
    scheduleId: string;
    scheduleName: string;
    scheduledFor: string;
    status: string;
    attemptCount: number;
    reportGeneratedAt: string | null;
    reportFilename: string | null;
    rowCount: number | null;
    truncatedSource: boolean;
    deliveryStatus: string;
  };
  governance: {
    artifactState: "PURGED" | "LEGAL_HOLD" | "LIVE_PRIVATE" | "NOT_AVAILABLE";
    artifactSha256: string | null;
    artifactBytes: number | null;
    artifactContentType: string | null;
    artifactStorageProvider: string | null;
    artifactStoredAt: string | null;
    artifactDeletedAt: string | null;
    artifactRetentionDays: number;
    legalHold: boolean;
    legalHoldReason: string | null;
    legalHoldSetAt: string | null;
    legalHoldSetByAccountId: string | null;
    deliveryHandoffPreparedAt: string | null;
    deliveryHandoffPreparedByAccountId: string | null;
    notificationCount: number;
    downloadReceiptCount: number;
    firstDownloadedAt: string | null;
  };
  timeline: Array<{
    eventId: string;
    occurredAt: string;
    actorId: string | null;
    action: string;
    category: string;
    result: string;
    purpose: string | null;
    sequence: string | null;
    payloadHash: string | null;
    previousHash: string | null;
    eventHash: string | null;
    integrityEvidenceAvailable: boolean;
  }>;
  sensitiveDataPolicy: {
    rawAuditMetadataIncluded: false;
    objectStorageKeyIncluded: false;
    patientIdentityIncluded: false;
    patientContactIncluded: false;
    patientLocationIncluded: false;
    csvContentIncluded: false;
  };
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportReportGovernancePanel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [payload, setPayload] = useState<GovernancePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
          : "Transport report governance request failed.",
      );
    }
    return body;
  }

  async function loadRuns() {
    const body = await request("/api/admin/transport/report-runs?status=ALL&limit=50");
    const items = Array.isArray(body?.items) ? body.items : [];
    setRuns(items);
    const next = selectedRunId || items[0]?.id || "";
    if (next && next !== selectedRunId) setSelectedRunId(next);
    return next;
  }

  async function loadTimeline(runId: string) {
    if (!runId) {
      setPayload(null);
      return;
    }
    const body = (await request(
      "/api/admin/transport/report-runs/" +
        encodeURIComponent(runId) +
        "/governance-timeline",
    )) as GovernancePayload;
    setPayload(body);
  }

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const runId = await loadRuns();
      if (runId) await loadTimeline(runId);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectRun(runId: string) {
    setSelectedRunId(runId);
    setBusy(true);
    setMessage("");
    try {
      await loadTimeline(runId);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ ...card, marginTop: 24, border: "2px solid #334155" }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
        PHASE 23 · GOVERNANCE EVIDENCE + HOLD/PURGE TIMELINE
      </span>
      <h2 style={{ margin: "5px 0" }}>Report Governance Evidence</h2>
      <p>
        Read-only lifecycle evidence from the immutable audit chain. Raw audit
        metadata, private object keys, CSV content and patient data are not
        returned by this view.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ minWidth: 320 }}>
          Report run
          <select
            value={selectedRunId}
            onChange={(event) => void selectRun(event.target.value)}
          >
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.schedule?.name ?? run.scheduleId} ·{" "}
                {new Date(run.scheduledFor).toLocaleString()} · {run.status}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" disabled={busy} onClick={() => void load()}>
          {busy ? "Refreshing…" : "Refresh evidence"}
        </button>
      </div>

      {message ? <p>{message}</p> : null}

      {payload ? (
        <>
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 10,
            }}
          >
            <Evidence label="Artifact state" value={payload.governance.artifactState} />
            <Evidence label="Run status" value={payload.run.status} />
            <Evidence label="Delivery" value={payload.run.deliveryStatus} />
            <Evidence
              label="Retention"
              value={payload.governance.artifactRetentionDays + " days"}
            />
            <Evidence
              label="Notifications"
              value={payload.governance.notificationCount}
            />
            <Evidence
              label="Download receipts"
              value={payload.governance.downloadReceiptCount}
            />
          </div>

          <div style={{ marginTop: 14, fontSize: 13 }}>
            <strong>SHA-256 evidence:</strong>{" "}
            {payload.governance.artifactSha256 ?? "—"}
            {payload.governance.legalHold ? (
              <div>
                <strong>Legal hold:</strong>{" "}
                {payload.governance.legalHoldReason ?? "Active"}
              </div>
            ) : null}
            {payload.governance.artifactDeletedAt ? (
              <div>
                <strong>Purged:</strong>{" "}
                {new Date(payload.governance.artifactDeletedAt).toLocaleString()}
              </div>
            ) : null}
          </div>

          <div style={{ overflowX: "auto", marginTop: 18 }}>
            <h3>Immutable governance timeline</h3>
            <table style={{ width: "100%", minWidth: 1100, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Time</th>
                  <th align="left">Category</th>
                  <th align="left">Action</th>
                  <th align="left">Result</th>
                  <th align="left">Actor</th>
                  <th align="right">Sequence</th>
                  <th align="left">Event hash</th>
                </tr>
              </thead>
              <tbody>
                {payload.timeline.map((event) => (
                  <tr key={event.eventId} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "8px 6px" }}>
                      {new Date(event.occurredAt).toLocaleString()}
                    </td>
                    <td>{event.category}</td>
                    <td style={{ fontSize: 12 }}>{event.action}</td>
                    <td>{event.result}</td>
                    <td style={{ fontSize: 12 }}>{event.actorId ?? "system"}</td>
                    <td align="right">{event.sequence ?? "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {event.eventHash ? event.eventHash.slice(0, 24) + "…" : "—"}
                    </td>
                  </tr>
                ))}
                {!payload.timeline.length ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 12 }}>
                      No governance events have been recorded for this run yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Evidence({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
      <strong style={{ display: "block" }}>{String(value)}</strong>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
    </div>
  );
}
