import { lazy, Suspense } from "react";

import { countyWeather } from "../lib/weather.js";
import CountyDetailCard from "./CountyDetailCard.jsx";

// MapLibre is heavy (~600 KB); load it as its own chunk only when the
// map is actually rendered.
const KenyaMap = lazy(() => import("./KenyaMap.jsx"));

/** Risk-tier legend for the map markers. */
const LEGEND = [
  ["CRITICAL", "#b03030"],
  ["HIGH", "#c07020"],
  ["MEDIUM", "#b09000"],
  ["LOW", "#208050"],
];

/** Placeholder shown while the map chunk loads — matches the map's footprint. */
function MapLoading() {
  return (
    <div style={{ width:"100%", height:380, display:"flex", alignItems:"center", justifyContent:"center", background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", color:"var(--color-text-secondary)", fontSize:12 }}>
      <i className="ti ti-map" style={{ fontSize:15, marginRight:6 }} aria-hidden="true" />
      Loading map…
    </div>
  );
}

/**
 * "Spatial View" tab — the MapLibre county map, a risk legend, and the
 * detail card for whichever county is selected.
 *
 * @param {{ selected: object|null, onSelect: (county: object|null) => void,
 *           weather: Record<string, object>, counties: object[] }} props
 */
export default function SpatialView({ selected, onSelect, weather, counties }) {
  return (
    <div style={{ padding:"1rem", display:"flex", flexDirection:"column", alignItems:"center" }}>
      <Suspense fallback={<MapLoading />}>
        <KenyaMap selected={selected} onSelect={onSelect} counties={counties} />
      </Suspense>
      {/* Legend */}
      <div style={{ display:"flex", gap:14, marginTop:8 }}>
        {LEGEND.map(([l,c]) => (
          <div key={l} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:c }} />
            <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{l}</span>
          </div>
        ))}
      </div>
      {selected && (
        <CountyDetailCard county={selected} wx={countyWeather(selected, weather)} />
      )}
    </div>
  );
}
