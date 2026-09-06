import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";

const flow = [
  ["Clinic visits", "182", "74% confirmed", "blue"],
  ["Telemedicine", "96", "12 joining now", "violet"],
  ["Home visits", "41", "9 en route", "green"],
  ["Emergency ambulance", "7", "2 dispatching", "rose"],
] as const;

export default function CommandCenterPage() {
  return (
    <AppShell active="01" eyebrow="REAL-TIME PLATFORM" title="Operations Command Center">
      <section className="aurora-hero">
        <div className="hero-copy"><span className="overline">CAREPOINT NEXT</span><h2>Clinical network in command.</h2><p>One operational view across independent doctors, non-doctor providers, medical transport and patient demand.</p></div>
        <div className="hero-status"><small>PLATFORM HEALTH</small><strong><i /> Nominal</strong><span>API 99.99% · DB healthy · Queue normal</span></div>
      </section>
      <section className="kpi-grid">
        <KpiCard label="Visits today" value="326" detail="+8.2% vs last Saturday" />
        <KpiCard label="Active doctors" value="248" detail="All specialties" tone="violet" />
        <KpiCard label="Other providers" value="189" detail="Doctors explicitly excluded" tone="green" />
        <KpiCard label="Urgent requests" value="07" detail="Ambulance priority queue" tone="rose" />
      </section>
      <section className="two-column">
        <article className="panel">
          <div className="panel-heading"><div><span>LIVE DEMAND</span><h3>Visits by modality</h3></div><button>Today</button></div>
          <div className="flow-list">{flow.map(([name,count,detail,tone]) => <div className="flow-row" key={name}><i className={tone}/><div><strong>{name}</strong><span>{detail}</span></div><b>{count}</b></div>)}</div>
        </article>
        <article className="panel midnight">
          <div className="panel-heading"><div><span>EMERGENCY AMBULANCE</span><h3>Priority dispatch</h3></div><span className="live-label">LIVE</span></div>
          <div className="dispatch-card"><small>REQUEST CP-ER-2407</small><strong>Patient request received</strong><span>Beirut · GPS verified · dispatching eligible ambulance</span><div><b>00:38</b><small> elapsed</small></div></div>
          <div className="dispatch-actions"><button>Open dispatch</button><button>Call patient</button></div>
        </article>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span>BOUNDARY HEALTH</span><h3>Provider domains</h3></div></div>
        <div className="domain-grid">
          <div><span>DOCTOR DOMAIN</span><strong>All doctors · all specialties</strong><p>Dedicated application, credentialing and specialty hierarchy.</p></div>
          <div><span>OTHER PROVIDER DOMAIN</span><strong>Healthcare + ground/air transport</strong><p>Flexible taxonomy. Doctors can never be classified here.</p></div>
          <div><span>PATIENT DOMAIN</span><strong>One global patient identity</strong><p>Consent controls provider access to sensitive clinical context.</p></div>
        </div>
      </section>
    </AppShell>
  );
}
