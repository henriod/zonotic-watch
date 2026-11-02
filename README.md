# ZonoticWatch Kenya

A zoonotic disease early-warning dashboard for Kenya. A FastAPI + PostGIS +
Temporal backend ingests news and social-media signals, classifies and
geocodes them, and computes per-county hotspot risk; a React dashboard shows
the feed, map, weather, trends and an LLM signal analyzer.

> **Status:** live at https://watch.kadiri.app. Everything on the dashboard is
> backed by the database except county weather (browser-direct Open-Meteo).
> Counts are **report volumes**, not clinical cases; the only clinical figure
> is the admin-entered Ministry of Health Ebola number (see
> [Ebola](#ebola-moh-confirmed-figures)).

## Tech stack

- **React 18** + **Vite 6** — UI and build tooling
- **MapLibre GL JS** — interactive county map renderer
- **Recharts** — trend / distribution charts
- **@tabler/icons-webfont** — iconography
- CSS custom-property design tokens (`src/styles/theme.css`)

## Getting started

Requires **Node.js 18+**.

```bash
npm install        # install dependencies
cp .env.example .env   # add API tokens (optional, see below)
npm run dev        # start dev server at http://localhost:5173
```

### Available scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start the Vite dev server (hot reload)   |
| `npm run build`   | Production build to `dist/`              |
| `npm run preview` | Serve the production build locally       |
| `npm run lint`    | Run ESLint over the source               |

## Project structure

```
zoon/
├── index.html              # Vite HTML entry point
├── vite.config.js          # Vite + React plugin config
├── eslint.config.js        # ESLint flat config
├── .env.example            # Template for API tokens
├── public/
│   ├── favicon.svg
│   └── data/
│       └── kenya-counties.geojson  # GADM 4.1 county boundaries
└── src/
    ├── main.jsx            # React bootstrap + global CSS imports
    ├── App.jsx             # App shell wrapper
    ├── components/
    │   ├── ZonoticWatch.jsx  # Main dashboard component
    │   └── KenyaMap.jsx      # MapLibre county map
    ├── data/
    │   └── surveillance.js   # Sample counties / signals / trends
    ├── lib/
    │   └── risk.js           # Risk & severity → color helpers
    └── styles/
        ├── theme.css       # Design tokens (colors, fonts, radii)
        └── index.css       # Global base styles & resets
```

## Map & boundary data

The county map is rendered with **MapLibre GL JS**. MapLibre is only a
renderer — it ships no administrative geometry — so Kenya's 47 county
boundaries come from **[GADM 4.1](https://gadm.org)** (admin level 1),
stored at `public/data/kenya-counties.geojson`.

The basemap is CARTO's **dark-matter** GL style
(`basemaps.cartocdn.com`) — free and requires no API key. County polygons
are inserted beneath the basemap's place labels and tinted by surveillance
risk; the 14 monitored counties also carry a marker sized by case volume.

To refresh the boundary data:

```bash
curl -L -o /tmp/gadm.zip \
  https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_KEN_1.json.zip
# unzip, then keep the `NAME_1` property as `name` and write to
# public/data/kenya-counties.geojson
```

## Live data sources

All ingestion runs **server-side** in the backend's Temporal
`IngestionWorkflow` (`backend/app/temporal/`). Sources run as independent
branches, so one failing does not block the other. Items are classified by
keyword (`backend/app/geo/classify.py` - disease, severity), geocoded to a
county (`backend/app/geo/geocode.py` - coordinates, county names, town
aliases), de-duplicated on insert, and aggregated into weekly county features
and a Getis-Ord Gi* risk score.

Two ways a run starts:

- **Hourly schedule** - the worker creates a Temporal Schedule on startup
  (`INGEST_INTERVAL_MINUTES`, default 60, `0` disables). Scheduled runs pull
  **GDELT only**, so they cost nothing.
- **Manual refresh** - the Data Sources tab's "Pull live signals" button
  (login required) runs GDELT **and** Apify. Repeat clicks attach to the run
  already in progress instead of starting another.

### GDELT - Kenya disease news (free, no setup)

Two queries against the [GDELT 2.0 DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/),
up to 250 articles each: a Kenya-scoped zoonotic query (3-month window) and an
**Ebola / Marburg regional watch** across Kenya and its neighbours (1-month
window). Regional articles that name no Kenyan county are labelled with the
country (Uganda, DR Congo, ...) and excluded from Kenya counts, but stay in
the feed.

### Apify - X/Twitter tweet scraper (paid)

The [`apidojo/tweet-scraper`](https://apify.com/apidojo/tweet-scraper) actor
runs the Kenya keyword queries plus a `from:` filter over verified accounts
(MoH, KEMRI, ILRI, major outlets). The token lives in the backend `.env` as
`APIFY_TOKEN` and is sent as a bearer header, never in a URL. The actor needs
a paid Apify plan (~$0.40 per 1,000 tweets); free runs return nothing.

### Open-Meteo - live county weather (free, no setup)

`src/lib/weather.js` fetches temperature, humidity and today's rainfall for
the monitored counties from the browser. No key, CORS-enabled.

### AI Signal Analyzer - Ollama Cloud via the backend

The panel sends a signal (or any pasted text) to `POST /api/analyze`, which
proxies to Ollama Cloud with `OLLAMA_API_KEY` kept server-side, and renders
the structured assessment. Login required; rate-limited at the proxy. For
offline development without `VITE_API_BASE`, it falls back to a local Ollama
(`VITE_OLLAMA_URL`, `VITE_OLLAMA_MODEL`).

### Ebola - MoH-confirmed figures

Ebola case numbers are sensitive and are **never derived from media volume**.
Admins record each Ministry of Health confirmed figure in the "Ebola (MoH)"
tab with its source; the backend rejects any source that is not an
`@MOH_Kenya` post or a `health.go.ke` page. The "Ebola cases (MoH confirmed)"
card shows the newest entry (a dash when none). Media mentions are shown
separately and labelled as mentions. A filovirus report inside Kenya with
case/screening wording is always classified CRITICAL.

## Production deployment

The app is deployed at **https://watch.kadiri.app**. The whole stack -
Postgres/PostGIS, Temporal (+ UI), the FastAPI backend, the ingestion
worker, and the nginx-served React build - runs from
`docker-compose.prod.yml`.

### Deployment artifacts

| File                     | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `docker-compose.prod.yml`| Production stack (6 services, project name `zonoticwatch`)     |
| `Dockerfile.frontend`    | Multi-stage build: Vite bundle → nginx (`VITE_API_BASE=/api`)  |
| `nginx.conf`             | SPA history fallback + static-asset caching                    |
| `.dockerignore`          | Trims the frontend build context                               |

### Routing

The server runs one shared **Traefik** stack at `/root/proxy` (not in this
repo) that owns host ports 80/443 for every app:

- `frontend` and `backend` join the external `proxy` network (the compose
  file calls it `edge`), so Traefik reaches them by name
  (`zonotic-frontend`, `zonotic-backend`).
- Routes live in `/root/proxy/dynamic/zonotic.yml`: `/api/*` is
  `StripPrefix`-ed and routed to the FastAPI backend; every other path
  serves the static dashboard. Edits hot-reload. HTTPS certs come from
  Let's Encrypt (`/root/proxy/acme/acme.json`).
- The `proxy` network must exist before this stack starts
  (`docker network create proxy`).

### Server state

- Host: `root@213.199.33.173` (SSH key auth), app dir `/root/zonoticwatch/`.
- **The server's `/root/zonoticwatch/.env` is the source of truth for
  production.** It differs from any developer's local `.env` (production
  `ADMIN_*`, `SESSION_SECRET`, `APIFY_TOKEN`, Ollama settings). Never sync a
  local `.env` over it: every rsync below uses `--exclude .env`, and
  `--delete` leaves excluded files alone.
- To change a production env var, edit it on the server
  (`ssh root@213.199.33.173 'nano /root/zonoticwatch/.env'`), then
  `docker compose -f docker-compose.prod.yml up -d` to recreate the
  affected containers.
- Before any rsync, preview it with `-n --itemize-changes` to see exactly
  what will change on the server.

### First-time deploy

```bash
# 1. Sync the repo to the server (excludes node_modules / .git / dist).
#    On the very first deploy only, copy .env separately:
#    scp .env root@<server>:/root/zonoticwatch/.env
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude .claude \
  --exclude __pycache__ --exclude .DS_Store --exclude .env \
  ./ root@<server>:/root/zonoticwatch/

# 2. Build images and start the stack.
ssh root@<server> 'cd /root/zonoticwatch && \
  docker compose -f docker-compose.prod.yml up -d --build'

# 3. Initialise the database (run once).
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml exec backend python -m scripts.load_counties
docker compose -f docker-compose.prod.yml exec backend python -m scripts.load_empres_rvf   # optional RVF history
```

Do **not** run `scripts.seed_sample_data` in production: it inserts
fabricated signals. It exists only for a local demo without ingestion.

Point the subdomain's DNS **A record** at the server before the first
start, so Traefik's Let's Encrypt HTTP challenge succeeds.

### Redeploying after code changes

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude .claude \
  --exclude __pycache__ --exclude .DS_Store --exclude .env \
  ./ root@<server>:/root/zonoticwatch/
ssh root@<server> 'cd /root/zonoticwatch && \
  docker compose -f docker-compose.prod.yml up -d --build'
```

`backend` and `worker` share one image (`zonoticwatch-backend`), so always
rebuild them together - rebuilding only `backend` leaves the worker on the
old image: `docker compose -f docker-compose.prod.yml up -d --build backend worker`.

Re-run `alembic upgrade head` if there are new migrations. The Temporal
worker does **not** hot-reload — `up -d --build` recreates it.

`backend/poetry.lock` is committed and the Dockerfile requires it, so image
rebuilds never re-resolve dependencies (an unlocked rebuild once pulled an
incompatible SQLAlchemy).

### Server ops

- **Backups:** `scripts/backup-db.sh` runs from root's crontab at 02:30
  nightly, writing `pg_dump -Fc` files to `/root/backups/zonoticwatch`
  (14 days kept, log in `/var/log/zw-backup.log`). The dumps live on the
  same box; copy them off once a destination is chosen. Restore:
  `pg_restore -U zonotic -d zonotic --clean --if-exists < <file>.dump`.
  Test a restore into a scratch database first (`CREATE DATABASE
  zw_restore_test`, restore into it, count rows, drop it).
- **Rate limiting:** `deploy/traefik-zonotic.yml` is the source of truth for
  `/root/proxy/dynamic/zonotic.yml`. Login, analyze and refresh are limited
  to 10 requests/min per IP (burst 5); Traefik hot-reloads the file.
- **Ingestion schedule:** inspect with
  `docker exec zonoticwatch-temporal-1 tctl --address temporal:7233 schedule describe --sid ingest-schedule`.

## Design tokens

All colors, fonts, and radii are defined as CSS custom properties in
`src/styles/theme.css`. The component references them via `var(--token)`, so
re-theming (e.g. a dark mode) only requires editing that one file.
