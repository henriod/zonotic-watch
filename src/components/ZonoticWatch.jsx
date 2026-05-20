import { useState, useEffect, useMemo } from "react";

import { COUNTIES, SIGNALS } from "../data/surveillance.js";
import { fetchCountyWeather } from "../lib/weather.js";
import { apiEnabled, apiGet, apiPost } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { panel } from "../lib/ui.js";

import DashboardHeader from "./DashboardHeader.jsx";
import MetricCards from "./MetricCards.jsx";
import SignalFeed from "./SignalFeed.jsx";
import SpatialView from "./SpatialView.jsx";
import WeatherPanel from "./WeatherPanel.jsx";
import DataSourcesPanel from "./DataSourcesPanel.jsx";
import DiseaseDistribution from "./DiseaseDistribution.jsx";
import HumanVsLivestock from "./HumanVsLivestock.jsx";
import TrendChart from "./TrendChart.jsx";
import SignalAnalyzer from "./SignalAnalyzer.jsx";
import UserAdmin from "./UserAdmin.jsx";

/** Center-panel tabs: [id, icon, label, adminOnly]. */
const TABS = [
  ["map", "ti-map", "Spatial View"],
  ["weather", "ti-cloud", "Weather Risk"],
  ["config", "ti-settings", "Data Sources"],
  ["users", "ti-users", "Users", true],
];

/**
 * ZonoticWatch dashboard — the layout orchestrator. It owns the shared
 * application state, runs the multi-source ingestion, and composes the
 * feature panels; each panel lives in its own component file.
 */
export default function ZonoticWatch() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const visibleTabs = TABS.filter(([, , , adminOnly]) => !adminOnly || isAdmin);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("map");
  const [analysisText, setAnalysisText] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState("");
  const [signals, setSignals] = useState(SIGNALS);
  const [counties, setCounties] = useState(COUNTIES);
  const [weather, setWeather] = useState({});
  const [pulse, setPulse] = useState(false);
  const [scanTime, setScanTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => {
      setScanTime(new Date());
      setPulse(p => !p);
    }, 15000);
    return () => clearInterval(t);
  }, []);

  // Load counties from the backend (falling back to the seed array), then
  // fetch live weather for the monitored subset (Open-Meteo, no key).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cs = COUNTIES;
      if (apiEnabled()) {
        try {
          cs = await apiGet("/counties");
        } catch (err) {
          console.error("Counties fetch failed; using seed data:", err);
        }
      }
      if (cancelled) return;
      setCounties(cs);
      fetchCountyWeather(cs.filter(c => c.monitored !== false))
        .then(w => { if (!cancelled) setWeather(w); })
        .catch(err => console.error("Weather fetch failed:", err));
    })();
    return () => { cancelled = true; };
  }, []);

  // When a backend is configured, load the live signal feed on mount.
  // Otherwise the SIGNALS seed (the initial state) stands in unchanged.
  useEffect(() => {
    if (!apiEnabled()) return;
    let cancelled = false;
    apiGet("/signals?limit=100")
      .then(s => { if (!cancelled) setSignals(s); })
      .catch(err =>
        console.error("Signal feed fetch failed; using seed data:", err)
      );
    return () => { cancelled = true; };
  }, []);

  // Trigger a server-side ingestion run, poll it to completion, then
  // reload the feed. Scraping, classification, geocoding, and de-dup all
  // happen in the backend's Temporal workflow — this is just a thin client.
  const handleRefresh = async () => {
    if (scraping) return;
    if (!apiEnabled()) {
      setScrapeStatus("No backend configured — set VITE_API_BASE to ingest.");
      return;
    }
    setScraping(true);
    setScrapeStatus("Starting ingestion run…");
    try {
      const { workflow_id } = await apiPost("/refresh");

      let status = "RUNNING";
      let result = null;
      for (let i = 0; i < 120 && status === "RUNNING"; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const poll = await apiGet(`/refresh/${workflow_id}`);
        status = poll.status;
        result = poll.result;
        setScrapeStatus(`Ingestion ${status.toLowerCase()}…`);
      }

      if (status === "COMPLETED" && result) {
        setSignals(await apiGet("/signals?limit=100"));
        setScanTime(new Date());
        const notes = Object.entries(result.notes ?? {})
          .map(([src, n]) => `${src}: ${n}`)
          .join(" · ");
        setScrapeStatus(`Done — +${result.inserted} signal(s) · ${notes}`);
      } else {
        setScrapeStatus(`Ingestion ${status.toLowerCase()}`);
      }
    } catch (e) {
      setScrapeStatus(`Refresh failed: ${e.message}`);
    } finally {
      setScraping(false);
    }
  };

  // Monitored subset (seed counties carry no flag and are all monitored).
  const monitoredCounties = useMemo(
    () => counties.filter(c => c.monitored !== false),
    [counties],
  );
  const totalHuman = counties.reduce((s, c) => s + (c.human || 0), 0);
  const totalAnimal = counties.reduce((s, c) => s + (c.animal || 0), 0);
  const countiesAffected = counties.filter(c => c.risk > 0.5).length;
  const critCount = signals.filter(s => s.sev === "CRITICAL").length;
  const highCount = signals.filter(s => s.sev === "HIGH").length;
  const overallRisk = critCount > 0 ? "CRITICAL" : highCount >= 3 ? "HIGH" : "ELEVATED";
  const overallRiskColor = critCount > 0 ? "#b03030" : "#c07020";

  return (
    <div style={{ fontFamily:"var(--font-sans)", color:"var(--color-text-primary)", paddingBottom:"2rem" }}>
      <h2 className="sr-only">ZonoticWatch Kenya — Zoonotic Disease Early Warning Dashboard</h2>

      <DashboardHeader
        overallRisk={overallRisk}
        overallRiskColor={overallRiskColor}
        signalCount={signals.length}
        scanTime={scanTime}
        pulse={pulse}
        user={user}
        onLogout={logout}
      />

      <MetricCards
        totalHuman={totalHuman}
        totalAnimal={totalAnimal}
        countiesAffected={countiesAffected}
        critCount={critCount}
      />

      {/* MAIN 3-COLUMN GRID */}
      <div className="main-grid">

        {/* ── LEFT: Signal Feed ── */}
        <SignalFeed
          signals={signals}
          onSelect={s => { setAnalysisText(s.text); setTab("map"); }}
        />

        {/* ── CENTER: Map / Weather / Config tabs ── */}
        <div style={{ ...panel, overflow:"hidden" }}>
          <div style={{ display:"flex", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
            {visibleTabs.map(([t, ic, lbl]) => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex:1, padding:"0.55rem", fontSize:12, fontWeight: tab===t ? 500 : 400,
                background: tab===t ? "var(--color-background-secondary)" : "transparent",
                border:"none", borderBottom: tab===t ? "2px solid var(--color-border-info)" : "2px solid transparent",
                cursor:"pointer", color: tab===t ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                display:"flex", alignItems:"center", justifyContent:"center", gap:5,
              }}>
                <i className={`ti ${ic}`} style={{ fontSize:13 }} aria-hidden="true" />
                {lbl}
              </button>
            ))}
          </div>

          {tab === "map" && (
            <SpatialView
              selected={selected}
              onSelect={setSelected}
              weather={weather}
              counties={monitoredCounties}
            />
          )}
          {tab === "weather" && (
            <WeatherPanel counties={monitoredCounties} weather={weather} />
          )}
          {tab === "config" && (
            <DataSourcesPanel
              scraping={scraping}
              scrapeStatus={scrapeStatus}
              onRefresh={handleRefresh}
            />
          )}
          {tab === "users" && isAdmin && <UserAdmin currentUser={user} />}
        </div>

        {/* ── RIGHT: Disease breakdown ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <DiseaseDistribution />
          <HumanVsLivestock totalHuman={totalHuman} totalAnimal={totalAnimal} />
        </div>
      </div>

      {/* BOTTOM: Trend + AI Analysis */}
      <div className="bottom-grid">
        <TrendChart />
        <SignalAnalyzer
          text={analysisText}
          setText={setAnalysisText}
          selectedCounty={selected?.name}
        />
      </div>
    </div>
  );
}
