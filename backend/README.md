# ZonoticWatch Kenya — Backend

FastAPI + PostGIS + Temporal backend. See `docs/backend-plan.md` for the
full design and rollout order.

## Status

**Phase 2, step 8 — Gi\* risk model.** `RiskComputationWorkflow` now also
runs `compute_getis_ord` → `write_county_risk`. Per-week Gi\* is not
viable on this data (most weeks have signals in only 1–2 counties), so
Gi\* runs on the **cumulative** county cross-section: queen-contiguity
weights, all-time signal counts, normalized to a 0–1 `county_risk`. The
map's risk tint is now model-computed (the NE pastoralist RVF belt).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health`, `/health/temporal` | liveness |
| GET | `/counties` | 47 counties + current risk + case counts |
| GET | `/counties.geojson` | GADM polygons, risk in feature properties |
| GET | `/signals?limit=&since=&county=` | signal feed, newest first |
| POST | `/refresh` | start an ingestion run → `{workflow_id, run_id}` |
| GET | `/refresh/{workflow_id}` | poll ingestion status / summary |
| GET | `/trend?days=` | weekly human / animal / RVF case trend |
| GET | `/diseases` | disease distribution across the signal feed |
| GET | `/risk?week=` | per-county Gi\* risk scores (latest week default) |

### Trigger an ingestion run

```bash
curl -sX POST localhost:8000/refresh         # -> {"workflow_id":"ingest-...","run_id":"..."}
curl -s localhost:8000/refresh/ingest-XXXX   # poll until status COMPLETED
```

The classifier (`geo/classify.py`) and geocoder (`geo/geocode.py`) are
the Python port of `src/lib/signals.js`. The Apify actor needs a paid
plan; without a token the X/Twitter source is simply skipped. After code
changes to activities/workflows, restart the worker:
`docker compose restart worker`.

## Run the stack

From the repo root:

```bash
docker compose up --build
```

| Service     | URL                          |
|-------------|------------------------------|
| FastAPI     | http://localhost:8000/health |
| API docs    | http://localhost:8000/docs   |
| Temporal UI | http://localhost:8080        |
| Postgres    | localhost:5432 (zonotic/zonotic) |

## Verify

```bash
curl http://localhost:8000/health           # {"status":"ok",...}
curl http://localhost:8000/health/temporal  # {"status":"ok",...} once Temporal is up
```

## Database — migrate & seed

After the stack is up, create the schema and load county polygons:

```bash
docker compose exec backend alembic upgrade head               # create 5 tables + PostGIS
docker compose exec backend python -m scripts.load_counties    # load 47 GADM polygons
docker compose exec backend python -m scripts.seed_sample_data # seed SIGNALS + COUNTIES
docker compose exec backend python -m scripts.load_empres_rvf  # load FAO EMPRES-i Kenya RVF events
```

All three scripts are idempotent. `load_counties` prints
`total=47  monitored=14  missing_geometry=0`; `seed_sample_data` prints
`signals=7  county_risk=14  county_week_features=14`; `load_empres_rvf`
loads 90 confirmed Kenya RVF events as `src='EMPRES-i'` signals,
point-in-polygon geocoded. A `POST /refresh` (or a direct
`RiskComputationWorkflow` run) then folds them into the analytics. Verify
the endpoints:

```bash
curl -s localhost:8000/counties | python3 -m json.tool | head
curl -s localhost:8000/counties.geojson | python3 -c "import sys,json;print(len(json.load(sys.stdin)['features']),'features')"
curl -s "localhost:8000/signals?county=baringo"
```

Inspect the DB directly:

```bash
docker compose exec postgres psql -U zonotic -d zonotic \
  -c "SELECT id, name, monitored FROM counties ORDER BY id;"
```

Schema changes live in `migrations/versions/`; the DB URL is injected
from app settings, so plain `alembic` commands work inside the container.

## Run without Docker

Requires Python 3.12 and Poetry, plus a reachable Postgres + Temporal.

```bash
cd backend
cp .env.example .env        # adjust DATABASE_URL / TEMPORAL_ADDRESS
poetry install
poetry run uvicorn app.main:app --reload     # API
poetry run python -m app.temporal.worker     # worker (separate shell)
```

## Layout

```
backend/
  alembic.ini          Alembic config (DB URL injected from settings)
  app/
    main.py            FastAPI app factory + CORS
    config.py          pydantic-settings
    db/                Base, async session, ORM models
    schemas/           Pydantic response models
    geo/               classify.py (keyword classifier), geocode.py
    routers/           health, counties, signals (+ /refresh)
    temporal/          client, worker, workflows, activities
  migrations/          Alembic env + versions/
  scripts/
    load_counties.py     one-off GADM polygon loader
    seed_sample_data.py  seed SIGNALS + COUNTIES sample data
    load_empres_rvf.py   load FAO EMPRES-i Kenya RVF events
```
