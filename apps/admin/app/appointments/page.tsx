import { AppShell } from "@/components/AppShell";

export default function AppointmentsPage() {
  const items = [
    ["09:00", "Clinic", "Dr. Lina Haddad", "Cardiology", "Confirmed"],
    ["09:30", "Telemedicine", "Dr. Omar Nasser", "Neurology", "Joining"],
    ["10:15", "Home visit", "Noura Khoury", "Nursing / ATS", "En route"],
    ["11:00", "Clinic", "Dr. Maya Saad", "Dermatology", "Confirmed"],
  ];
  return (
    <AppShell active="04" eyebrow="MULTI-MODAL OPERATIONS" title="Unified Appointment Operations">
      <section className="modality-strip"><div className="clinic"><b>Clinic</b><span>182 today</span></div><div className="tele"><b>Telemedicine</b><span>96 today</span></div><div className="home"><b>Home visit</b><span>41 today</span></div><div className="emergency"><b>Emergency Ambulance</b><span>Separate urgent flow</span></div></section>
      <section className="panel"><div className="panel-heading"><div><span>TODAY</span><h3>Care delivery timeline</h3></div><button>Filter</button></div><div className="timeline">{items.map((x) => <div className="timeline-row" key={`${x[0]}-${x[2]}`}><b>{x[0]}</b><i/><div><strong>{x[2]}</strong><span>{x[3]} · {x[1]}</span></div><em>{x[4]}</em></div>)}</div></section>
    </AppShell>
  );
}
