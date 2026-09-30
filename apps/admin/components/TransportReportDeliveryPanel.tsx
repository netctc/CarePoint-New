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
      const [scheduleBody, destinationBody, deliveryBody] = await Promise.all([
        request("/api/admin/transport/report-schedules"),
        request("/api/admin/transport/report-destinations"),
        request("/api/admin/transport/report-deliveries"),
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

  return (
    <section style={{ ...card, marginTop: 24, border: "2px solid #0369a1" }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: "#0369a1" }}>
        PHASE 17 · DELIVERY DESTINATIONS + DURABLE OUTBOX
      </span>
      <h2 style={{ margin: "5px 0" }}>Report Delivery Outbox</h2>
      <p>
        Configure active ADMIN accounts as report destinations. Preparing a
        Phase 16 handoff creates one durable, idempotent outbox item per active
        destination. No external provider send is performed in this phase.
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
          Execution mode: <strong>EXTERNAL_DELIVERY_ADAPTER_REQUIRED</strong>
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
