import { SCRAPE_KEYWORDS, TWITTER_HANDLES } from "../data/surveillance.js";

/** Ingestion sources — all now run server-side in the Temporal workflow. */
const SOURCES = [
  {
    name: "GDELT news index",
    detail: "Kenya disease news — free, no key",
    note: "server-side",
  },
  {
    name: "Apify · apidojo~tweet-scraper",
    detail: "X/Twitter signals (needs a paid Apify plan)",
    note: "server-side",
  },
];

/** Architecture steps shown at the bottom of the panel. */
const PIPELINE = [
  "GDELT news API + Apify scraper → raw text",
  "Keyword classifier → disease + severity",
  "Geocoding → county-level coordinates",
  "Open-Meteo API → live county weather",
  "PostGIS → spatial aggregation + heatmap",
];

/**
 * "Data Sources" tab — source status, the monitored query config (read
 * only), and the "Pull live signals" trigger.
 *
 * Ingestion is fully server-side: the Apify token lives in the backend,
 * never the browser bundle. "Pull live signals" starts a Temporal
 * ingestion run and polls it to completion.
 *
 * @param {{ scraping: boolean, scrapeStatus: string,
 *           onRefresh: () => void }} props
 */
export default function DataSourcesPanel({ scraping, scrapeStatus, onRefresh }) {
  return (
    <div style={{ padding:"1rem" }}>
      <p style={{ margin:"0 0 10px", fontWeight:500, fontSize:13 }}>Live data sources</p>
      <p style={{ margin:"0 0 12px", fontSize:12, color:"var(--color-text-secondary)" }}>
        “Pull live signals” starts a server-side ingestion run; the signal feed reloads when it completes.
      </p>

      {/* Source status */}
      <div style={{ padding:"0.7rem", background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", marginBottom:10 }}>
        <p style={{ margin:"0 0 8px", fontSize:12, fontWeight:500 }}>Sources</p>
        {SOURCES.map(s => (
          <div key={s.name} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", flexShrink:0, background:"#27ae60" }} />
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ margin:0, fontSize:12, fontWeight:500 }}>{s.name}</p>
              <p style={{ margin:0, fontSize:12, color:"var(--color-text-tertiary)" }}>{s.detail}</p>
            </div>
            <span style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"var(--color-text-secondary)", whiteSpace:"nowrap" }}>{s.note}</span>
          </div>
        ))}
      </div>

      {/* Monitored Twitter keywords (configured backend-side) */}
      <div style={{ marginBottom:10 }}>
        <p style={{ margin:"0 0 6px", fontSize:12, fontWeight:500 }}>Twitter keywords (Apify)</p>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
          {SCRAPE_KEYWORDS.map(kw => (
            <span key={kw} style={{ fontSize:12, padding:"2px 7px", background:"var(--color-background-secondary)", borderRadius:4, border:"0.5px solid var(--color-border-tertiary)" }}>{kw}</span>
          ))}
        </div>
      </div>

      {/* Verified accounts */}
      <div style={{ marginBottom:10 }}>
        <p style={{ margin:"0 0 6px", fontSize:12, fontWeight:500 }}>Verified accounts</p>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
          {TWITTER_HANDLES.map(h => (
            <span key={h} style={{ fontSize:12, fontFamily:"var(--font-mono)", padding:"2px 7px", background:"var(--color-background-success)", color:"var(--color-text-success)", borderRadius:4 }}>@{h}</span>
          ))}
        </div>
      </div>

      <button onClick={onRefresh} disabled={scraping}
        style={{ width:"100%", padding:"0.55rem", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background: scraping ? "var(--color-background-secondary)" : "var(--color-background-info)", color: scraping ? "var(--color-text-tertiary)" : "var(--color-text-info)", cursor: scraping ? "not-allowed" : "pointer", fontWeight:500, fontSize:13, marginBottom:8 }}>
        {scraping ? "Pulling…" : "Pull live signals ↗"}
      </button>
      {scrapeStatus && <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)", fontFamily:"var(--font-mono)" }}>{scrapeStatus}</p>}

      <div style={{ marginTop:12, padding:"0.7rem", background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)" }}>
        <p style={{ margin:"0 0 6px", fontSize:12, fontWeight:500 }}>Pipeline architecture</p>
        {PIPELINE.map((step, i) => (
          <p key={step} style={{ margin:"3px 0", fontSize:12, color:"var(--color-text-secondary)", display:"flex", gap:8 }}>
            <span style={{ fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)", minWidth:14 }}>{i+1}.</span>
            {step}
          </p>
        ))}
      </div>
    </div>
  );
}
