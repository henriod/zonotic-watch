/** Four headline KPI cards above the main dashboard grid. */
export default function MetricCards({
  totalHuman,
  totalAnimal,
  countiesAffected,
  critCount,
}) {
  const cards = [
    { label:"Human cases",      val:totalHuman,       icon:"ti-user",           vc:"var(--color-text-danger)" },
    { label:"Livestock cases",  val:totalAnimal,      icon:"ti-paw",            vc:"#3b82c4" },
    { label:"Counties affected",val:countiesAffected, icon:"ti-map-pin",        vc:"var(--color-text-info)" },
    { label:"Critical alerts",  val:critCount,        icon:"ti-alert-triangle", vc:"var(--color-text-danger)" },
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
