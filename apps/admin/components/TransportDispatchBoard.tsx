"use client";

import { useEffect, useMemo, useState } from "react";

type DispatchProvider = {
  id: string;
  displayName: string;
  mode: "GROUND" | "AIR";
  family: string | null;
  dispatchReady: boolean;
  activeJobs: number;
  activeUnitCount: number;
  missingCredentialTypes: string[];
};

type DispatchItem = {
  id: string;
  mode: "GROUND" | "AIR";
  status: string;
  assistance: string;
  equipment: string[];
  companionCount: number;
  scheduledFor: string;
  pickup: { address?: string | null; latitude?: number | null; longitude?: number | null };
  destination: { address?: string | null; latitude?: number | null; longitude?: number | null };
  patient?: { id: string; firstName?: string | null; lastName?: string | null; phone?: string | null } | null;
  assignedProvider?: { id: string; displayName: string; status: string } | null;
  resources?: {
    revision: number;
    crewProviderIds: string[];
    unit?: { id: string; code: string; registrationCode: string; active: boolean } | null;
  } | null;
  assignmentState: "UNASSIGNED" | "PROVIDER_ASSIGNED" | "RESOURCES_PARTIAL" | "RESOURCES_READY";
  etaMinutes?: number | null;
  etaState: "CURRENT" | "MISSING" | "STALE_AFTER_DESTINATION_CHANGE" | "NOT_APPLICABLE";
  canRecalculateEta: boolean;
};

type DispatchPayload = {
  generatedAt: string;
  route: { provider: string; available: boolean };
  summary: { total: number; unassigned: number; resourceReady: number; etaAttention: number };
  providers: DispatchProvider[];
  items: DispatchItem[];
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportDispatchBoard() {
  const [data, setData] = useState<DispatchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [providerChoice, setProviderChoice] = useState<Record<string, string>>({});

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
      window.location.assign("/login?next=" + encodeURIComponent(window.location.pathname));
      throw new Error("Authentication required.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof payload?.message === "string"
          ? payload.message
          : "Transport dispatch request failed.",
      );
    }
    return payload;
  }

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const payload = (await request("/api/admin/transport/dispatch-board")) as DispatchPayload;
      setData(payload);
      setProviderChoice((current) => {
        const next = { ...current };
        for (const item of payload.items ?? []) {
          if (item.assignedProvider?.id) next[item.id] = item.assignedProvider.id;
          else if (!next[item.id]) {
            const candidate = (payload.providers ?? []).find(
              (provider) => provider.mode === item.mode && provider.dispatchReady,
            );
            if (candidate) next[item.id] = candidate.id;
          }
        }
        return next;
      });
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = data?.summary ?? {
    total: 0,
    unassigned: 0,
    resourceReady: 0,
    etaAttention: 0,
  };

  const readyProvidersByMode = useMemo(() => {
    const providers = data?.providers ?? [];
    return {
      GROUND: providers.filter((row) => row.mode === "GROUND" && row.dispatchReady),
      AIR: providers.filter((row) => row.mode === "AIR" && row.dispatchReady),
    };
  }, [data]);

  async function assign(item: DispatchItem) {
    const providerId = providerChoice[item.id];
    if (!providerId) return;
    setWorking("assign:" + item.id);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/dispatch/medical/" +
          encodeURIComponent(item.id) +
          "/assign",
        {
          method: "POST",
          body: JSON.stringify({
            providerId,
            ...(item.etaMinutes != null ? { etaMinutes: item.etaMinutes } : {}),
          }),
        },
      );
      setMessage("Transport provider assigned.");
      await load();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function recalculateEta(item: DispatchItem) {
    setWorking("eta:" + item.id);
    setMessage("");
    try {
      const idempotencyKey =
        "dispatch-eta-" +
        item.id +
        "-" +
        (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36));
      const result = await request(
        "/api/admin/transport/dispatch-board/" +
          encodeURIComponent(item.id) +
          "/recalculate-eta",
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey }),
        },
      );
      if (result?.persisted === true) {
        setMessage("ETA recalculated and stored as an auditable route revision.");
      } else {
        setMessage(
          result?.preview?.reason === "NOT_CONFIGURED"
            ? "Route provider is not configured. Dispatch remains available without automatic ETA."
            : "Automatic ETA is currently unavailable. Dispatch remains available.",
        );
      }
      await load();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section style={{ ...card, border: "2px solid #cbd5e1" }}>
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
            <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
              PHASE 6 · DISPATCH CONTROL
            </span>
            <h2 style={{ margin: "5px 0" }}>Medical Transport Dispatch Board</h2>
            <p>
              Assign dispatch-ready providers, verify crew/unit readiness and
              recalculate route ETA after operational or destination changes.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => void load()}
            disabled={loading || Boolean(working)}
          >
            Refresh board
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
            gap: 10,
          }}
        >
          <Metric label="Active requests" value={summary.total} />
          <Metric label="Unassigned" value={summary.unassigned} />
          <Metric label="Resources ready" value={summary.resourceReady} />
          <Metric label="ETA attention" value={summary.etaAttention} />
        </div>

        <p style={{ marginBottom: 0 }}>
          Route provider: <strong>{data?.route?.provider ?? "none"}</strong> ·{" "}
          automatic ETA: <strong>{data?.route?.available ? "AVAILABLE" : "OPTIONAL / OFF"}</strong>
        </p>
        {message && <p style={{ marginBottom: 0 }}>{message}</p>}
      </section>

      {loading ? (
        <p>Loading dispatch board…</p>
      ) : (
        <section style={{ ...card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
            <thead>
              <tr>
                <th align="left">Patient / schedule</th>
                <th align="left">Route</th>
                <th align="left">Mode / status</th>
                <th align="left">Provider assignment</th>
                <th align="left">Crew & unit</th>
                <th align="left">ETA</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((item) => {
                const candidates =
                  item.mode === "AIR" ? readyProvidersByMode.AIR : readyProvidersByMode.GROUND;
                const patientName = [
                  item.patient?.firstName,
                  item.patient?.lastName,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "12px 8px", verticalAlign: "top" }}>
                      <strong>{patientName || "Patient"}</strong>
                      <br />
                      <small>{formatDate(item.scheduledFor)}</small>
                      {item.patient?.phone ? (
                        <>
                          <br />
                          <small>{item.patient.phone}</small>
                        </>
                      ) : null}
                    </td>
                    <td style={{ padding: "12px 8px", verticalAlign: "top", maxWidth: 260 }}>
                      <small><strong>From:</strong> {locationText(item.pickup)}</small>
                      <br />
                      <small><strong>To:</strong> {locationText(item.destination)}</small>
                    </td>
                    <td style={{ padding: "12px 8px", verticalAlign: "top" }}>
                      <strong>{item.mode}</strong>
                      <br />
                      <Status
                        ok={item.status !== "REQUESTED"}
                        label={item.status}
                      />
                    </td>
                    <td style={{ padding: "12px 8px", verticalAlign: "top", minWidth: 220 }}>
                      {item.assignedProvider ? (
                        <>
                          <strong>{item.assignedProvider.displayName}</strong>
                          <br />
                          <small>{item.assignmentState}</small>
                        </>
                      ) : (
                        <>
                          <select
                            value={providerChoice[item.id] ?? ""}
                            onChange={(event) =>
                              setProviderChoice((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                            disabled={working === "assign:" + item.id}
                            style={{ width: "100%", minHeight: 38 }}
                          >
                            <option value="">Select provider</option>
                            {candidates.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.displayName} · {provider.activeJobs} active
                              </option>
                            ))}
                          </select>
                          {candidates.length === 0 ? (
                            <small>No dispatch-ready provider for this mode.</small>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td style={{ padding: "12px 8px", verticalAlign: "top" }}>
                      <Status
                        ok={item.assignmentState === "RESOURCES_READY"}
                        label={item.assignmentState}
                      />
                      {item.resources?.unit ? (
                        <>
                          <br />
                          <small>
                            {item.resources.unit.code} · {item.resources.unit.registrationCode}
                          </small>
                        </>
                      ) : null}
                      {item.resources ? (
                        <>
                          <br />
                          <small>
                            crew {item.resources.crewProviderIds.length} · rev {item.resources.revision}
                          </small>
                        </>
                      ) : null}
                    </td>
                    <td style={{ padding: "12px 8px", verticalAlign: "top" }}>
                      <strong>{item.etaMinutes != null ? item.etaMinutes + " min" : "—"}</strong>
                      <br />
                      <Status ok={item.etaState === "CURRENT"} label={item.etaState} />
                    </td>
                    <td style={{ padding: "12px 8px", verticalAlign: "top" }}>
                      {!item.assignedProvider ? (
                        <button
                          className="primary-button"
                          disabled={
                            !providerChoice[item.id] ||
                            working === "assign:" + item.id
                          }
                          onClick={() => void assign(item)}
                        >
                          Assign
                        </button>
                      ) : null}
                      {item.canRecalculateEta ? (
                        <button
                          className="secondary-button"
                          style={{ marginTop: item.assignedProvider ? 0 : 8 }}
                          disabled={
                            !data?.route?.available ||
                            working === "eta:" + item.id
                          }
                          onClick={() => void recalculateEta(item)}
                        >
                          Recalculate ETA
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(data?.items ?? []).length === 0 ? <p>No active scheduled transport requests.</p> : null}
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

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        border: "1px solid #cbd5e1",
        padding: "4px 8px",
        fontSize: 10,
        fontWeight: 800,
        background: ok ? "#ecfdf5" : "#fff7ed",
      }}
    >
      {label}
    </span>
  );
}

function locationText(location: DispatchItem["pickup"]) {
  if (location.address) return location.address;
  if (location.latitude != null && location.longitude != null) {
    return location.latitude + ", " + location.longitude;
  }
  return "Not available";
}

function formatDate(raw: string) {
  const value = new Date(raw);
  return Number.isFinite(value.getTime()) ? value.toLocaleString() : raw;
}
