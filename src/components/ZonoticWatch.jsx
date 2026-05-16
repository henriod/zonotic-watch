import { useState, useEffect } from "react";

import {
  COUNTIES, SIGNALS, SCRAPE_KEYWORDS, TWITTER_HANDLES,
} from "../data/surveillance.js";
import { runTweetScraper } from "../lib/apify.js";
import { fetchGdeltArticles } from "../lib/gdelt.js";
import { fetchCountyWeather } from "../lib/weather.js";
import { tweetsToSignals, articlesToSignals } from "../lib/signals.js";
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

/** Center-panel tabs: [id, icon, label]. */
const TABS = [
  ["map", "ti-map", "Spatial View"],
  ["weather", "ti-cloud", "Weather Risk"],
  ["config", "ti-settings", "Data Sources"],
];

/**
 * ZonoticWatch dashboard — the layout orchestrator. It owns the shared
 * application state, runs the multi-source ingestion, and composes the
 * feature panels; each panel lives in its own component file.
 */
export default function ZonoticWatch() {
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("map");
  const [analysisText, setAnalysisText] = useState("");
  // Pre-fill from .env (VITE_APIFY_TOKEN) so the scraper works without
  // re-pasting the token; the field stays editable.
  const [apifyToken, setApifyToken] = useState(
    import.meta.env.VITE_APIFY_TOKEN || ""
  );
  const [scraping, setScraping] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState("");
  const [signals, setSignals] = useState(SIGNALS);
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

  // Pull live weather for every county once on mount (Open-Meteo, no key).
  useEffect(() => {
    let cancelled = false;
    fetchCountyWeather(COUNTIES)
      .then(w => { if (!cancelled) setWeather(w); })
      .catch(err => console.error("Weather fetch failed:", err));
    return () => { cancelled = true; };
  }, []);

  // Pull from every configured source and merge results into the feed.
  const handleRefresh = async () => {
    if (scraping) return;
    setScraping(true);
    const collected = [];
    const notes = [];

    // ── Source 1: GDELT news index (free, no key) ──
    try {
      const articles = await fetchGdeltArticles({
        maxRecords: 25,
        onStatus: setScrapeStatus,
      });
      const sigs = articlesToSignals(articles);
      collected.push(...sigs);
      notes.push(`News: ${sigs.length}`);
    } catch (e) {
      notes.push(`News failed (${e.message})`);
    }

    // ── Source 2: Apify Tweet Scraper (needs a token + paid Apify plan) ──
    if (apifyToken) {
      try {
        const items = await runTweetScraper(apifyToken, {
          searchTerms: SCRAPE_KEYWORDS,
          twitterHandles: TWITTER_HANDLES,
          maxItems: 60,
          onStatus: setScrapeStatus,
        });
        // {noResults:true} placeholders come back on free / API runs.
        const usable = (items ?? []).filter(it => it && !it.noResults);
        if (usable.length === 0) {
          notes.push("Apify: 0 (paid plan required)");
        } else {
          const sigs = tweetsToSignals(usable);
          collected.push(...sigs);
          notes.push(`Apify: ${sigs.length}`);
        }
      } catch (e) {
        notes.push(`Apify failed (${e.message})`);
      }
    } else {
      notes.push("Apify: skipped (no token)");
    }

    // ── Merge into the feed, newest first, de-duplicated by id ──
    if (collected.length > 0) {
      setSignals(prev => {
        const seen = new Set(prev.map(s => String(s.id)));
        const fresh = collected.filter(s => !seen.has(String(s.id)));
        return [...fresh, ...prev];
      });
      setScanTime(new Date());
    }
    setScrapeStatus(`Done — +${collected.length} signal(s) · ${notes.join(" · ")}`);
    setScraping(false);
  };

  const totalHuman = COUNTIES.reduce((s, c) => s + c.human, 0);
  const totalAnimal = COUNTIES.reduce((s, c) => s + c.animal, 0);
  const countiesAffected = COUNTIES.filter(c => c.risk > 0.5).length;
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
            {TABS.map(([t, ic, lbl]) => (
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
            <SpatialView selected={selected} onSelect={setSelected} weather={weather} />
          )}
          {tab === "weather" && (
            <WeatherPanel counties={COUNTIES} weather={weather} />
          )}
          {tab === "config" && (
            <DataSourcesPanel
              apifyToken={apifyToken}
              setApifyToken={setApifyToken}
              scraping={scraping}
              scrapeStatus={scrapeStatus}
              onRefresh={handleRefresh}
            />
          )}
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
