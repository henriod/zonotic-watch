# ZonoticWatch Kenya

A zoonotic disease early-warning dashboard for Kenya. It visualises disease
signals scraped from social media and news feeds, overlays weather-driven
transmission risk on a county map, and analyses raw signal text with a local LLM.

> **Status:** prototype. Trends and the disease breakdown are seeded with
> sample data. The signal feed, county weather, and the signal analyzer pull
> live data (see [Live data sources](#live-data-sources)).

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

The **Data Sources** tab's "Pull live signals" button queries every
configured source, classifies each item (`src/lib/signals.js` — disease,
county, severity by keyword), and merges the results into the **Live Signal
Feed**. Sources fail independently — one being unavailable doesn't block the
others. All calls are **browser-only** (no backend); a production deployment
should proxy them so credentials stay server-side.

### GDELT — Kenya disease news (free, no setup)

`src/lib/gdelt.js` queries the [GDELT 2.0 DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)
for recent news about Kenya zoonotic disease. GDELT re-indexes worldwide news
every ~15 minutes. It needs **no API key, no registration, no plan** and is
CORS-enabled — it works out of the box. Duplicate syndicated headlines are
collapsed in `articlesToSignals()`.

### Open-Meteo — live county weather (free, no setup)

`src/lib/weather.js` fetches current temperature, humidity, and today's
rainfall for all 14 counties in one request from the
[Open-Meteo API](https://open-meteo.com) — free, no key, CORS-enabled. The
**Weather Risk** tab and the map's county detail card use this live data,
falling back to the seeded `wx` sample values until the fetch resolves (a
badge shows which is in use). Weather is loaded once on mount.

### Apify — X/Twitter tweet scraper

`src/lib/apify.js` runs the [`apidojo/tweet-scraper`](https://apify.com/apidojo/tweet-scraper)
actor with the Kenya keyword queries (`SCRAPE_KEYWORDS`). Set the token in
`.env` as `VITE_APIFY_TOKEN`.

⚠️ **This actor requires a paid Apify plan.** On the free plan / via the API
it returns only `{noResults:true}` placeholders — the app reports this
explicitly. On a paid plan it bills **~$0.40 per 1,000 tweets**.

### AI Signal Analyzer — local Ollama (free, private)

The **AI Signal Analyzer** panel sends a signal to a model running locally
via [Ollama](https://ollama.com) (`src/lib/ollama.js`) and gets back a
structured assessment — disease, severity, hosts, recommended actions, etc.
No API key, no cost, and the text never leaves your machine. Ollama allows
CORS from localhost, so the browser calls it directly.

Setup: install Ollama, then `ollama pull gemma4`. Override the host/model
with `VITE_OLLAMA_URL` / `VITE_OLLAMA_MODEL` in `.env` (defaults:
`http://localhost:11434`, `gemma4:latest`). If Ollama isn't running the
panel shows a clear error.

> Note: live signals flow into the *feed* and the header counts. The county
> risk **map** still uses sample data — turning raw report/tweet volume into
> per-county risk scores needs a real model, which is out of scope here.

## Production deployment

The app is deployed at **https://watch.kadiri.app** on a shared server that
already runs other applications. The whole stack — Postgres/PostGIS,
Temporal (+ UI), the FastAPI backend, the ingestion worker, and the
nginx-served React build — runs from `docker-compose.prod.yml`.

### Deployment artifacts

| File                     | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `docker-compose.prod.yml`| Production stack (6 services, project name `zonoticwatch`)     |
| `Dockerfile.frontend`    | Multi-stage build: Vite bundle → nginx (`VITE_API_BASE=/api`)  |
| `nginx.conf`             | SPA history fallback + static-asset caching                    |
| `.dockerignore`          | Trims the frontend build context                               |

### How it fits on the shared server

Ports 80/443 belong to another app's **Traefik** reverse proxy, so
ZonoticWatch publishes **no public ports**. Instead:

- The `frontend` and `backend` containers join that Traefik's Docker
  network (the external network `pemost_core_api_default`), so Traefik can
  reach them by name (`zonotic-frontend`, `zonotic-backend`).
- Two routers are added to that Traefik's file config for
  `watch.kadiri.app`: `/api/*` is `StripPrefix`-ed and routed to the
  FastAPI backend; every other path serves the static dashboard. HTTPS is
  issued via the existing Let's Encrypt resolver.
- The database service is named **`zw-postgres`** (not `postgres`) — the
  backend sits on the shared Traefik network, where the other app's own
  `postgres` service would otherwise collide on that hostname.

### First-time deploy

```bash
# 1. Sync the repo to the server (includes .env for APIFY_TOKEN;
#    excludes node_modules / .git / dist).
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude .claude \
  --exclude __pycache__ \
  ./ root@<server>:/root/zonoticwatch/

# 2. Build images and start the stack.
ssh root@<server> 'cd /root/zonoticwatch && \
  docker compose -f docker-compose.prod.yml up -d --build'

# 3. Initialise the database (run once).
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml exec backend python -m scripts.load_counties
docker compose -f docker-compose.prod.yml exec backend python -m scripts.seed_sample_data
```

Then point the subdomain's DNS **A record** at the server and add the
`watch.kadiri.app` routers/middleware/services to the shared Traefik
config (it watches its config file, so the change hot-reloads — back the
file up first).

### Redeploying after code changes

```bash
rsync -az --delete --exclude node_modules --exclude .git --exclude dist \
  ./ root@<server>:/root/zonoticwatch/
ssh root@<server> 'cd /root/zonoticwatch && \
  docker compose -f docker-compose.prod.yml up -d --build'
```

Re-run `alembic upgrade head` if there are new migrations. The Temporal
worker does **not** hot-reload — `up -d --build` recreates it.

> The AI Signal Analyzer calls a **local** Ollama, so it does not work for
> remote users in this deployment; it fails gracefully. The signal feed,
> county map, and weather all work.

## Design tokens

All colors, fonts, and radii are defined as CSS custom properties in
`src/styles/theme.css`. The component references them via `var(--token)`, so
re-theming (e.g. a dark mode) only requires editing that one file.
