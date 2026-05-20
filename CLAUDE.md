# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (`src/`, repo root)

```bash
npm run dev      # Vite dev server on http://localhost:5173 (also opens browser)
npm run build    # production build to dist/
npm run preview  # serve the production build locally
npm run lint     # ESLint over all .js/.jsx
```

Frontend verification = `npm run build` + `npm run lint` both clean (there is **no test suite**).

After editing `vite.config.js` or `.env`, **restart `npm run dev`** — Vite reads both only at startup.

### Backend (`backend/`)

```bash
docker compose up --build                                       # Postgres/PostGIS, Temporal (+UI), FastAPI, worker
docker compose exec backend alembic upgrade head                # apply DB migrations
docker compose exec backend python -m scripts.load_counties     # load 47 GADM polygons
docker compose exec backend python -m scripts.seed_sample_data  # seed sample SIGNALS + COUNTIES
docker compose restart worker                                   # after editing Temporal activities/workflows
```

The backend has no test suite either; verification is `curl` against the endpoints (see `backend/README.md`). The FastAPI container runs `uvicorn --reload`, so router/schema edits hot-reload — **but the Temporal worker does not**, so restart it after changing `temporal/` code.

## Architecture

ZonoticWatch Kenya is a **monorepo**: a Vite 6 + React 18 dashboard (`src/`) and a FastAPI + PostGIS + Temporal backend (`backend/`), wired by a root `docker-compose.yml`. The frontend is now a **thin client** — all ingestion, classification, geocoding, and spatial work happen server-side.

The migration from the original browser-only app is documented in `docs/backend-plan.md` (Phase 1, steps 1–6, is complete; Phase 2 — the real risk model — is steps 7–9).

`VITE_API_BASE` gates the cutover: when set, the dashboard reads from the backend; when blank, it runs fully offline on the `src/data/surveillance.js` seed data.

### Frontend component layout

- `src/components/ZonoticWatch.jsx` — the **layout orchestrator**. Owns shared state (signals, weather, selected county, active tab, refresh status, analyzer input), runs `handleRefresh`, and composes the feature panels. It holds no presentation beyond the grid and the tab bar.
- Each panel is its own component in `src/components/` — `DashboardHeader`, `MetricCards`, `SignalFeed`, `SpatialView` (+ `CountyDetailCard`), `WeatherPanel`, `DataSourcesPanel`, `DiseaseDistribution`, `HumanVsLivestock`, `TrendChart`, `SignalAnalyzer`. Panels that own purely local state keep it internal: `SignalFeed` owns its pagination, `SignalAnalyzer` owns its request state. The analyzer's input text is lifted so a feed-row click can populate it.
- `src/components/KenyaMap.jsx` — MapLibre county map, **lazy-loaded** (`React.lazy`) inside `SpatialView` because MapLibre is ~800 KB; it gets its own chunk.
- Components are styled with **inline `style={{}}` objects** — no CSS modules, no Tailwind. Colors/fonts/radii are CSS custom properties in `src/styles/theme.css`, referenced as `var(--token)`. Re-theming = edit that one file. The shared card-surface style is `panel` in `src/lib/ui.js` (spread as `{ ...panel }`).

### Frontend ↔ backend (`src/lib/`)

- `api.js` — thin backend client: `API_BASE` (from `VITE_API_BASE`), `apiEnabled()`, `apiGet()`, `apiPost()`. When no backend is configured, callers fall back to seed data.
- `weather.js` — Open-Meteo live county weather, called **browser-direct** (free, CORS-OK).
- `ollama.js` — AI Signal Analyzer client. When `VITE_API_BASE` is set, it POSTs to the backend's `/analyze` route (which proxies to Ollama Cloud with the API key kept server-side). When blank, it falls back to a local Ollama at `VITE_OLLAMA_URL` (`/api/chat`, `format:"json"`) for offline dev.
- `risk.js` — risk/severity → color helpers.
- `ui.js` — the shared `panel` card-surface style.

`handleRefresh()` in `ZonoticWatch.jsx` no longer scrapes. It `POST /refresh` to start the backend's Temporal ingestion workflow, polls `GET /refresh/{workflow_id}` to completion, then reloads `GET /signals`. Scraping, classification, geocoding, and de-dup are all server-side.

The **shared signal object** is `{ id, src, handle, text, loc, disease, conf, time, sev }` — the backend's `/signals` response is shaped to match it (`time` is a backend-computed relative label).

### Backend (`backend/`)

A FastAPI app over PostGIS, with Temporal for async ingestion. Layout: `app/{main,config,security}`, `app/db/` (async SQLAlchemy + ORM models), `app/schemas/` (Pydantic), `app/geo/` (`classify.py` keyword classifier — the Python port of the old `signals.js`; `geocode.py` county resolution), `app/routers/` (incl. `auth.py` for invite-only login), `app/temporal/` (client, worker, workflows, activities). `migrations/` holds Alembic revisions; `scripts/` holds one-off loaders.

**Auth:** invite-only login (no public signup) — `app/routers/auth.py` issues an HttpOnly session cookie (`zw_session`), `app/security.py` exposes `require_user`/`require_admin` dependencies, and `app/main.py` lifespan seeds the first admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars when the `users` table is empty. `POST /refresh` and `POST /analyze` (both costly) are login-gated; all read endpoints stay public. See `docs/refresh-access-control.md`.

- **HTTP endpoints are pure DB reads** (`/counties`, `/counties.geojson`, `/signals`, `/trend`, `/diseases`, `/risk`) or *trigger* a workflow and return immediately (`POST /refresh`). Slow/rate-limited work never runs in a request handler. Reads are anonymous; `POST /refresh` and `POST /analyze` require a logged-in session.
- **Ingestion** is the `IngestionWorkflow` Temporal workflow: GDELT and Apify run as independent activity branches (one source failing doesn't abort the other); results are classified, geocoded, and upserted into `signals`. GDELT is called server-to-server (no CORS); the Apify token lives only in backend settings.
- See `backend/README.md` for the endpoint table and run instructions.

### Sample data vs. live data

`src/data/surveillance.js` is the **offline fallback** seed (used when `VITE_API_BASE` is blank). With a backend configured:

- **Live via the backend:** the signal feed (`/signals` — GDELT + Apify ingestion) and the county polygons + risk tint (`/counties.geojson`).
- **Still browser-direct:** county weather (Open-Meteo). The AI analyzer is browser-direct only in offline dev — with `VITE_API_BASE` set it routes through the backend's `/analyze` proxy so the Ollama Cloud API key never reaches the JS bundle.
- **Still static seed:** the 15-day trend chart and the disease-distribution breakdown. The **county risk map** currently shows risk *seeded* into the `county_risk` table — turning raw report volume into computed per-county risk is Phase 2 (`docs/backend-plan.md` steps 7–9), not yet done.
- Map markers and the metric-card totals still derive from the `COUNTIES` seed array — not yet cut over to `/counties`.

A county's `name` matches the GADM `name` property in `public/data/kenya-counties.geojson` (GADM 4.1, level 1) exactly — the map joins on it, and the backend `counties` table stores it alongside a slug `id`. The static GeoJSON stays as the map's offline fallback.

### Conventions

- **Color encoding:** human = red `#b03030`, livestock = blue `#3b82c4`, applied consistently across metric cards, the trend chart, and the Human-vs-livestock card. Severity (CRITICAL/HIGH/MEDIUM/LOW) uses the **ordinal** red→orange→gold→green ramp from `risk.js` — keep that a gradient, not categorical colors. The disease-distribution palette (`DISEASE_PALETTE` in `ZonoticWatch.jsx`) rotates hues so ranked bars stay distinguishable.
- **Minimum font size is 12px** — sub-12px text was removed for accessibility.
- Layout grids (`.metric-grid`, `.main-grid`, `.bottom-grid`) are responsive CSS classes in `index.css`; the rest stays inline.
- Frontend env vars must be `VITE_`-prefixed to reach the browser (see `.env.example`). `.env` is gitignored. The Apify token is **no longer** in the browser bundle — it lives in backend settings only.
- ESLint: `no-unused-vars` ignores `^[A-Z_]` identifiers; `react-refresh/only-export-components` is a warning.
