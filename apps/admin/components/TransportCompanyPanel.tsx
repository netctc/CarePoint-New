"use client";

import { useEffect, useMemo, useState } from "react";

type Provider = {
  id: string;
  displayName: string;
  legalName?: string | null;
  status: string;
  family?: string | null;
  dispatchReady?: boolean;
};

type Unit = {
  id: string;
  providerId: string;
  code: string;
  registrationCode: string;
  mode: string;
  active: boolean;
};

type Crew = {
  id: string;
  companyId: string;
  providerId?: string | null;
  displayName: string;
  role: string;
  licenseNumber?: string | null;
  licenseIssuer?: string | null;
  licenseValidUntil?: string | null;
  active: boolean;
  licenseRequired: boolean;
  licenseCurrent: boolean;
  assignmentReady: boolean;
};

type Company = {
  id: string;
  code: string;
  displayName: string;
  legalName: string;
  registrationNumber?: string | null;
  contactPhone?: string | null;
  providerIds: string[];
  unitIds: string[];
  active: boolean;
  crew: Crew[];
};

type DispatchRow = {
  id: string;
  status: string;
  pickupAddress?: string | null;
  etaMinutes?: number | null;
  assignedProviderId?: string | null;
  provider?: { id: string; displayName: string; family?: string | null } | null;
  company?: { id: string; code: string; displayName: string } | null;
  mode?: string;
  scheduledFor?: string;
  requestedAt?: string;
  destinationAddress?: string | null;
};

const ROLES = [
  "DRIVER",
  "PARAMEDIC",
  "EMT",
  "NURSE",
  "PHYSICIAN",
  "PILOT",
  "FLIGHT_MEDIC",
  "DISPATCHER",
  "OTHER",
] as const;

const card = {
  background: "#fff",
  border: "1px solid #dbe4ee",
  borderRadius: 16,
  padding: 18,
} as const;

export function TransportCompanyPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [dispatchProviders, setDispatchProviders] = useState<Provider[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [medical, setMedical] = useState<DispatchRow[]>([]);
  const [emergency, setEmergency] = useState<DispatchRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [assignments, setAssignments] = useState<Record<string, { providerId: string; eta: string }>>({});

  const emptyCompany = {
    id: "",
    code: "",
    displayName: "",
    legalName: "",
    registrationNumber: "",
    contactPhone: "",
    providerIds: [] as string[],
    unitIds: [] as string[],
    active: true,
  };
  const [companyForm, setCompanyForm] = useState(emptyCompany);
  const [crewForm, setCrewForm] = useState({
    displayName: "",
    role: "DRIVER",
    providerId: "",
    licenseNumber: "",
    licenseIssuer: "",
    licenseValidUntil: "",
  });

  const selected = companies.find((row) => row.id === selectedId) ?? null;
  const selectedProviders = providers.filter((row) =>
    (selected?.providerIds ?? companyForm.providerIds).includes(row.id),
  );
  const selectableUnits = units.filter((row) =>
    companyForm.providerIds.includes(row.providerId),
  );

  const metrics = useMemo(() => {
    const crew = companies.flatMap((row) => row.crew);
    return {
      companies: companies.length,
      activeCompanies: companies.filter((row) => row.active).length,
      crew: crew.length,
      crewReady: crew.filter((row) => row.assignmentReady).length,
      openJobs: medical.length + emergency.length,
    };
  }, [companies, medical, emergency]);

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    if (response.status === 401) {
      window.location.assign("/login?next=/transport-providers");
      throw new Error("Authentication required.");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof body?.message === "string" ? body.message : "Request failed.");
    }
    return body;
  }

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const [companyBody, dispatchBody, providerBody] = await Promise.all([
        request("/api/admin/transport/companies"),
        request("/api/admin/transport/dispatch"),
        request("/api/admin/transport/providers"),
      ]);
      const nextCompanies = Array.isArray(companyBody?.items) ? companyBody.items : [];
      setCompanies(nextCompanies);
      setProviders(Array.isArray(companyBody?.catalog?.providers) ? companyBody.catalog.providers : []);
      setDispatchProviders(Array.isArray(providerBody?.items) ? providerBody.items : []);
      setUnits(Array.isArray(companyBody?.catalog?.units) ? companyBody.catalog.units : []);
      setMedical(Array.isArray(dispatchBody?.medical) ? dispatchBody.medical : []);
      setEmergency(Array.isArray(dispatchBody?.emergency) ? dispatchBody.emergency : []);
      setSelectedId((current) =>
        current && nextCompanies.some((row: Company) => row.id === current)
          ? current
          : nextCompanies[0]?.id ?? "",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  }

  function beginCreate() {
    setCompanyForm(emptyCompany);
  }

  function beginEdit(row: Company) {
    setCompanyForm({
      id: row.id,
      code: row.code,
      displayName: row.displayName,
      legalName: row.legalName,
      registrationNumber: row.registrationNumber ?? "",
      contactPhone: row.contactPhone ?? "",
      providerIds: [...row.providerIds],
      unitIds: [...row.unitIds],
      active: row.active,
    });
    setSelectedId(row.id);
  }

  async function saveCompany() {
    setWorking("company-save");
    setMessage("");
    try {
      const editing = Boolean(companyForm.id);
      const path = editing
        ? "/api/admin/transport/companies/" + encodeURIComponent(companyForm.id)
        : "/api/admin/transport/companies";
      const payload = {
        ...(!editing ? { code: companyForm.code } : {}),
        displayName: companyForm.displayName,
        legalName: companyForm.legalName,
        registrationNumber: companyForm.registrationNumber || null,
        contactPhone: companyForm.contactPhone || null,
        providerIds: companyForm.providerIds,
        unitIds: companyForm.unitIds,
        active: companyForm.active,
      };
      await request(path, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setCompanyForm(emptyCompany);
      await load();
      setMessage("Transport company saved.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function setCompanyActive(row: Company, active: boolean) {
    setWorking("company:" + row.id);
    setMessage("");
    try {
      await request("/api/admin/transport/companies/" + encodeURIComponent(row.id), {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      await load();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function addCrew() {
    if (!selected) return;
    setWorking("crew-add");
    setMessage("");
    try {
      await request(
        "/api/admin/transport/companies/" + encodeURIComponent(selected.id) + "/crew",
        {
          method: "POST",
          body: JSON.stringify({
            displayName: crewForm.displayName,
            role: crewForm.role,
            providerId: crewForm.providerId || null,
            licenseNumber: crewForm.licenseNumber || null,
            licenseIssuer: crewForm.licenseIssuer || null,
            licenseValidUntil: crewForm.licenseValidUntil || null,
            active: true,
          }),
        },
      );
      setCrewForm({
        displayName: "",
        role: "DRIVER",
        providerId: "",
        licenseNumber: "",
        licenseIssuer: "",
        licenseValidUntil: "",
      });
      await load();
      setSelectedId(selected.id);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function setCrewActive(row: Crew, active: boolean) {
    setWorking("crew:" + row.id);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/companies/" +
          encodeURIComponent(row.companyId) +
          "/crew/" +
          encodeURIComponent(row.id),
        { method: "PATCH", body: JSON.stringify({ active }) },
      );
      await load();
      setSelectedId(row.companyId);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  async function assignDispatch(row: DispatchRow, kind: "medical" | "emergency") {
    const key = kind + ":" + row.id;
    const draft = assignments[key] ?? { providerId: "", eta: "" };
    if (!draft.providerId) {
      setMessage("Select a dispatch-ready Transport Provider.");
      return;
    }
    const eta = draft.eta.trim() === "" ? undefined : Number(draft.eta);
    if (eta !== undefined && (!Number.isInteger(eta) || eta < 0 || eta > 1440)) {
      setMessage("ETA must be an integer between 0 and 1440 minutes.");
      return;
    }
    setWorking("assign:" + key);
    setMessage("");
    try {
      await request(
        "/api/admin/transport/dispatch/" +
          kind +
          "/" +
          encodeURIComponent(row.id) +
          "/assign",
        {
          method: "POST",
          body: JSON.stringify({
            providerId: draft.providerId,
            ...(eta !== undefined ? { etaMinutes: eta } : {}),
          }),
        },
      );
      setAssignments((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await load();
      setMessage("Transport job assigned.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setWorking("");
    }
  }

  return (
    <section style={{ display: "grid", gap: 18, marginTop: 24 }}>
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
              TRANSPORT · COMPANY / CREW / DISPATCH
            </span>
            <h2 style={{ margin: "6px 0" }}>Transport Organization Operations</h2>
            <p style={{ marginBottom: 0 }}>
              Group Transport Providers and fleet units into operating companies, govern crew readiness,
              and review the live dispatch board.
            </p>
          </div>
          <button className="secondary-button" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(120px,1fr))", gap: 10, marginTop: 16 }}>
          <Metric label="Companies" value={metrics.companies} />
          <Metric label="Active companies" value={metrics.activeCompanies} />
          <Metric label="Crew" value={metrics.crew} />
          <Metric label="Assignment ready" value={metrics.crewReady} />
          <Metric label="Open dispatch jobs" value={metrics.openJobs} />
        </div>
        {message && <p style={{ marginBottom: 0 }}>{message}</p>}
      </section>

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ marginTop: 0 }}>{companyForm.id ? "Edit transport company" : "Create transport company"}</h3>
          {companyForm.id && (
            <button className="secondary-button" onClick={beginCreate}>New company</button>
          )}
        </div>
        <div className="admin-form-grid">
          <label><span>Company code</span><input disabled={Boolean(companyForm.id)} value={companyForm.code} onChange={(e) => setCompanyForm({ ...companyForm, code: e.target.value.toUpperCase() })} /></label>
          <label><span>Display name</span><input value={companyForm.displayName} onChange={(e) => setCompanyForm({ ...companyForm, displayName: e.target.value })} /></label>
          <label><span>Legal name</span><input value={companyForm.legalName} onChange={(e) => setCompanyForm({ ...companyForm, legalName: e.target.value })} /></label>
          <label><span>Registration number</span><input value={companyForm.registrationNumber} onChange={(e) => setCompanyForm({ ...companyForm, registrationNumber: e.target.value })} /></label>
          <label><span>Contact phone</span><input value={companyForm.contactPhone} onChange={(e) => setCompanyForm({ ...companyForm, contactPhone: e.target.value })} /></label>
          <label className="admin-form-check"><input type="checkbox" checked={companyForm.active} onChange={(e) => setCompanyForm({ ...companyForm, active: e.target.checked })} /> Active</label>
        </div>

        <h4>Transport Providers</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
          {providers.map((row) => (
            <label key={row.id} className="admin-form-check">
              <input
                type="checkbox"
                checked={companyForm.providerIds.includes(row.id)}
                onChange={() => {
                  const providerIds = toggle(companyForm.providerIds, row.id);
                  const allowedProviderIds = new Set(providerIds);
                  setCompanyForm({
                    ...companyForm,
                    providerIds,
                    unitIds: companyForm.unitIds.filter((id) => {
                      const unit = units.find((candidate) => candidate.id === id);
                      return Boolean(unit && allowedProviderIds.has(unit.providerId));
                    }),
                  });
                }}
              />
              {row.displayName} · {row.family ?? "—"}
            </label>
          ))}
        </div>

        <h4>Fleet units</h4>
        {selectableUnits.length === 0 ? (
          <p>Select one or more Transport Providers to assign their fleet units.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
            {selectableUnits.map((row) => (
              <label key={row.id} className="admin-form-check">
                <input
                  type="checkbox"
                  checked={companyForm.unitIds.includes(row.id)}
                  onChange={() => setCompanyForm({ ...companyForm, unitIds: toggle(companyForm.unitIds, row.id) })}
                />
                {row.code} · {row.registrationCode} · {row.mode} {row.active ? "" : "· INACTIVE"}
              </label>
            ))}
          </div>
        )}
        <div className="admin-form-actions">
          <button className="primary-button" disabled={working === "company-save"} onClick={() => void saveCompany()}>
            {working === "company-save" ? "Saving…" : "Save company"}
          </button>
        </div>
      </section>

      <section style={{ ...card, overflowX: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Transport companies</h3>
        {companies.length === 0 ? <p>No transport companies configured yet.</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th align="left">Company</th><th align="left">Providers</th><th align="left">Fleet</th><th align="left">Crew</th><th align="left">Status</th><th /></tr></thead>
            <tbody>
              {companies.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "12px 8px" }}><strong>{row.displayName}</strong><br /><small>{row.code} · {row.legalName}</small></td>
                  <td style={{ padding: "12px 8px" }}>{row.providerIds.length}</td>
                  <td style={{ padding: "12px 8px" }}>{row.unitIds.length}</td>
                  <td style={{ padding: "12px 8px" }}>{row.crew.length}</td>
                  <td style={{ padding: "12px 8px" }}>{row.active ? "ACTIVE" : "INACTIVE"}</td>
                  <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                    <button className="secondary-button" onClick={() => beginEdit(row)}>Manage</button>{" "}
                    <button className="secondary-button" disabled={working === "company:" + row.id} onClick={() => void setCompanyActive(row, !row.active)}>
                      {row.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected && (
        <section style={card}>
          <h3 style={{ marginTop: 0 }}>Crew · {selected.displayName}</h3>
          <div className="admin-form-grid">
            <label><span>Display name</span><input value={crewForm.displayName} onChange={(e) => setCrewForm({ ...crewForm, displayName: e.target.value })} /></label>
            <label><span>Role</span><select value={crewForm.role} onChange={(e) => setCrewForm({ ...crewForm, role: e.target.value })}>{ROLES.map((role) => <option key={role}>{role}</option>)}</select></label>
            <label><span>Linked Provider (optional)</span><select value={crewForm.providerId} onChange={(e) => setCrewForm({ ...crewForm, providerId: e.target.value })}><option value="">—</option>{selectedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}</select></label>
            <label><span>License number</span><input value={crewForm.licenseNumber} onChange={(e) => setCrewForm({ ...crewForm, licenseNumber: e.target.value })} /></label>
            <label><span>License issuer</span><input value={crewForm.licenseIssuer} onChange={(e) => setCrewForm({ ...crewForm, licenseIssuer: e.target.value })} /></label>
            <label><span>License valid until</span><input type="date" value={crewForm.licenseValidUntil} onChange={(e) => setCrewForm({ ...crewForm, licenseValidUntil: e.target.value })} /></label>
          </div>
          <div className="admin-form-actions">
            <button className="primary-button" disabled={working === "crew-add"} onClick={() => void addCrew()}>
              {working === "crew-add" ? "Adding…" : "Add crew member"}
            </button>
          </div>

          <div style={{ overflowX: "auto", marginTop: 18 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th align="left">Crew member</th><th align="left">Role</th><th align="left">Provider link</th><th align="left">License</th><th align="left">Readiness</th><th /></tr></thead>
              <tbody>
                {selected.crew.map((row) => (
                  <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "10px 8px" }}><strong>{row.displayName}</strong></td>
                    <td style={{ padding: "10px 8px" }}>{row.role}</td>
                    <td style={{ padding: "10px 8px" }}>{row.providerId ? (providers.find((p) => p.id === row.providerId)?.displayName ?? row.providerId) : "Not linked"}</td>
                    <td style={{ padding: "10px 8px" }}>{row.licenseNumber ?? (row.licenseRequired ? "Required" : "Not required")}<br /><small>{row.licenseValidUntil ?? ""}</small></td>
                    <td style={{ padding: "10px 8px" }}>{row.assignmentReady ? "ASSIGNMENT READY" : row.active ? "ATTENTION" : "INACTIVE"}</td>
                    <td style={{ padding: "10px 8px" }}><button className="secondary-button" disabled={working === "crew:" + row.id} onClick={() => void setCrewActive(row, !row.active)}>{row.active ? "Deactivate" : "Activate"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={card}>
        <h3 style={{ marginTop: 0 }}>Dispatch Board</h3>
        <p>
          Assign unallocated jobs through the existing transport lifecycle. Only compatible,
          dispatch-ready providers are offered; backend lifecycle rules remain authoritative.
        </p>
        <h4>Emergency ambulance</h4>
        <DispatchTable
          rows={emergency}
          kind="emergency"
          providers={dispatchProviders}
          assignments={assignments}
          setAssignments={setAssignments}
          onAssign={assignDispatch}
          working={working}
        />
        <h4 style={{ marginTop: 22 }}>Scheduled medical transport</h4>
        <DispatchTable
          rows={medical}
          kind="medical"
          providers={dispatchProviders}
          assignments={assignments}
          setAssignments={setAssignments}
          onAssign={assignDispatch}
          working={working}
        />
      </section>
    </section>
  );
}

function DispatchTable({
  rows,
  kind,
  providers,
  assignments,
  setAssignments,
  onAssign,
  working,
}: {
  rows: DispatchRow[];
  kind: "medical" | "emergency";
  providers: Provider[];
  assignments: Record<string, { providerId: string; eta: string }>;
  setAssignments: React.Dispatch<React.SetStateAction<Record<string, { providerId: string; eta: string }>>>;
  onAssign: (row: DispatchRow, kind: "medical" | "emergency") => Promise<void>;
  working: string;
}) {
  if (rows.length === 0) return <p>No active {kind} jobs.</p>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th align="left">Job</th><th align="left">Status</th><th align="left">Timing</th><th align="left">Location</th><th align="left">Assignment</th><th align="left">ETA</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const key = kind + ":" + row.id;
            const draft = assignments[key] ?? { providerId: "", eta: "" };
            const expectedFamily = kind === "emergency"
              ? "EMERGENCY_AMBULANCE"
              : row.mode === "AIR"
                ? "MEDICAL_TRANSPORT_AIR"
                : "MEDICAL_TRANSPORT_GROUND";
            const eligible = providers.filter(
              (provider) => provider.dispatchReady === true && provider.family === expectedFamily,
            );
            const canAssign = !row.assignedProviderId &&
              (kind === "medical" ? row.status === "REQUESTED" : ["REQUESTED", "DISPATCHING"].includes(row.status));

            return (
              <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "10px 8px" }}><strong>{kind === "emergency" ? "Emergency" : "Scheduled"}</strong><br /><small>{row.id}</small></td>
                <td style={{ padding: "10px 8px" }}>{row.status}{row.mode ? <><br /><small>{row.mode}</small></> : null}</td>
                <td style={{ padding: "10px 8px" }}>{displayDate(row.scheduledFor ?? row.requestedAt)}</td>
                <td style={{ padding: "10px 8px" }}>{row.pickupAddress ?? "Coordinates / address pending"}{row.destinationAddress ? <><br /><small>→ {row.destinationAddress}</small></> : null}</td>
                <td style={{ padding: "10px 8px", minWidth: 250 }}>
                  {row.assignedProviderId ? (
                    <>{row.company?.displayName ?? "No company"}{row.provider?.displayName ? <><br /><small>{row.provider.displayName}</small></> : null}</>
                  ) : canAssign ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <select
                        value={draft.providerId}
                        onChange={(event) => setAssignments((current) => ({
                          ...current,
                          [key]: { ...draft, providerId: event.target.value },
                        }))}
                      >
                        <option value="">Select provider…</option>
                        {eligible.map((provider) => (
                          <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                        ))}
                      </select>
                      {eligible.length === 0 && <small>No dispatch-ready provider for {expectedFamily}.</small>}
                    </div>
                  ) : "Unassigned"}
                </td>
                <td style={{ padding: "10px 8px", minWidth: 150 }}>
                  {row.assignedProviderId ? (
                    row.etaMinutes == null ? "—" : row.etaMinutes + " min"
                  ) : canAssign ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        placeholder="ETA min"
                        value={draft.eta}
                        onChange={(event) => setAssignments((current) => ({
                          ...current,
                          [key]: { ...draft, eta: event.target.value },
                        }))}
                      />
                      <button
                        className="primary-button"
                        disabled={!draft.providerId || working === "assign:" + key}
                        onClick={() => void onAssign(row, kind)}
                      >
                        {working === "assign:" + key ? "Assigning…" : "Assign"}
                      </button>
                    </div>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}><strong style={{ display: "block", fontSize: 22 }}>{value}</strong><span style={{ fontSize: 12, color: "#64748b" }}>{label}</span></div>;
}

function displayDate(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
