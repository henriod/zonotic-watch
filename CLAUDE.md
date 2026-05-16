# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173 (also opens browser)
npm run build    # production build to dist/
npm run preview  # serve the production build locally
npm run lint     # ESLint over all .js/.jsx
```

There is **no test suite**. Verification = `npm run build` + `npm run lint` both clean.

After editing `vite.config.js` or `.env`, **restart `npm run dev`** — Vite reads both only at startup.

## Architecture

ZonoticWatch Kenya is a **browser-only** React dashboard (Vite 6 + React 18). There is no backend: every external API is called directly from the browser. This constraint shapes most decisions below.

### Component layout

- `src/components/ZonoticWatch.jsx` — the **layout orchestrator**. Owns shared state (signals, weather, selected county, active tab, scraper status, analyzer input), runs `handleRefresh`, and composes the feature panels. It holds no presentation beyond the grid and the tab bar.
- Each panel is its own component in `src/components/` — `DashboardHeader`, `MetricCards`, `SignalFeed`, `SpatialView` (+ `CountyDetailCard`), `WeatherPanel`, `DataSourcesPanel`, `DiseaseDistribution`, `HumanVsLivestock`, `TrendChart`, `SignalAnalyzer`. Panels that own purely local state keep it internal: `SignalFeed` owns its pagination, `SignalAnalyzer` owns its request state. The analyzer's input text is lifted so a feed-row click can populate it.
- `src/components/KenyaMap.jsx` — MapLibre county map, **lazy-loaded** (`React.lazy`) inside `SpatialView` because MapLibre is ~600 KB; it gets its own chunk.
- Components are styled with **inline `style={{}}` objects** — no CSS modules, no Tailwind. Colors/fonts/radii are CSS custom properties in `src/styles/theme.css`, referenced as `var(--token)`. Re-theming = edit that one file. The shared card-surface style is `panel` in `src/lib/ui.js` (spread as `{ ...panel }`).

### The data pipeline (`src/lib/`)

Each file in `src/lib/` wraps one external integration; `signals.js` is the classifier that unifies their output:

- `apify.js` — runs the Apify `apidojo~tweet-scraper` actor (X/Twitter). **Requires a paid Apify plan**; free runs return `{noResults:true}` placeholders.
- `gdelt.js` — GDELT 2.0 news index. GDELT sends **no CORS headers**, so in dev it goes through the Vite proxy (`/gdelt/*` → `api.gdeltproject.org`, configured in `vite.config.js`); a production build would CORS-fail and needs a real server-side proxy.
- `weather.js` — Open-Meteo live county weather (free, CORS-OK).
- `ollama.js` — local Ollama LLM for the AI Signal Analyzer (`/api/chat`, `format:"json"`). No key, runs on the user's machine.
- `signals.js` — `tweetsToSignals()` / `articlesToSignals()` convert raw scraped items into the **shared signal object**: `{ id, src, handle, text, loc, disease, conf, time, sev }`. Keyword-based disease/county/severity classification. Tweets from verified accounts (`TWITTER_HANDLES`) bypass the relevance gate and are tagged `"X · verified"`.
- `risk.js` — risk/severity → color helpers.

`handleRefresh()` in `ZonoticWatch.jsx` fans out to all sources, each failing independently (one source down doesn't block others), and merges results into the feed de-duplicated by `id`.

### Sample data vs. live data

`src/data/surveillance.js` holds **seed data**. Know which parts are live:

- **Live:** the signal feed (GDELT + Apify), county weather (Open-Meteo), the AI analyzer (Ollama).
- **Static seed:** the 15-day trend chart, the disease distribution breakdown, and — importantly — the **county risk map**. Turning raw report volume into per-county risk scores needs a real model and is out of scope; the map still renders sample `risk` values.

A county's `name` in `COUNTIES` must match the GADM `NAME_1` property exactly — the map joins on it. Boundary geometry lives in `public/data/kenya-counties.geojson` (GADM 4.1, level 1).

### Conventions

- **Color encoding:** human = red `#b03030`, livestock = blue `#3b82c4`, applied consistently across metric cards, the trend chart, and the Human-vs-livestock card. Severity (CRITICAL/HIGH/MEDIUM/LOW) uses the **ordinal** red→orange→gold→green ramp from `risk.js` — keep that a gradient, not categorical colors. The disease-distribution palette (`DISEASE_PALETTE` in `ZonoticWatch.jsx`) rotates hues so ranked bars stay distinguishable.
- **Minimum font size is 12px** — sub-12px text was removed for accessibility.
- Layout grids (`.metric-grid`, `.main-grid`, `.bottom-grid`) are responsive CSS classes in `index.css`; the rest stays inline.
- Env vars must be `VITE_`-prefixed to reach the browser (see `.env.example`). `.env` is gitignored; the Apify token in it is exposed in the bundle — acceptable for a prototype only.
- ESLint: `no-unused-vars` ignores `^[A-Z_]` identifiers; `react-refresh/only-export-components` is a warning.
