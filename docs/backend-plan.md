# ZonoticWatch Kenya — Backend Implementation Plan (Phases 1 & 2)

> Status: planning. Introduces a FastAPI + PostGIS + Temporal backend, retiring
> the current browser-only architecture. Covers Phase 1 (foundation) and
> Phase 2 (real risk scores). Phase 3+ (Earth-observation / raster layers) is
> out of scope for this document.

## Architectural decisions up front

**Monorepo, not separate dirs.** Add the backend as a sibling top-level
directory `backend/` inside the existing repo. Reasons: the GADM GeoJSON and
the county-name contract (`name` ↔ GADM `name`) are shared assets; a single
repo keeps schema and frontend types in lockstep during migration; deployment
can still target two containers. Recommended layout: repo root holds
`backend/`, the existing `src/` (frontend), and a new `docker-compose.yml`
that brings up Postgres/PostGIS, the Temporal server, the FastAPI app, and the
Temporal worker.

**Async geoprocessing, never inline.** GDELT/Apify ingestion and Gi\* hotspot
computation must not run inside an HTTP request — they are slow, rate-limited,
and retry-prone. All of it lives in Temporal workflows. FastAPI endpoints only
ever read pre-computed rows from PostGIS (fast) or *trigger* a workflow and
return immediately.

**Keep the frontend alive throughout.** Migration is staged behind a single
env flag (`VITE_API_BASE`). While the backend is incomplete, `src/lib/*.js`
functions keep their current browser-direct behavior; each is swapped one at a
time to call the backend, and `surveillance.js` seed data stays as the
fallback until the corresponding endpoint is proven. Ollama stays
browser-direct in both phases (it is localhost-only, no CORS/token problem) —
it is explicitly out of scope.

---

## 1. FastAPI service layout

Directory `backend/` (Python 3.12, managed with `uv` or `poetry`):

```
backend/
  pyproject.toml
  alembic.ini
  Dockerfile
  app/
    main.py              # FastAPI app factory, CORS middleware, router mounting
    config.py            # pydantic-settings: DB URL, Temporal address, API keys
    db/
      session.py         # async SQLAlchemy engine + async_sessionmaker, get_session dependency
      base.py            # DeclarativeBase
      models.py          # ORM models (counties, signals, ingest_runs, county_week_features, county_risk)
    schemas/
      signal.py          # Pydantic response models matching the frontend signal object
      county.py          # county + risk response models
      geojson.py         # GeoJSON FeatureCollection response model
    routers/
      health.py          # GET /health, GET /health/temporal
      signals.py         # GET /signals, POST /refresh
      counties.py        # GET /counties, GET /counties.geojson, GET /counties/{id}
      weather.py         # GET /weather  (optional proxy; see frontend section)
      analytics.py       # GET /risk, GET /trend, GET /diseases
    geo/
      geocode.py         # PostGIS point-in-polygon + place-name -> county resolution
      classify.py        # Python port of signals.js keyword classifier
    temporal/
      client.py          # singleton Temporal client (for triggering from routers)
      workflows.py       # workflow definitions
      activities.py      # activity functions
      worker.py          # worker entrypoint process (separate container)
  migrations/            # Alembic revisions; first revision enables PostGIS + seeds counties
  scripts/
    load_counties.py     # one-off: load kenya-counties.geojson geometry into counties table
```

### Endpoint list

| Method | Path | Purpose | Backed by |
|---|---|---|---|
| GET | `/health` | liveness | — |
| GET | `/signals?limit=&since=&county=` | signal feed, newest-first | `signals` table |
| POST | `/refresh` | trigger an ingestion run; returns `{workflow_id, run_id}` | starts `IngestionWorkflow` |
| GET | `/refresh/{workflow_id}` | poll ingestion status | Temporal `describe` |
| GET | `/counties` | county list + current risk + case counts | `counties` ⋈ `county_risk` |
| GET | `/counties.geojson` | GADM polygons + current risk as feature properties | `ST_AsGeoJSON` over `counties` |
| GET | `/counties/{id}` | detail (weather, latest signals, risk history) | joins |
| GET | `/risk?week=` | per-county risk scores for a week | `county_risk` |
| GET | `/trend?days=` | human/animal/RVF case trend | aggregate over `county_week_features` |
| GET | `/diseases` | disease distribution breakdown | aggregate over `signals` |
| GET | `/weather` | live county weather (optional proxy) | Open-Meteo passthrough |

**Serving GeoJSON to the frontend:** `/counties.geojson` runs `ST_AsGeoJSON`
per row and assembles a `FeatureCollection` with `name`, `countyId`, `risk` in
`properties` — exactly the shape `KenyaMap.jsx` already expects from
`public/data/kenya-counties.geojson`. The static file in `public/data/` can
stay as an offline fallback but the live map repoints to this endpoint so risk
is dynamic.

**CORS:** FastAPI `CORSMiddleware` allowing the Vite dev origin
(`http://localhost:5173`) and the production frontend origin. This is the
structural fix for the GDELT-CORS problem — the browser now only ever talks to
our own backend.

---

## 2. PostGIS schema

First Alembic migration: `CREATE EXTENSION IF NOT EXISTS postgis;`

**`counties`** — the 47 GADM polygons (superset of the 14 monitored).

```
id            text PRIMARY KEY        -- slug, e.g. "nairobi"; matches COUNTIES[].id
name          text UNIQUE NOT NULL    -- GADM `name`; the join key
centroid      geography(Point,4326)   -- lat/lng for markers + Open-Meteo
geom          geometry(MultiPolygon,4326) NOT NULL
monitored     boolean NOT NULL DEFAULT false
GIST INDEX on geom        -- spatial join / point-in-polygon
GIST INDEX on centroid
```

**`signals`** — geocoded ingested signals (replaces `SIGNALS` seed).

```
id            text PRIMARY KEY        -- source-stable id (tweet id / "gdelt-"+url)
src           text NOT NULL           -- "News" | "X/Twitter" | "X · verified"
handle        text
text          text NOT NULL
disease       text
severity      text                    -- CRITICAL|HIGH|MEDIUM|LOW
confidence    real
county_id     text REFERENCES counties(id)   -- resolved by spatial join, nullable
loc_name      text                    -- raw matched place string ("Kenya" fallback)
geom          geography(Point,4326)   -- geocoded point, nullable
event_time    timestamptz NOT NULL    -- real timestamp (frontend computes "2m" client-side)
ingest_run_id uuid REFERENCES ingest_runs(id)
created_at    timestamptz DEFAULT now()
INDEX on (event_time DESC), INDEX on county_id, INDEX on disease
```

Note: `time` in the current signal object is a *relative string*; the backend
stores absolute `event_time` and the frontend (or a Pydantic computed field)
renders the relative label.

**`ingest_runs`** — one row per Temporal ingestion run, for observability.

```
id            uuid PRIMARY KEY
workflow_id   text
started_at    timestamptz
finished_at   timestamptz
status        text                    -- RUNNING|SUCCEEDED|FAILED|PARTIAL
gdelt_count   int
apify_count   int
notes         jsonb                   -- per-source notes, mirrors current `notes[]`
```

**`county_week_features`** — Phase 2 analytics join point (county × ISO week).

```
county_id        text REFERENCES counties(id)
week_start       date                 -- ISO week Monday
signal_count     int
human_cases      int
animal_cases     int
disease_breakdown jsonb
mean_severity    real                 -- severity mapped to ordinal score
weather_temp     real
weather_rain     real
weather_humidity real
PRIMARY KEY (county_id, week_start)
```

**`county_risk`** — Phase 2 computed risk output.

```
county_id     text REFERENCES counties(id)
week_start    date
risk          real                    -- 0-1, replaces COUNTIES[].risk
gi_star_z     real                    -- Getis-Ord Gi* z-score
gi_p_value    real
method        text                    -- "getis_ord" | "kriging" | "blended"
computed_at   timestamptz
PRIMARY KEY (county_id, week_start)
```

The map reads the latest `week_start` per county.

**Relationships:** `signals.county_id`, `county_week_features.county_id`,
`county_risk.county_id` all FK to `counties.id`. `county_week_features` is the
deliberate single join point between raw ingestion and analytics — Gi\* reads
from it, writes to `county_risk`.

---

## 3. Temporal workflow definitions

Worker runs as its own container/process (`temporal/worker.py`) registering
all workflows and activities on one task queue (`zonoticwatch`).

### Workflow A — `IngestionWorkflow`

Replaces `handleRefresh()`'s fan-out. Triggered by `POST /refresh` and by a
Temporal **Schedule** (every 30 min, matching GDELT's ~15-min reindex cadence
with headroom).

Activities:

1. `create_ingest_run()` → inserts an `ingest_runs` row, returns id.
2. `fetch_gdelt(timespan, max_records)` → server-side call to GDELT DOC API.
   **No CORS problem — server-to-server.** Returns raw articles.
3. `fetch_apify(search_terms, handles, max_items)` → starts the apidojo actor,
   polls to terminal state, pulls dataset items. **Token read from backend
   settings, never in browser.** Long activity: heartbeat each poll,
   `start_to_close_timeout` ~10 min.
4. `classify_and_geocode(raw_items, source)` → runs the Python-ported
   classifier (`geo/classify.py`) for disease/severity/confidence, then
   `geo/geocode.py` for county resolution. Returns normalized signal rows.
5. `upsert_signals(rows, ingest_run_id)` → `INSERT ... ON CONFLICT (id) DO
   NOTHING` — replaces the client-side de-dup-by-id.
6. `finalize_ingest_run(id, counts, notes)` → status + counts.
7. On success, **start `RiskComputationWorkflow` as a child workflow** (or
   signal it) so new signals immediately flow into risk.

Retry strategy: GDELT/Apify activities get a `RetryPolicy` with exponential
backoff, `non_retryable_error_types=[]` except auth failures; GDELT 429 is
explicitly retryable with a longer initial interval (~60s) — this is the
durable fix for the current "wait ~1 min and retry" manual handling.
`fetch_gdelt` and `fetch_apify` run as independent activity branches so one
source failing doesn't abort the other (preserves today's "each source fails
independently" behavior); failures are recorded in `notes`.

### Workflow B — `RiskComputationWorkflow` (Phase 2)

Triggered as a child of `IngestionWorkflow` on a new signal batch, and on a
daily Schedule.

Activities:

1. `rebuild_week_features(week_start)` → aggregates `signals` (+ joined
   weather) into `county_week_features` for affected weeks.
2. `compute_getis_ord(week_start)` → loads county centroids +
   `signal_count`/`mean_severity` from `county_week_features`, builds a spatial
   weights matrix with **PySAL/libpysal** (queen contiguity from
   `counties.geom`, or distance band), runs `esda.G_Local` (Getis-Ord Gi\*).
   Returns z-scores + p-values per county. CPU-bound — keep it an activity with
   a generous timeout, not in the workflow code.
3. `compute_kriging(week_start)` *(optional/blended)* →
   `pykrige.OrdinaryKriging` over centroid points to interpolate a continuous
   risk surface, sampled back at centroids; useful where Gi\* is sparse.
4. `normalize_risk(gi_results, kriging_results)` → maps z-scores (and/or kriged
   values) to a 0-1 `risk` score with a fixed monotonic transform, so it stays
   compatible with `riskColor()` thresholds (0.45/0.65/0.85).
5. `write_county_risk(rows, week_start)` → upsert into `county_risk`.

Retry: analytics activities are pure/idempotent — standard retry policy, safe
to re-run. Workflow is idempotent on `week_start` so re-triggers just
recompute.

### Spatial geocoding (replaces `detectCounty()`)

`geo/geocode.py` resolves a signal to a county in two tiers:

1. **Place-name → polygon:** extract candidate place tokens from the text; look
   them up against a `county_aliases` table (county names + known towns) and
   resolve to `counties.id`. This generalizes the current brittle substring
   match to all 47 counties + sub-county towns.
2. **Point-in-polygon:** when the source provides coordinates (some
   GDELT/tweet metadata does) or a town is geocoded to a point, run
   `SELECT id FROM counties WHERE ST_Contains(geom, ST_SetSRID(ST_Point(lng,lat),4326))`.
   The GIST index on `geom` makes this fast.

Fallback remains `"Kenya"` (NULL `county_id`) when nothing resolves — same
semantics as today, but now spatially correct when location data exists.

---

## 4. Frontend repoint

Single new env var `VITE_API_BASE` (e.g. `http://localhost:8000`). New thin
module `src/lib/api.js` wraps `fetch(`${VITE_API_BASE}${path}`)` with JSON
parsing and error handling.

- **`src/lib/gdelt.js` — delete the direct GDELT call.** GDELT is now
  server-side only. Either remove the file or repurpose it as a no-op;
  ingestion is no longer a browser concern.
- **`src/lib/apify.js` — delete.** The actor run/poll loop and the exposed
  token both move into `temporal/activities.py`. The Apify token leaves the
  browser bundle entirely (remove `VITE_APIFY_TOKEN` from `.env`/`.env.example`).
- **`src/lib/signals.js` — gut, keep only display helpers.**
  `tweetsToSignals`/`articlesToSignals`, `detectCounty`, `detectDisease`,
  `detectSeverity` move to `backend/app/geo/classify.py`. The frontend keeps
  only `relativeTime()` (to render `event_time` → "2m") unless the backend
  supplies a computed relative label. The classifier logic is now authored
  once, server-side.
- **`src/lib/weather.js`** — optional. Open-Meteo is free + CORS-OK, so it can
  stay browser-direct. For consistency, repoint `fetchCountyWeather()` to
  `GET /weather`; low priority.
- **`src/lib/ollama.js`** — unchanged. Localhost LLM, no CORS/token issue,
  explicitly out of scope.
- **`src/data/surveillance.js`** — `COUNTIES`, `SIGNALS`, `TREND`, `DISEASES`
  become *seed/fallback only*. `SCRAPE_KEYWORDS`/`TWITTER_HANDLES` move to
  backend config (they configure the Apify activity). After cutover the file
  can shrink to just static lookups the UI still needs (e.g. county centroids
  for the map markers, until those come from `/counties`).
- **`src/components/ZonoticWatch.jsx`** — the orchestrator changes most:
  - `useState(SIGNALS)` → fetch `GET /signals` on mount.
  - `handleRefresh()` no longer fans out to GDELT/Apify. It now `POST /refresh`
    to start `IngestionWorkflow`, then polls `GET /refresh/{workflow_id}` for
    status (drives `scrapeStatus`), and re-fetches `GET /signals` on
    completion. The merge-and-dedup logic is deleted (the backend's
    `ON CONFLICT` handles it).
  - `apifyToken` state and the `DataSourcesPanel` token input are removed — the
    token is server-side. `DataSourcesPanel` becomes a status/keywords display.
  - `countiesAffected`/`totalHuman`/`totalAnimal` derive from `/counties`
    instead of the static array.
- **`KenyaMap.jsx` / `SpatialView.jsx`** — `COUNTIES_URL` repoints from
  `data/kenya-counties.geojson` to `${VITE_API_BASE}/counties.geojson`; the
  `risk` property is now backend-computed (Phase 2). The static GeoJSON in
  `public/data/` stays as an offline fallback.
- **`vite.config.js`** — **remove the `/gdelt` proxy block entirely.** The
  browser no longer calls GDELT. No proxy replaces it: the browser calls our
  FastAPI backend directly via `VITE_API_BASE` with proper CORS headers. This
  eliminates the dev-only/prod-broken split that `gdelt.js` currently has.

---

## 5. Migration / rollout order

Each step leaves the app fully working.

1. **Scaffold infra.** Add `backend/`, `docker-compose.yml` (Postgres+PostGIS,
   Temporal, FastAPI, worker). FastAPI exposes only `/health`. Frontend
   untouched.
2. **Schema + county load.** Alembic migration creates the schema;
   `scripts/load_counties.py` loads all 47 GADM polygons + centroids from
   `kenya-counties.geojson`, marking the 14 monitored. Verify `name` matches
   the frontend contract exactly.
3. **Read endpoints, frontend still on seed data.** Implement `/counties`,
   `/counties.geojson`, `/signals` over seeded rows (port `SIGNALS`/`COUNTIES`
   into the DB once). Verifiable independently via curl; frontend unchanged.
4. **Ingestion workflow.** Port the classifier to `geo/classify.py`, implement
   `IngestionWorkflow` + activities, the geocoder, and `POST /refresh`. Run it;
   confirm real signals land in `signals` with correct `county_id`. Frontend
   still uses its own `handleRefresh`.
5. **Frontend cutover — reads.** Add `src/lib/api.js` and `VITE_API_BASE`.
   Point `ZonoticWatch.jsx` signal load and `KenyaMap` GeoJSON at the backend.
   Keep `surveillance.js` as fallback if `VITE_API_BASE` is unset — so an
   un-configured checkout still runs.
6. **Frontend cutover — refresh.** Repoint `handleRefresh()` to `POST /refresh`
   + poll. Delete `apify.js`, gut `gdelt.js`/`signals.js`, remove the `/gdelt`
   proxy and `VITE_APIFY_TOKEN`. End of Phase 1: the dashboard is a thin
   client; CORS, exposed-token, and 429 problems are all gone.
7. **Phase 2 — feature table.** Implement `rebuild_week_features` and
   `RiskComputationWorkflow`'s aggregation half; populate
   `county_week_features`. `/trend` and `/diseases` switch off seed data.
8. **Phase 2 — risk model.** Add `compute_getis_ord` (+ optional
   `compute_kriging`), `normalize_risk`, `write_county_risk`. Wire
   `RiskComputationWorkflow` as a child of `IngestionWorkflow` and on a daily
   schedule.
9. **Retire static risk.** `/counties.geojson` and `/counties` now serve
   `county_risk.risk`. Remove `risk` from `COUNTIES` in `surveillance.js`. The
   map shows live, model-computed risk.

---

## 6. Critical files and trade-offs

**Trade-offs:**

- *Frontend continuity:* gated entirely on `VITE_API_BASE` + keeping
  `surveillance.js` as fallback. No step removes a frontend capability before
  its backend replacement is verified by curl.
- *Monorepo vs separate dir:* monorepo chosen — the GADM file and the `name`
  join contract are shared; one PR can change schema + frontend together. Cost
  is a heterogeneous repo (Node + Python), mitigated by the clean `backend/`
  boundary and separate Dockerfiles.
- *Sync vs async geoprocessing:* all ingestion and Gi\*/kriging run in Temporal
  activities, never in an HTTP handler. HTTP endpoints are pure DB reads, so
  the dashboard stays responsive regardless of GDELT/Apify latency or rate
  limits; durability/retry/observability come from Temporal rather than ad-hoc
  client-side try/catch.
- *Classifier ownership:* the keyword classifier is ported to Python and
  authored once server-side, eliminating the current duplication risk and
  letting the geocoder use PostGIS instead of brittle substring matching.

**Critical files for implementation:**

- `backend/app/temporal/workflows.py`
- `backend/app/db/models.py`
- `backend/app/geo/geocode.py`
- `src/components/ZonoticWatch.jsx`
- `src/lib/signals.js`
