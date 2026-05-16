import { useEffect, useState } from "react";

import { sevBg, sevTextVar } from "../lib/risk.js";
import { panel } from "../lib/ui.js";

/** Signals shown per page. */
const FEED_PAGE_SIZE = 5;

const pagerBtn = {
  display:"flex", alignItems:"center", gap:3, fontSize:12, fontWeight:500,
  padding:"3px 9px", borderRadius:"var(--border-radius-md)",
  border:"0.5px solid var(--color-border-tertiary)",
  background:"var(--color-background-secondary)", color:"var(--color-text-secondary)",
};

/**
 * Paginated live signal feed. Clicking a row hands the signal back to the
 * parent via `onSelect` (which routes it to the AI analyzer).
 *
 * @param {{ signals: object[], onSelect: (signal: object) => void }} props
 */
export default function SignalFeed({ signals, onSelect }) {
  const [page, setPage] = useState(0);

  // A refresh prepends new signals (new array reference) — jump to page 1
  // so the freshest items are visible.
  useEffect(() => { setPage(0); }, [signals]);

  const pageCount = Math.max(1, Math.ceil(signals.length / FEED_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * FEED_PAGE_SIZE;
  const pageSignals = signals.slice(start, start + FEED_PAGE_SIZE);

  return (
    <div style={{ ...panel, overflow:"hidden", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"0.6rem 0.85rem", borderBottom:"0.5px solid var(--color-border-tertiary)", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:"#27ae60" }} />
          <p style={{ margin:0, fontWeight:500, fontSize:12 }}>Live Signal Feed</p>
        </div>
        <span style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)" }}>{signals.length}</span>
      </div>
      <div style={{ flex:1 }}>
        {pageSignals.map(s => (
          <div key={s.id} onClick={() => onSelect(s)}
            style={{ padding:"0.65rem 0.85rem", borderBottom:"0.5px solid var(--color-border-tertiary)", cursor:"pointer" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
              <span style={{ fontSize:12, fontFamily:"var(--font-mono)", padding:"1px 5px", borderRadius:3, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)" }}>{s.src}</span>
              <span style={{ fontSize:12, padding:"1px 5px", borderRadius:3, background:sevBg(s.sev), color:sevTextVar(s.sev), fontFamily:"var(--font-mono)" }}>{s.sev}</span>
            </div>
            <p style={{ margin:"3px 0", fontSize:12, lineHeight:1.4, color:"var(--color-text-primary)" }}>{s.text.slice(0,85)}…</p>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>
                <i className="ti ti-map-pin" style={{ fontSize:12, marginRight:2 }} aria-hidden="true" />{s.loc}
              </span>
              <span style={{ fontSize:12, color:"var(--color-text-tertiary)", fontFamily:"var(--font-mono)" }}>{s.time} ago</span>
            </div>
            <p style={{ margin:"2px 0 0", fontSize:12, color:"var(--color-text-secondary)" }}>
              {s.disease} · {Math.round(s.conf * 100)}%
            </p>
          </div>
        ))}
      </div>
      {/* Pager */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, padding:"0.5rem 0.85rem", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
          style={{ ...pagerBtn, cursor: safePage === 0 ? "not-allowed" : "pointer", opacity: safePage === 0 ? 0.4 : 1 }}>
          <i className="ti ti-chevron-left" style={{ fontSize:13 }} aria-hidden="true" />Prev
        </button>
        <span style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"var(--color-text-secondary)" }}>
          {safePage + 1} / {pageCount}
        </span>
        <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}
          style={{ ...pagerBtn, cursor: safePage >= pageCount - 1 ? "not-allowed" : "pointer", opacity: safePage >= pageCount - 1 ? 0.4 : 1 }}>
          Next<i className="ti ti-chevron-right" style={{ fontSize:13 }} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
