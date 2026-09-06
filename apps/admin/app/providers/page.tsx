import { AppShell } from "@/components/AppShell";

const providers = [
  ["RapidCare EMS", "Emergency Ambulance", "Verified", "24/7", "Beirut"],
  ["Noura Khoury", "Nursing / ATS", "Verified", "Home visit", "Mount Lebanon"],
  ["MoveWell Rehab", "Physiotherapy", "Review", "Clinic · Home", "Beirut"],
  ["Cedars AirMed", "Air Medical Transport", "Verified", "On request", "National"],
  ["Nutrition Forward", "Nutrition", "Verified", "Clinic · Online", "Beirut"],
];

export default function ProvidersPage() {
  return (
    <AppShell active="02" eyebrow="FLEXIBLE TAXONOMY · DOCTORS EXCLUDED" title="Independent Other Providers">
      <section className="notice-card"><div><span>DOMAIN RULE</span><h3>Every non-doctor provider is independent.</h3><p>Healthcare branches, emergency ambulance, ground transport and air medical transport are managed here. Doctors are always managed in the dedicated Doctor domain.</p></div><button className="primary-button">+ New category</button></section>
      <section className="panel">
        <div className="toolbar"><div className="search">⌕ Search providers, categories or coverage...</div><div><button>All status</button><button>All families</button></div></div>
        <div className="data-table">
          <div className="table-row table-head"><span>Provider</span><span>Category</span><span>Status</span><span>Mode / availability</span><span>Coverage</span></div>
          {providers.map((p) => <div className="table-row" key={p[0]}><span><b>{p[0]}</b><small>Independent entity</small></span><span>{p[1]}</span><span><em className={p[2] === "Verified" ? "ok" : "warn"}>{p[2]}</em></span><span>{p[3]}</span><span>{p[4]}</span></div>)}
        </div>
      </section>
      <section className="category-grid">
        {[
          ["NON-DOCTOR HEALTHCARE", "Nursing, ATS, physiotherapy, nutrition and future allied health categories."],
          ["GROUND MEDICAL TRANSPORT", "Scheduled or specialized patient transport by ground."],
          ["AIR MEDICAL TRANSPORT", "Medical aviation services with additional credential requirements."],
          ["EMERGENCY AMBULANCE", "Urgent providers eligible for priority dispatch from Patient Home."],
        ].map(([title,desc]) => <article className="category-card" key={title}><span>{title}</span><p>{desc}</p><button>Configure schema →</button></article>)}
      </section>
    </AppShell>
  );
}
