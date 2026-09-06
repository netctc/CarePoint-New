import { AppShell } from "@/components/AppShell";

const specialties = [
  ["Cardiology", "42 doctors", "7 sub-specialties"],
  ["Neurology", "28 doctors", "5 sub-specialties"],
  ["Pediatrics", "35 doctors", "9 sub-specialties"],
  ["Dermatology", "22 doctors", "4 sub-specialties"],
  ["General Medicine", "54 doctors", "Core specialty"],
  ["Surgery", "31 doctors", "12 sub-specialties"],
];

export default function DoctorsPage() {
  return (
    <AppShell active="03" eyebrow="DEDICATED DOCTOR DOMAIN" title="Doctors & Medical Specialties">
      <section className="doctor-hero"><div><span>ALL MEDICAL BRANCHES</span><h2>One doctor application. Every specialty.</h2><p>Every physician belongs to this domain, from general medicine to highly specialized surgical and diagnostic disciplines. No doctor belongs to Other Providers.</p></div><div className="doctor-metric"><strong>212</strong><span>active doctors</span><small>94% credential ready</small></div></section>
      <section className="specialty-grid">{specialties.map(([name,count,detail],i) => <article className="specialty-card" key={name}><div className="specialty-icon">{String(i+1).padStart(2,'0')}</div><div><strong>{name}</strong><span>{count}</span><small>{detail}</small></div><button>Open →</button></article>)}</section>
      <section className="panel"><div className="panel-heading"><div><span>CREDENTIAL GOVERNANCE</span><h3>Doctor activation readiness</h3></div></div><div className="progress-row"><span>Medical license verified</span><b>198 / 212</b><i><u style={{width:'93%'}} /></i></div><div className="progress-row"><span>Primary specialty assigned</span><b>212 / 212</b><i><u style={{width:'100%'}} /></i></div><div className="progress-row"><span>MFA enrolled</span><b>204 / 212</b><i><u style={{width:'96%'}} /></i></div></section>
    </AppShell>
  );
}
