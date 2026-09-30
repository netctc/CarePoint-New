"use client";

import { useEffect, useMemo, useState } from "react";

type TransportUnit = {
  id: string;
  code: string;
  registrationCode: string;
  mode: "GROUND" | "AIR";
  capabilities: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type TransportProvider = {
  id: string;
  displayName: string;
  legalName?: string | null;
  status: string;
  account?: { email: string; status: string } | null;
  family: string | null;
  category?: { id: string; slug: string; labels: unknown; active: boolean } | null;
  requiredCredentialTypes: string[];
  missingCredentialTypes: string[];
  units: { total: number; active: number; expectedMode: "GROUND" | "AIR" };
  activeJobs: number;
  dispatchReady: boolean;
};

type TransportProviderDetail = TransportProvider & {
  units: TransportUnit[];
  recentAssignments: Array<{
    id: string;
    transportRequestId: string;
    transportUnitId?: string | null;
    crewProviderIds: string[];
    revision: number;
    assignedAt: string;
  }>;
};

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 16,
} as const;

export function TransportOperationsPanel() {
  const [providers, setProviders] = useState<TransportProvider[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<TransportProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [unit, setUnit] = useState({
    code: "",
    registrationCode: "",
    capabilities: "",
  });

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
          : "Transport administration request failed.",
      );
    }
    return payload;
  }

  async function loadProviders(preferredId?: string) {
    setLoading(true);
    setMessage("");
    try {
      const payload = await request("/api/admin/transport/providers");
      const rows: TransportProvider[] = Array.isArray(payload?.items)
        ? payload.items
        : [];
      setProviders(rows);
      const nextId =
        preferredId && rows.some((row) => row.id === preferredId)
          ? preferredId
          : selectedId && rows.some((row) => row.id === selectedId)
            ? selectedId
            : rows[0]?.id ?? "";
      setSelectedId(nextId);
      if (nextId) await loadDetail(nextId);
      else setDetail(null);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(providerId: string) {
    if (!providerId) {
      setDetail(null);
      return;
    }
    const payload = await request(
      "/api/admin/transport/providers/" + encodeURIComponent(providerId),
    );
    setDetail(payload as TransportProviderDetail);
  }

  useEffect(() => {
    void loadProviders();
  }, []);

  const metrics = useMemo(
    () => ({
      total: providers.length,
      ready: providers.filter((row) => row.dispatchReady).length,
      notReady: providers.filter((row) => !row.dispatchReady).length,
      activeJobs: providers.reduce((sum, row) => sum + row.activeJobs, 0),
    }),
    [providers],
  );

  async function selectProvider(providerId: string) {
    setSelectedId(providerId);
    setMessage("");
    setWorking("provider:" + providerId);
    try {
      await loadDetail(providerId);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function createUnit() {
    if (!detail) return;
    setWorking("create-unit");
    setMessage("");
    try {
      const capabilities = [
        ...new Set(
          unit.capabilities
            .split(",")
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean),
        ),
      ];
      await request(
        "/api/admin/transport/providers/" +
          encodeURIComponent(detail.id) +
          "/units",
        {
          method: "POST",
          body: JSON.stringify({
            code: unit.code,
            registrationCode: unit.registrationCode,
            mode: detail.units.expectedMode,
            capabilities,
            active: true,
          }),
        },
      );
      setUnit({ code: "", registrationCode: "", capabilities: "" });
      await loadProviders(detail.id);
      setMessage("Transport unit created.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function setUnitActive(row: TransportUnit, active: boolean) {
    if (!detail) return;
    setWorking("unit:" + row.id);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/providers/" +
          encodeURIComponent(detail.id) +
          "/units/" +
          encodeURIComponent(row.id),
        {
          method: "PATCH",
          body: JSON.stringify({ active }),
        },
      );
      await loadProviders(detail.id);
      setMessage(active ? "Transport unit activated." : "Transport unit deactivated.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section style={card}>
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
            <span
              style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}
            >
              PHASE 2 · TRANSPORT OPERATIONS
            </span>
            <h2 style={{ margin: "5px 0" }}>Transport Operations Readiness</h2>
            <p>
              Fleet readiness, active transport work and transport-provider
              operational eligibility.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => void loadProviders(selectedId)}
            disabled={loading || Boolean(working)}
          >
            Refresh
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
            gap: 10,
          }}
        >
          <Metric label="Transport providers" value={metrics.total} />
          <Metric label="Dispatch ready" value={metrics.ready} />
          <Metric label="Needs attention" value={metrics.notReady} />
          <Metric label="Active jobs" value={metrics.activeJobs} />
        </div>
        {message && <p style={{ marginBottom: 0 }}>{message}</p>}
      </section>

      {loading ? (
        <p>Loading transport operations…</p>
      ) : (
        <section style={{ ...card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Provider</th>
                <th align="left">Family</th>
                <th align="left">Readiness</th>
                <th align="left">Fleet</th>
                <th align="left">Active jobs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {providers.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "12px 8px" }}>
                    <strong>{row.displayName}</strong>
                    <br />
                    <small>{row.account?.email ?? "No linked account"}</small>
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <small>{row.family ?? "—"}</small>
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <Status
                      ok={row.dispatchReady}
                      label={row.dispatchReady ? "DISPATCH READY" : "ATTENTION"}
                    />
                    {!row.dispatchReady &&
                      row.missingCredentialTypes.length > 0 && (
                        <>
                          <br />
                          <small>
                            Missing: {row.missingCredentialTypes.join(", ")}
                          </small>
                        </>
                      )}
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    {row.units.active} active / {row.units.total} total
                    <br />
                    <small>{row.units.expectedMode}</small>
                  </td>
                  <td style={{ padding: "12px 8px" }}>{row.activeJobs}</td>
                  <td style={{ padding: "12px 8px" }}>
                    <button
                      className="secondary-button"
                      disabled={Boolean(working)}
                      onClick={() => void selectProvider(row.id)}
                    >
                      Manage fleet
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {providers.length === 0 && (
            <p>No transport providers are registered yet.</p>
          )}
        </section>
      )}

      {detail && (
        <section style={{ ...card, border: "2px solid #cbd5e1" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                {detail.family}
              </span>
              <h2 style={{ margin: "5px 0" }}>{detail.displayName}</h2>
              <p>
                Expected fleet mode: <strong>{detail.units.expectedMode}</strong>
              </p>
            </div>
            <Status
              ok={detail.dispatchReady}
              label={detail.dispatchReady ? "DISPATCH READY" : "NOT READY"}
            />
          </div>

          <h3>Fleet / Transport Units</h3>
          <div
            className="admin-form-grid"
            style={{ alignItems: "end", marginBottom: 16 }}
          >
            <label>
              Unit code
              <input
                value={unit.code}
                onChange={(event) =>
                  setUnit((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                placeholder="AMB-001"
              />
            </label>
            <label>
              Registration code
              <input
                value={unit.registrationCode}
                onChange={(event) =>
                  setUnit((current) => ({
                    ...current,
                    registrationCode: event.target.value,
                  }))
                }
                placeholder="REG-001"
              />
            </label>
            <label>
              Capabilities
              <input
                value={unit.capabilities}
                onChange={(event) =>
                  setUnit((current) => ({
                    ...current,
                    capabilities: event.target.value,
                  }))
                }
                placeholder="STRETCHER, OXYGEN, MONITORING"
              />
            </label>
            <button
              className="primary-button"
              disabled={
                working === "create-unit" ||
                !unit.code.trim() ||
                !unit.registrationCode.trim()
              }
              onClick={() => void createUnit()}
            >
              Add transport unit
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Code</th>
                  <th align="left">Registration</th>
                  <th align="left">Mode</th>
                  <th align="left">Capabilities</th>
                  <th align="left">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.units.map((row) => (
                  <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "10px 8px" }}>
                      <strong>{row.code}</strong>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      {row.registrationCode}
                    </td>
                    <td style={{ padding: "10px 8px" }}>{row.mode}</td>
                    <td style={{ padding: "10px 8px" }}>
                      <small>{row.capabilities.join(", ") || "—"}</small>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <Status
                        ok={row.active}
                        label={row.active ? "ACTIVE" : "INACTIVE"}
                      />
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <button
                        className="secondary-button"
                        disabled={working === "unit:" + row.id}
                        onClick={() => void setUnitActive(row, !row.active)}
                      >
                        {row.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.units.length === 0 && (
              <p>
                No transport units are registered. This provider cannot become
                dispatch ready until an active compatible unit exists.
              </p>
            )}
          </div>

          <h3 style={{ marginTop: 24 }}>Recent crew assignments</h3>
          {detail.recentAssignments.length === 0 ? (
            <p>No crew assignments recorded yet.</p>
          ) : (
            <ul>
              {detail.recentAssignments.map((row) => (
                <li key={row.id}>
                  Request {row.transportRequestId} · revision {row.revision} ·{" "}
                  {row.crewProviderIds.length} crew member(s)
                </li>
              ))}
            </ul>
          )}
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
        fontSize: 11,
        fontWeight: 800,
        background: ok ? "#ecfdf5" : "#fff7ed",
      }}
    >
      {label}
    </span>
  );
}
