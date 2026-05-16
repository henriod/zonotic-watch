import { DISEASES } from "../data/surveillance.js";
import { panel } from "../lib/ui.js";

/**
 * Per-disease accent colors (ranked order). Hues rotate around the wheel —
 * red → blue → amber → green → purple → teal → magenta — so vertically
 * adjacent bars stay easy to tell apart.
 */
const DISEASE_PALETTE = [
  "#d64545", "#3b82c4", "#e0a020", "#4a9d5f", "#8b5cc7", "#28a7a0", "#b85a9e",
];

/**
 * Disease distribution panel — a ranked bar list. Bar width is scaled to the
 * leading disease so relative magnitude reads at a glance.
 */
export default function DiseaseDistribution() {
  const total = DISEASES.reduce((s, d) => s + d.total, 0);
  const max = Math.max(...DISEASES.map(d => d.total));

  return (
    <div style={{ ...panel, padding:"0.9rem", flex:1 }}>
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:14 }}>
        <p style={{ margin:0, fontWeight:500, fontSize:13 }}>Disease distribution</p>
        <span style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)" }}>{total} cases</span>
      </div>
      {DISEASES.map((d, i) => {
        const color = DISEASE_PALETTE[i % DISEASE_PALETTE.length];
        const barPct = Math.round((d.total / max) * 100);
        const lead = i === 0;
        return (
          <div key={d.name} style={{ marginBottom: i === DISEASES.length - 1 ? 0 : 12 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:5 }}>
              <span style={{ display:"flex", alignItems:"center", gap:6, minWidth:0, fontSize:12 }}>
                <span style={{ width:8, height:8, borderRadius:2, background:color, flexShrink:0 }} />
                <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight: lead ? 500 : 400 }}>
                  {d.name}
                </span>
              </span>
              <span style={{ display:"flex", alignItems:"baseline", gap:6, flexShrink:0, fontFamily:"var(--font-mono)" }}>
                <span style={{ fontSize:13, fontWeight:500, color }}>{Math.round(d.pct * 100)}%</span>
                <span style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>{d.total}</span>
              </span>
            </div>
            <div style={{ height:7, background:"var(--color-background-secondary)", borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${barPct}%`, background:color, borderRadius:4, transition:"width 0.3s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
