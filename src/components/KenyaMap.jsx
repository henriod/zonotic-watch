import { useCallback, useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { COUNTIES } from "../data/surveillance.js";

/**
 * Interactive Kenya county map.
 *
 * Rendering: MapLibre GL JS.
 * Admin boundaries: GADM 4.1 Kenya level-1 (county) polygons, served from
 *   `public/data/kenya-counties.geojson`. MapLibre is only a renderer and
 *   ships no admin geometry, so the boundaries come from GADM.
 *
 * County polygons are tinted by surveillance risk; the 14 monitored counties
 * also carry a marker sized by total case volume. Clicking either selects the
 * county; the `selected` prop is reflected back into the map.
 */

// [west, south, east, north] — Kenya extent
const KENYA_BOUNDS = [
  [33.5, -5.0],
  [42.2, 5.2],
];

const COUNTIES_URL = "data/kenya-counties.geojson";

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

export default function KenyaMap({ selected, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);

  // Latest props, read from stable callbacks/handlers without re-binding.
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  onSelectRef.current = onSelect;
  selectedRef.current = selected;

  // Currently highlighted county id, and name → polygon feature-id lookup.
  const selectedIdRef = useRef(null);
  const polygonIdByName = useRef(new Map());

  // Reflect the `selected` county into MapLibre feature-state + recenter.
  const syncSelection = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const prevId = selectedIdRef.current;
    const nextId = selectedRef.current?.id ?? null;

    const toggle = (countyId, on) => {
      if (!countyId) return;
      const idx = COUNTIES.findIndex((c) => c.id === countyId);
      if (idx >= 0) {
        map.setFeatureState({ source: "markers", id: idx }, { selected: on });
        const polyId = polygonIdByName.current.get(COUNTIES[idx].name);
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
      const c = COUNTIES.find((x) => x.id === nextId);
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

    // Point features for the 14 monitored counties.
    const markerFC = {
      type: "FeatureCollection",
      features: COUNTIES.map((c, i) => ({
        type: "Feature",
        id: i,
        properties: {
          countyId: c.id,
          name: c.name,
          risk: c.risk,
          radius: Math.max(5, 5 + (c.human + c.animal) / 9),
        },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      })),
    };

    map.on("load", async () => {
      // GADM admin boundaries, enriched with risk where we monitor.
      let counties;
      try {
        const res = await fetch(COUNTIES_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        counties = await res.json();
      } catch (err) {
        console.error("Failed to load Kenya county boundaries:", err);
        counties = { type: "FeatureCollection", features: [] };
      }

      const byName = new Map(COUNTIES.map((c) => [c.name, c]));
      counties.features.forEach((f, i) => {
        f.id = i;
        polygonIdByName.current.set(f.properties.name, i);
        const c = byName.get(f.properties.name);
        if (c) {
          f.properties.countyId = c.id;
          f.properties.risk = c.risk;
        }
      });

      if (map.__removed) return;
      map.addSource("counties", { type: "geojson", data: counties });
      map.addSource("markers", { type: "geojson", data: markerFC });

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

      // Selection + hover interactions.
      const pick = (e) => {
        const countyId = e.features?.[0]?.properties?.countyId;
        if (!countyId) return;
        const county = COUNTIES.find((c) => c.id === countyId);
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

  // Keep the map in sync when the selected county changes elsewhere.
  useEffect(() => {
    syncSelection();
  }, [selected, syncSelection]);

  return (
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
  );
}
