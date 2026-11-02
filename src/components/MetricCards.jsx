import { VHF_COLOR } from "../lib/risk.js";

/** Headline KPI cards above the main dashboard grid (90-day window). */
export default function MetricCards({
  totalHuman,
  totalAnimal,
  countiesAffected,
  critCount,
  vhfCount,
}) {
  const cards = [
    { label:"Human reports (90d)",     val:totalHuman,       icon:"ti-user",           vc:"var(--color-text-danger)" },
    { label:"Livestock reports (90d)", val:totalAnimal,      icon:"ti-paw",            vc:"#3b82c4" },
    { label:"Ebola / VHF (90d)",       val:vhfCount,         icon:"ti-virus",          vc:VHF_COLOR },
    { label:"Counties affected",       val:countiesAffected, icon:"ti-map-pin",        vc:"var(--color-text-info)" },
    { label:"Critical alerts",         val:critCount,        icon:"ti-alert-triangle", vc:"var(--color-text-danger)" },
  ];
  return (
    <div className="metric-grid">
      {cards.map(m => (
        <div key={m.label} style={{ background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", padding:"0.75rem 1rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            <i className={`ti ${m.icon}`} style={{ fontSize:13, color:m.vc }} aria-hidden="true" />
            <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>{m.label}</p>
          </div>
          <p style={{ margin:0, fontSize:24, fontWeight:500, fontFamily:"var(--font-mono)" }}>{m.val}</p>
        </div>
      ))}
    </div>
  );
}
