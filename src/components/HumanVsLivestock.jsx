import { panel } from "../lib/ui.js";

/**
 * Human-vs-livestock case split — two stat cards plus a two-segment bar.
 * Human reads red, livestock blue, consistently across the dashboard.
 *
 * @param {{ totalHuman: number, totalAnimal: number }} props
 */
export default function HumanVsLivestock({ totalHuman, totalAnimal }) {
  const humanPct = Math.round((totalHuman / (totalHuman + totalAnimal)) * 100);

  const stats = [
    { label:"Human",     val:totalHuman,  pct:humanPct,       icon:"ti-user", vc:"var(--color-text-danger)" },
    { label:"Livestock", val:totalAnimal, pct:100 - humanPct, icon:"ti-paw",  vc:"#3b82c4" },
  ];

  return (
    <div style={{ ...panel, padding:"0.9rem" }}>
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:12 }}>
        <p style={{ margin:0, fontWeight:500, fontSize:13 }}>Human vs livestock</p>
        <span style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)" }}>{totalHuman + totalAnimal} cases</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", padding:"0.55rem 0.6rem" }}>
            <p style={{ margin:"0 0 3px", fontSize:12, color:"var(--color-text-secondary)", display:"flex", alignItems:"center", gap:5 }}>
              <i className={`ti ${s.icon}`} style={{ fontSize:12, color:s.vc }} aria-hidden="true" />
              {s.label}
            </p>
            <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
              <span style={{ fontWeight:500, fontSize:20, fontFamily:"var(--font-mono)", color:s.vc }}>{s.val}</span>
              <span style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)" }}>{s.pct}%</span>
            </div>
          </div>
        ))}
      </div>
      {/* Two-segment split bar — colors match the stat cards above. */}
      <div style={{ display:"flex", height:8, borderRadius:4, overflow:"hidden", background:"var(--color-background-secondary)" }}>
        <div style={{ width:`${humanPct}%`, background:"#b03030", transition:"width 0.3s ease" }} />
        <div style={{ width:`${100 - humanPct}%`, background:"#3b82c4", transition:"width 0.3s ease" }} />
      </div>
    </div>
  );
}
