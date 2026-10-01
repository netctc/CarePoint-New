"use client";

import { useEffect, useState } from "react";

type Schedule = {
  id: string;
  name: string;
  enabled: boolean;
};

type Destination = {
  id: string;
  scheduleId: string;
  label: string;
  recipientAccountId: string;
  channel: "EMAIL";
  active: boolean;
  schedule: { id: string; name: string; cadence: string; enabled: boolean };
};

type InboxItem = {
  id: string;
  status: string;
  sentAt: string | null;
  downloadedAt: string | null;
  downloadedByAccountId: string | null;
  artifactAvailable: boolean;
  destination: {
    id: string;
    label: string;
    channel: string;
    scheduleId: string;
  };
  run: {
    id: string;
    scheduleId: string;
    scheduledFor: string;
    reportFilename: string | null;
    rowCount: number | null;
    artifactSha256: string | null;
    artifactBytes: number | null;
    artifactStoredAt: string | null;
  };
};

type Delivery = {
  id: string;
  status: string;
  attemptCount: number;
  createdAt: string;
  destination: {
    id: string;
    label: string;
    recipientAccountId: string;
    channel: string;
    active: boolean;
    scheduleId: string;
  };
  run: {
    id: string;
    scheduleId: string;
    scheduledFor: string;
    reportFilename: string | null;
    artifactSha256: string | null;
    artifactStorageProvider: string | null;
    deliveryStatus: string;
  };
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportReportDeliveryPanel() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [scheduleId, setScheduleId] = useState("");
  const [label, setLabel] = useState("Transport Management");
  const [recipientAccountId, setRecipientAccountId] = useState("");
  const [busy, setBusy] = useState(false);
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
          : "Transport report delivery request failed.",
      );
    }
    return body;
  }

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const [scheduleBody, destinationBody, deliveryBody, inboxBody] =
        await Promise.all([
          request("/api/admin/transport/report-schedules"),
          request("/api/admin/transport/report-destinations"),
          request("/api/admin/transport/report-deliveries"),
          request("/api/admin/transport/report-inbox"),
        ]);
      const scheduleItems = Array.isArray(scheduleBody?.items)
        ? scheduleBody.items
        : [];
      setSchedules(scheduleItems);
      setDestinations(
        Array.isArray(destinationBody?.items) ? destinationBody.items : [],
      );
      setDeliveries(
        Array.isArray(deliveryBody?.items) ? deliveryBody.items : [],
      );
      setInbox(Array.isArray(inboxBody?.items) ? inboxBody.items : []);
      if (!scheduleId && scheduleItems[0]?.id) {
        setScheduleId(scheduleItems[0].id);
      }
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

  async function addDestination() {
    setBusy(true);
    setMessage("");
    try {
      await request("/api/admin/transport/report-destinations", {
        method: "POST",
        body: JSON.stringify({
          scheduleId,
          label,
          recipientAccountId,
          channel: "EMAIL",
        }),
      });
      setMessage(
        "Destination saved. Delivery remains queued for an external secure-delivery adapter.",
      );
      setRecipientAccountId("");
      await load();
    } catch (error) {
      setMessage(String(error));
      setBusy(false);
    }
  }

  async function deactivate(destinationId: string) {
    setBusy(true);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/report-destinations/" +
          encodeURIComponent(destinationId) +
          "/deactivate",
        { method: "POST", body: JSON.stringify({}) },
      );
      await load();
    } catch (error) {
      setMessage(String(error));
      setBusy(false);
    }
  }

  async function secureInboxDownload(item: InboxItem) {
    setBusy(true);
    setMessage("");
    try {
      const grant = await request(
        "/api/admin/transport/report-runs/" +
          encodeURIComponent(item.run.id) +
          "/download-grant",
        { method: "POST", body: JSON.stringify({}) },
      );
      if (typeof grant?.grantToken !== "string") {
        throw new Error("Secure download grant was not issued.");
      }

      const response = await fetch(
        "/api/admin/transport/report-runs/" +
          encodeURIComponent(item.run.id) +
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
          item.run.reportFilename || "carepoint-transport-management-report.csv";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      await load();
      setMessage(
        "Secure report downloaded and the recipient download receipt was recorded.",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ ...card, marginTop: 24, border: "2px solid #0369a1" }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: "#0369a1" }}>
        PHASE 20 · RECIPIENT REPORT INBOX + DOWNLOAD RECEIPTS
      </span>
      <h2 style={{ margin: "5px 0" }}>Report Inbox & Delivery Operations</h2>
      <p>
        Configure active ADMIN accounts as report destinations. The Cloud Run
        worker sends a PHI-neutral "report ready" EMAIL notification through the
        existing Notification Gateway. Each recipient also gets a private
        "My Report Inbox"; successful secure downloads record a durable receipt.
        The private CSV artifact itself is not sent to the notification provider.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
          gap: 10,
        }}
      >
        <label>
          Schedule
          <select
            value={scheduleId}
            onChange={(event) => setScheduleId(event.target.value)}
          >
            {schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.name} {schedule.enabled ? "" : "(disabled)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Destination label
          <input
            value={label}
            maxLength={120}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label>
          Recipient ADMIN account ID
          <input
            value={recipientAccountId}
            maxLength={180}
            onChange={(event) => setRecipientAccountId(event.target.value)}
          />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button
            className="secondary-button"
            disabled={
              busy ||
              !scheduleId ||
              !label.trim() ||
              !recipientAccountId.trim()
            }
            onClick={() => void addDestination()}
          >
            Add destination
          </button>
        </div>
      </div>

      {message ? <p>{message}</p> : null}


      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <h3>My Report Inbox</h3>
        <p style={{ fontSize: 13 }}>
          Only report-ready deliveries addressed to the currently authenticated
          ADMIN account are shown. Object-storage keys are never exposed here.
        </p>
        <table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Notified</th>
              <th align="left">Report</th>
              <th align="right">Rows</th>
              <th align="left">Receipt</th>
              <th align="left">Action</th>
            </tr>
          </thead>
          <tbody>
            {inbox.map((item) => (
              <tr key={item.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "8px 6px" }}>
                  {item.sentAt ? new Date(item.sentAt).toLocaleString() : "—"}
                </td>
                <td>
                  {item.run.reportFilename ?? item.run.id}
                  <div style={{ fontSize: 12 }}>{item.destination.label}</div>
                </td>
                <td align="right">{item.run.rowCount ?? "—"}</td>
                <td style={{ fontSize: 12 }}>
                  {item.downloadedAt ? (
                    <>
                      <strong>DOWNLOADED</strong>
                      <div>{new Date(item.downloadedAt).toLocaleString()}</div>
                    </>
                  ) : (
                    "NOT YET DOWNLOADED"
                  )}
                </td>
                <td>
                  <button
                    className="secondary-button"
                    disabled={busy || !item.artifactAvailable}
                    onClick={() => void secureInboxDownload(item)}
                  >
                    Secure download
                  </button>
                </td>
              </tr>
            ))}
            {!inbox.length ? (
              <tr>
                <td colSpan={5} style={{ padding: 12 }}>
                  No report-ready deliveries are addressed to your ADMIN account.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <h3>Configured destinations</h3>
        <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Schedule</th>
              <th align="left">Label</th>
              <th align="left">Recipient account</th>
              <th align="left">Channel</th>
              <th align="left">State</th>
              <th align="left">Action</th>
            </tr>
          </thead>
          <tbody>
            {destinations.map((destination) => (
              <tr
                key={destination.id}
                style={{ borderTop: "1px solid #e2e8f0" }}
              >
                <td style={{ padding: "8px 6px" }}>
                  {destination.schedule?.name ?? destination.scheduleId}
                </td>
                <td>{destination.label}</td>
                <td>{destination.recipientAccountId}</td>
                <td>{destination.channel}</td>
                <td>{destination.active ? "ACTIVE" : "INACTIVE"}</td>
                <td>
                  {destination.active ? (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void deactivate(destination.id)}
                    >
                      Deactivate
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {!destinations.length ? (
              <tr>
                <td colSpan={6} style={{ padding: 12 }}>
                  No report delivery destinations configured.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ overflowX: "auto", marginTop: 18 }}>
        <h3>Durable delivery outbox</h3>
        <p style={{ fontSize: 13 }}>
          Execution mode: <strong>REPORT_READY_NOTIFICATION_WORKER</strong>.
          SENT means the readiness notification was sent; it does not mean the
          private CSV artifact was delivered.
        </p>
        <table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Created</th>
              <th align="left">Report</th>
              <th align="left">Destination</th>
              <th align="left">Status</th>
              <th align="right">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "8px 6px" }}>
                  {new Date(delivery.createdAt).toLocaleString()}
                </td>
                <td>{delivery.run.reportFilename ?? delivery.run.id}</td>
                <td>
                  {delivery.destination.label}
                  <div style={{ fontSize: 12 }}>
                    {delivery.destination.recipientAccountId}
                  </div>
                </td>
                <td>{delivery.status}</td>
                <td align="right">{delivery.attemptCount}</td>
              </tr>
            ))}
            {!deliveries.length ? (
              <tr>
                <td colSpan={5} style={{ padding: 12 }}>
                  No delivery outbox items yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
