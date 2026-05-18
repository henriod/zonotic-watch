import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

import { TREND } from "../data/surveillance.js";
import { apiEnabled, apiGet } from "../lib/api.js";
import { panel } from "../lib/ui.js";

/** Trend series — label and color, shared by the legend and the areas. */
const SERIES = [
  { key:"human",  name:"Human",      color:"#b03030" },
  { key:"animal", name:"Livestock",  color:"#3b82c4" },
  { key:"rvf",    name:"RVF signal", color:"#e0a020" },
];

/** Recharts tooltip styled to the dashboard's design tokens. */
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:"var(--border-radius-md)", padding:"0.5rem 0.75rem", fontSize:12 }}>
      <p style={{ margin:"0 0 4px", fontWeight:500 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey ?? p.name} style={{ margin:"2px 0", color:"var(--color-text-secondary)" }}>
          <span style={{ display:"inline-block", width:8, height:8, borderRadius:2, background:p.color, marginRight:6 }} />
          {p.name}: <strong style={{ color:"var(--color-text-primary)" }}>{p.value}</strong>
        </p>
      ))}
    </div>
  );
}

/** Weekly case-trend area chart for Kenya, backed by `/trend`. */
export default function TrendChart() {
  const [trend, setTrend] = useState(TREND);

  // Backend `/trend` aggregates county_week_features; seed `TREND` is the
  // offline fallback. A wide window surfaces the full RVF event history
  // (EMPRES-i runs 2004–2024) alongside recent signal weeks.
  useEffect(() => {
    if (!apiEnabled()) return;
    let cancelled = false;
    apiGet("/trend?days=9000")
      .then(t => { if (!cancelled && Array.isArray(t) && t.length) setTrend(t); })
      .catch(err => console.error("Trend fetch failed; using seed data:", err));
    return () => { cancelled = true; };
  }, []);

  const sum = key => trend.reduce((s, p) => s + (p[key] || 0), 0);

  return (
    <div style={{ ...panel, padding:"1rem" }}>
      <p style={{ margin:"0 0 8px", fontWeight:500, fontSize:13 }}>Weekly case trend — Kenya</p>
      <div style={{ display:"flex", gap:14, marginBottom:10 }}>
        {SERIES.map(s => (
          <span key={s.key} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"var(--color-text-secondary)" }}>
            <span style={{ width:10, height:10, borderRadius:2, background:s.color, display:"inline-block" }} />
            {s.name}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={trend} margin={{ top:4, right:8, left:-20, bottom:0 }}>
          <XAxis dataKey="day" tick={{ fontSize:12, fill:"var(--color-text-tertiary)" }} tickLine={false} />
          <YAxis tick={{ fontSize:12, fill:"var(--color-text-tertiary)" }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTip />} />
          <Area type="monotone" dataKey="animal" name="Livestock" stroke="#3b82c4" fill="#3b82c4" fillOpacity={0.12} strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="human"  name="Human"  stroke="#b03030" fill="#b03030" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="rvf"    name="RVF signal" stroke="#e0a020" fill="#e0a020" fillOpacity={0.10} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
      <p style={{ margin:"8px 0 0", fontSize:12, color:"var(--color-text-secondary)" }}>
        <i className="ti ti-trending-up" style={{ fontSize:12, color:"var(--color-text-danger)", marginRight:4 }} aria-hidden="true" />
        {sum("human")} human · {sum("animal")} livestock · {sum("rvf")} RVF signals across {trend.length} weeks
      </p>
    </div>
  );
}
