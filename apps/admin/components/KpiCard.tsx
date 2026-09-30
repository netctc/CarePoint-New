export function KpiCard({ label, value, detail, tone = "blue" }: Readonly<{ label: string; value: string; detail: string; tone?: "blue" | "violet" | "green" | "rose" }>) {
  return <article className={`kpi-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
