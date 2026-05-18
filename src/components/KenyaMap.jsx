import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { API_BASE } from "../lib/api.js";

/**
 * Interactive Kenya county map.
 *
 * Rendering: MapLibre GL JS.
 * Admin boundaries: GADM 4.1 Kenya level-1 (county) polygons.
 *
 * County polygons are tinted by surveillance risk; the monitored counties
 * (passed in via `counties`) also carry a marker sized by total case
 * volume. Clicking either selects the county; the `selected` prop is
 * reflected back into the map.
 *
 * @param {{ selected: object|null, onSelect: (county: object|null) => void,
 *           counties: object[] }} props
 */

// [west, south, east, north] — Kenya extent
const KENYA_BOUNDS = [
  [33.5, -5.0],
  [42.2, 5.2],
];

// Boundary GeoJSON: the backend's live `/counties.geojson` when a backend
// is configured (each feature then carries backend-driven `countyId`/`risk`),
// otherwise the bundled static file as an offline fallback.
const COUNTIES_URL = API_BASE
  ? `${API_BASE}/counties.geojson`
  : "data/kenya-counties.geojson";

// FAO Rift Valley fever risk surface (WMTS raster) — a toggleable overlay.
// Tiles load as images, so no CORS/proxy concern. WebMercatorQuad is the
// OGC tile-matrix set whose TileCol/TileRow map directly to XYZ {x}/{y}.
const RVF_WMTS_URL =
  "https://data.apps.fao.org/map/wmts/wmts" +
  "?layer=fao-gismgr/RVF/mapsets/VAXCRM-MEA&style=default" +
  "&tilematrixset=WebMercatorQuad&Service=WMTS&request=GetTile&Version=1.0.0" +
  "&Format=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}&layertype=Image";

// Legend for the FAO RVF raster — [swatch color, label]. Colors sampled
// from FAO's published legend for the VAXCRM mask layer.
const RVF_LEGEND = [
  ["#ff0000", "Risk only in current month"],
  ["#8c8c8c", "Risk only in last month"],
  ["#ffc300", "Persistent risk (current + last month)"],
];

/** Build a MapLibre `step` expression mapping a risk score (0–1) to a color. */
const riskColorExpr = (input) => [
  "step",
  input,
  "#208050", // < 0.45  low
  0.45,
  "#b09000", // medium
  0.65,
  "#c07020", // high
  0.85,
  "#b03030", // critical
];

/** County markers as a GeoJSON FeatureCollection — point per monitored county. */
function buildMarkerFC(counties) {
  return {
    type: "FeatureCollection",
    features: counties.map((c, i) => ({
      type: "Feature",
      id: i,
      properties: {
        countyId: c.id,
        name: c.name,
        risk: c.risk ?? 0,
        radius: Math.max(5, 5 + ((c.human || 0) + (c.animal || 0)) / 9),
      },
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
    })),
  };
}

/** Carto "dark matter" basemap — free, no API key or token required. */
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/** Map colors tuned for the dark basemap (independent of the light UI theme). */
const MAP = {
  border: "#5b6573", // county boundary line
  noData: "#aab2c0", // faint fill for unmonitored counties
  label: "#e4e7ec", // county name text
  labelHalo: "#0d0f14", // halo behind county labels
  markerStroke: "#ffffff",
};

const isSelected = ["boolean", ["feature-state", "selected"], false];

export default function KenyaMap({ selected, onSelect, counties }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);

  // FAO RVF risk raster overlay — purely local map state.
  const [rvfOn, setRvfOn] = useState(false);

  // Latest props, read from stable callbacks/handlers without re-binding.
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const countiesRef = useRef(counties);
  onSelectRef.current = onSelect;
  selectedRef.current = selected;
  countiesRef.current = counties;

  // Currently highlighted county id, and name → polygon feature-id lookup.
  const selectedIdRef = useRef(null);
  const polygonIdByName = useRef(new Map());

  // Reflect the `selected` county into MapLibre feature-state + recenter.
  const syncSelection = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const cs = countiesRef.current;
    const prevId = selectedIdRef.current;
    const nextId = selectedRef.current?.id ?? null;

    const toggle = (countyId, on) => {
      if (!countyId) return;
      const idx = cs.findIndex((c) => c.id === countyId);
      if (idx >= 0) {
        map.setFeatureState({ source: "markers", id: idx }, { selected: on });
        const polyId = polygonIdByName.current.get(cs[idx].name);
        if (polyId != null) {
          map.setFeatureState({ source: "counties", id: polyId }, { selected: on });
        }
      }
    };

    if (prevId !== nextId) {
      toggle(prevId, false);
      toggle(nextId, true);
      selectedIdRef.current = nextId;
    }
    if (nextId) {
      const c = cs.find((x) => x.id === nextId);
      if (c) map.easeTo({ center: [c.lng, c.lat], duration: 600 });
    }
  }, []);

  // Initialise the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: KENYA_BOUNDS,
      fitBoundsOptions: { padding: 16 },
      attributionControl: false,
      dragRotate: false,
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "County boundaries © GADM 4.1",
      })
    );

    map.on("load", async () => {
      // GADM admin boundaries, enriched with risk where we monitor.
      let boundaries;
      try {
        const res = await fetch(COUNTIES_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        boundaries = await res.json();
      } catch (err) {
        console.error("Failed to load Kenya county boundaries:", err);
        boundaries = { type: "FeatureCollection", features: [] };
      }

      // The backend GeoJSON already carries `countyId`/`risk`; the static
      // fallback file does not, so enrich it from the counties prop by name.
      const byName = new Map(countiesRef.current.map((c) => [c.name, c]));
      boundaries.features.forEach((f, i) => {
        f.id = i;
        polygonIdByName.current.set(f.properties.name, i);
        if (f.properties.countyId == null) {
          const c = byName.get(f.properties.name);
          if (c) {
            f.properties.countyId = c.id;
            f.properties.risk = c.risk;
          }
        }
      });

      if (map.__removed) return;
      map.addSource("counties", { type: "geojson", data: boundaries });
      map.addSource("markers", {
        type: "geojson",
        data: buildMarkerFC(countiesRef.current),
      });

      // Insert polygon layers beneath the basemap's place labels so city
      // names stay readable; markers go on top of everything.
      const firstSymbolId = map
        .getStyle()
        .layers.find((l) => l.type === "symbol")?.id;

      // County polygons — tinted by risk, faint where unmonitored.
      map.addLayer(
        {
          id: "county-fill",
          type: "fill",
          source: "counties",
          paint: {
            "fill-color": [
              "case",
              ["has", "risk"],
              riskColorExpr(["coalesce", ["get", "risk"], 0]),
              MAP.noData,
            ],
            "fill-opacity": [
              "case",
              isSelected,
              0.7,
              ["has", "risk"],
              0.5,
              0.16,
            ],
          },
        },
        firstSymbolId
      );
      map.addLayer(
        {
          id: "county-line",
          type: "line",
          source: "counties",
          paint: {
            "line-color": MAP.border,
            "line-width": ["case", isSelected, 2.4, 0.8],
            "line-opacity": 0.9,
          },
        },
        firstSymbolId
      );

      // Halo behind critical-risk counties.
      map.addLayer({
        id: "county-halo",
        type: "circle",
        source: "markers",
        filter: [">=", ["get", "risk"], 0.85],
        paint: {
          "circle-radius": ["+", ["get", "radius"], 9],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": riskColorExpr(["get", "risk"]),
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.4,
        },
      });

      // County markers — radius by case volume, color by risk.
      map.addLayer({
        id: "county-dot",
        type: "circle",
        source: "markers",
        paint: {
          "circle-radius": [
            "case",
            isSelected,
            ["+", ["get", "radius"], 3],
            ["get", "radius"],
          ],
          "circle-color": riskColorExpr(["get", "risk"]),
          "circle-opacity": 0.9,
          "circle-stroke-color": MAP.markerStroke,
          "circle-stroke-width": ["case", isSelected, 2.8, 1.2],
        },
      });
      map.addLayer({
        id: "county-label",
        type: "symbol",
        source: "markers",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
        },
        paint: {
          "text-color": MAP.label,
          "text-halo-color": MAP.labelHalo,
          "text-halo-width": 1.4,
        },
      });

      // FAO RVF risk surface — added above the county fill but below the
      // boundary lines/markers so they stay visible; hidden until toggled.
      map.addSource("rvf-risk", {
        type: "raster",
        tiles: [RVF_WMTS_URL],
        tileSize: 256,
        attribution: "RVF risk surface © FAO",
      });
      map.addLayer(
        {
          id: "rvf-risk",
          type: "raster",
          source: "rvf-risk",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.75 },
        },
        "county-line"
      );

      // Selection + hover interactions.
      const pick = (e) => {
        const countyId = e.features?.[0]?.properties?.countyId;
        if (!countyId) return;
        const county = countiesRef.current.find((c) => c.id === countyId);
        onSelectRef.current(
          selectedIdRef.current === countyId ? null : county
        );
      };
      for (const layer of ["county-dot", "county-fill"]) {
        map.on("click", layer, pick);
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      readyRef.current = true;
      syncSelection(); // apply any selection set before load completed
    });

    return () => {
      map.__removed = true;
      readyRef.current = false;
      map.remove();
    };
  }, [syncSelection]);

  // Refresh the marker source when the counties prop changes (e.g. the
  // backend `/counties` fetch resolving after first paint).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("markers");
    if (!src) return;
    src.setData(buildMarkerFC(counties));
    // setData clears feature-state; re-apply the current selection.
    const id = selectedIdRef.current;
    if (id) {
      const idx = counties.findIndex((c) => c.id === id);
      if (idx >= 0) {
        map.setFeatureState({ source: "markers", id: idx }, { selected: true });
      }
    }
  }, [counties]);

  // Keep the map in sync when the selected county changes elsewhere.
  useEffect(() => {
    syncSelection();
  }, [selected, syncSelection]);

  // Show/hide the FAO RVF raster overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("rvf-risk")) return;
    map.setLayoutProperty("rvf-risk", "visibility", rvfOn ? "visible" : "none");
  }, [rvfOn]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div
        ref={containerRef}
        role="application"
        aria-label="Kenya zoonotic risk map"
        style={{
          width: "100%",
          height: 600,
          borderRadius: "var(--border-radius-md)",
          overflow: "hidden",
        }}
      />
      <button
        type="button"
        onClick={() => setRvfOn((v) => !v)}
        aria-pressed={rvfOn}
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "5px 9px",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          borderRadius: "var(--border-radius-md)",
          border: "0.5px solid var(--color-border-secondary)",
          background: rvfOn
            ? "var(--color-background-info)"
            : "var(--color-background-primary)",
          color: rvfOn
            ? "var(--color-text-info)"
            : "var(--color-text-secondary)",
        }}
      >
        <i className="ti ti-stack-2" style={{ fontSize: 13 }} aria-hidden="true" />
        FAO RVF risk
      </button>

      {rvfOn && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            padding: "7px 10px",
            maxWidth: 240,
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-md)",
          }}
        >
          <p style={{ margin: "0 0 5px", fontSize: 12, fontWeight: 500 }}>
            FAO RVF risk
          </p>
          {RVF_LEGEND.map(([color, label]) => (
            <div
              key={label}
              style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  flexShrink: 0,
                  background: color,
                  border: "0.5px solid var(--color-border-tertiary)",
                }}
              />
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
