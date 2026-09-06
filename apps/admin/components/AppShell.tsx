import Link from "next/link";

const nav = [
  ["01", "Command Center", "/"],
  ["02", "Other Providers", "/providers"],
  ["03", "Doctors & Specialties", "/doctors"],
  ["04", "Appointments", "/appointments"],
  ["05", "Patient Workspaces", "#"],
  ["06", "Telehealth Hub", "#"],
  ["07", "Analytics & SLA", "#"],
  ["08", "Security & E2EE", "#"],
] as const;

export function AppShell({
  active,
  title,
  eyebrow,
  children,
}: Readonly<{
  active: string;
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C+</div>
          <div><strong>CarePoint</strong><span>Clinical Operations</span></div>
          <i className="live-dot" />
        </div>
        <div className="command">⌘ <span>Global command...</span><kbd>⌘K</kbd></div>
        <div className="nav-label">SYSTEM MODULES</div>
        <nav>
          {nav.map(([id, label, href]) => (
            <Link key={id} className={`nav-item ${active === id ? "active" : ""}`} href={href}>
              <small>{id}</small><span>{label}</span><b>›</b>
            </Link>
          ))}
        </nav>
        <div className="security-pill"><div><small>E2EE STATUS</small><strong>Shield policy active</strong></div><i /></div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="network-pill"><span>◎</span> Global Care Network</div>
          <div className="operator"><span className="notification">●</span><div><strong>Platform Administrator</strong><small>SECURE SESSION</small></div><div className="avatar">PA</div></div>
        </header>
        <main className="content">
          <div className="page-title"><div><span>{eyebrow}</span><h1>{title}</h1></div><button className="secondary-button">Export snapshot</button></div>
          {children}
        </main>
      </section>
    </div>
  );
}
