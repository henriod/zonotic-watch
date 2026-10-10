# ZonoticWatch - improvement review

Review date: 2026-10-10. Scope: backend (`backend/`), frontend (`src/`),
deployment and the production server (`watch.kadiri.app`). Findings were
checked against the code; items marked **(verified live)** were also confirmed
against production.

Priority: **P0** fix now (security / data loss) - **P1** next sprint
(correctness, data quality) - **P2** worth doing - **P3** nice to have.

---

## P0 - fix now

### 1. Apify token is written to the worker logs (verified live)
- `backend/app/temporal/activities.py:120,141,152` passes the token as a
  `?token=` query param; `backend/app/temporal/worker.py:18` logs at INFO, so
  httpx prints every full URL. `docker compose logs worker` shows the token.
- **Fix:** rotate the Apify token; send it as `Authorization: Bearer <token>`;
  add `logging.getLogger("httpx").setLevel(logging.WARNING)` in `worker.py`;
  enable log rotation (item 13) so old logs age out.

### 2. No database backups (verified live)
- No cron, no backup dir, no timers on the server. The `pgdata` volume is the
  only copy of signals, users and risk.
- **Fix:** nightly `docker compose exec -T zw-postgres pg_dump -Fc zonotic`
  from cron, copied off the box; document and test one restore.

### 3. Session secret can silently be empty
- `docker-compose.prod.yml:90` sets `SESSION_SECRET: ${SESSION_SECRET:-}`. If
  the server `.env` lacks it, the cookie is signed with `""` and anyone can
  forge an admin session. (Not checked on the server - `.env` was not read.)
- **Fix:** `${SESSION_SECRET:?SESSION_SECRET required}` in the prod compose,
  and refuse to start in `create_app()` when `cookie_secure` is on and the
  secret is empty, a dev default, or under 32 chars.

### 4. Worker runs a stale image after backend-only rebuilds (verified live)
- `backend` and `worker` share image `zonoticwatch-backend`; rebuilding only
  `backend` left the worker on a 4-month-old orphaned image. Any `temporal/`
  change would silently not ship. README advice is now corrected.
- **Fix:** remove `build:` from `worker` in `docker-compose.prod.yml` so only
  one service builds the image; always `up -d --build backend worker`; then
  `docker image prune`.

### 5. Login and costly endpoints are unthrottled
- `/auth/login` (`app/routers/auth.py:36-55`) has no rate limit; bcrypt runs
  synchronously inside `async def` (`app/security.py:29-37`), so a login flood
  stalls every endpoint. Unknown usernames skip bcrypt (timing leak).
- `POST /refresh` (`app/routers/signals.py:54`) starts a new paid Apify run per
  click (`ingest-{uuid4()}`); `/analyze` has no per-user quota.
- **Fix:** `asyncio.to_thread` for bcrypt + dummy-hash verify for unknown
  users; Traefik `rateLimit` middleware on `/api/auth/login` and
  `/api/analyze`; fixed workflow id with
  `WorkflowIDConflictPolicy.USE_EXISTING` for refresh.

### 6. Critical npm advisories
- `npm audit --omit=dev`: 9 vulns (2 critical). `maplibre-gl` 4.7.1 has a
  critical XSS sanitizer bypass; the rest come via `@tabler/icons-webfont`
  -> svgtofont (a build toolchain listed as a runtime dep).
- **Fix:** upgrade maplibre-gl (check for a patched 4.x/5.x before jumping to
  6.x); replace the icon webfont (see item 27).

---

## P1 - data quality and correctness

### 7. Most signals never get a county (root cause of the stale trend)
- GDELT signals are geocoded from the **headline only**
  (`app/geo/classify.py:184` sets `text = title`). National headlines rarely
  name a county, so ~58% of recent signals land as "Kenya" with no county and
  drop out of `county_week_features`, `/counties` and the risk map.
- **Fix:** use GDELT GKG/GEO locations (lat/lng -> point-in-polygon) or fetch
  the article lead paragraph for name matching; treat "national" as an
  explicit bucket in analytics rather than discarding it.

### 8. Ingestion is never scheduled
- No Temporal Schedule or cron anywhere; data refreshes only when a logged-in
  user clicks Refresh (there were no signals at all from late June to early
  September). `_GDELT_MAX_RECORDS = 25` over a 3-month window
  (`workflows.py:33-34`) means anything beyond the newest 25 articles between
  runs is lost.
- **Fix:** create a Temporal Schedule at worker startup (every 30-60 min,
  ignore "already exists"); raise maxrecords to 250.

### 9. Fake seed data is live in production (verified live)
- 7 `seed-*` signals (fabricated, attributed to KBC/Daily Nation) are in the
  prod feed, plus seeded risk/feature rows. They feed `/trend`, `/diseases`
  and Gi*. The prod compose header still instructs running `seed_sample_data`.
- **Fix:** delete `id LIKE 'seed-%'` signals and `method='seed'` rows in prod;
  drop the seed step from prod instructions.

### 10. `GET /risk?week=YYYY-MM-DD` returns 500 (verified live)
- `app/routers/analytics.py:105` types `week` as `str` and binds it to a date
  column; asyncpg rejects it.
- **Fix:** `week: date | None = Query(None)`. One line.

### 11. County name matching gives false positives
- `app/geo/geocode.py:75-80` substring-matches with no word boundaries and no
  `ORDER BY` (`:50`): "avoid" -> Voi, "Molotov" -> Molo; first match wins in
  arbitrary order, biasing to Nairobi datelines. No aliases ("Pokot",
  "Taveta"), curly-apostrophe "Murang'a" misses.
- **Fix:** one precompiled `\b(...)\b` regex over names + aliases; prefer the
  most-mentioned or non-capital county.

### 12. Severity classifier inflates CRITICAL
- `app/geo/classify.py:87-115`: "outbreak" alone is CRITICAL (and the GDELT
  query is outbreak-themed); no negation ("declared free of RVF" scores
  CRITICAL); substrings like "dead" in "deadline", "vet" in "velvet".
- **Fix:** word-boundary regexes, require co-terms for CRITICAL, small
  negation list ("free of", "no cases", "ruled out").

### 13. Tweet dates probably all fall back to ingestion time
- `app/geo/classify.py:143` parses `createdAt` with `fromisoformat` only; the
  Apify tweet scraper returns the legacy format
  (`Thu Dec 12 21:39:29 +0000 2024`), so tweets land in the wrong week.
  Confirm against one stored Apify item.
- **Fix:** fall back to `email.utils.parsedate_to_datetime(raw)`.

### 14. Activity retries are wrong both ways
- `classify_and_geocode` / `upsert_signals` have no RetryPolicy (unlimited
  retries): one bad row hangs the workflow forever and the `ingest_runs` row
  stays RUNNING. Missing `APIFY_TOKEN` raises a retryable error; Apify retries
  relaunch a paid actor run.
- **Fix:** `maximum_attempts` on every activity, `ApplicationError(non_retryable=True)`
  for config errors, finalize the run row in `finally`.

### 15. Weak cross-run dedup
- Ids are `gdelt-{url}` with `ON CONFLICT (id)`; the same story syndicated
  under another URL is inserted again, inflating every count. Tweet ids are
  unprefixed; retweets not collapsed.
- **Fix:** `content_hash` column (normalized text) with a unique index;
  prefix tweet ids `x-`.

### 16. Risk model (Getis-Ord) soundness
- `activities.py:466-555`: says "RVF counts" but sums all diseases; all-time
  cumulative counts with no recency decay (2000s EMPRES events dominate
  forever); no population/exposure normalization (media volume drives
  Nairobi-area hotspots); no FDR correction; unseeded permutations; stamped
  as the current week although it is not weekly; national signals excluded.
- **Fix:** rolling window (e.g. 12 weeks with decay), per-disease scoring,
  rates or empirical-Bayes smoothing, `esda.fdr`, fixed seed. This is the
  Phase 2 work in `docs/backend-plan.md`.

### 17. `county_week_features` full rebuild and `/counties` reads
- Every run zeroes the whole table and re-inserts all history (O(history),
  table bloat, zeroed rows never deleted). `/counties` shows the single
  latest row per county, which can be years old or a zeroed seed week, so
  counties show 0 cases.
- **Fix:** recompute only touched weeks (or delete zeroed rows); have
  `/counties` sum the last N weeks.

### 18. Trend chart x-axis is misleading
- `src/components/TrendChart.jsx:43,64`: `days=9000` returns sparse weeks
  across 2004-2026 on a categorical axis, so empty weeks vanish and 2004 sits
  next to 2026; "across N weeks" counts points, not time.
- **Fix:** time-scaled numeric x-axis (or zero-filled weeks from `/trend`),
  year-aware ticks; default to a short window with EMPRES history as a toggle.

### 19. Fake freshness indicator
- `ZonoticWatch.jsx:47-55` and `DashboardHeader.jsx:38-44`: "Last scan" resets
  to now every 15s without fetching anything; LIVE always pulses. Misleading
  on a surveillance tool, and re-renders the whole dashboard every 15s.
- **Fix:** set it from the newest signal's `event_time` or the last real
  refresh; remove the interval.

### 20. Refresh polling is fragile
- `ZonoticWatch.jsx:104-125`: one failed poll aborts with "Refresh failed"
  though the workflow keeps running; after 6 minutes it gives up silently;
  only `/signals` is reloaded, so map, diseases and trend stay stale.
- **Fix:** retry polls, report timeouts, bump a shared `dataVersion` that
  every panel's fetch depends on.

### 21. Expired session UX
- On a 401 from `/refresh` or `/analyze`, the header still shows the user as
  signed in (`auth.jsx:101-103` hydrates once).
- **Fix:** on 401 clear the user and show "Session expired, sign in again".

---

## P2 - ops, robustness, accessibility

### Ops
22. **No Python lockfile** - `backend/poetry.lock` is missing and the Dockerfile
    copies `poetry.lock*`, so builds resolve fresh versions. Run `poetry lock`,
    commit it, drop the `*`.
23. **No CI** - add a GitHub Actions job: `npm ci && npm run lint && npm run build`,
    `ruff check backend`, `docker build ./backend`.
24. **No log rotation (verified live)** - Temporal log is already 143 MB. Set
    `max-size: 10m, max-file: 3` in `/etc/docker/daemon.json` or per service.
25. **No healthchecks / monitoring** - only Postgres and Temporal have
    healthchecks; nothing alerts on downtime or failed ingestion. Add
    healthchecks for backend/worker/frontend and an external uptime probe on
    `/api/health` and `/api/health/temporal`.
26. **No resource limits, no swap** - 5.8 GB RAM host shared with other apps,
    0 swap. Set `mem_limit` on worker, Temporal and Postgres; add a swapfile;
    multi-stage backend image (1.41 GB today).

### Frontend
27. **Bundle size** - `@tabler/icons-webfont` ships 201 KB CSS + up to 2.8 MB
    font for ~20 icons; switch to `@tabler/icons-react` or inline SVGs.
    Lazy-load `TrendChart` (recharts is most of the 580 KB main chunk).
28. **Keyboard access** - signal feed rows are clickable `<div>`s
    (`SignalFeed.jsx:45`); county selection is mouse-only on the map
    (`KenyaMap.jsx:386`); tabs lack `role="tablist"`/`aria-selected`
    (`ZonoticWatch.jsx:178-191`); analyzer textarea and admin inputs lack
    labels; status messages need `aria-live`.
29. **Contrast and font size** - `--color-text-tertiary #9099a3` is ~2.8:1
    (fails WCAG AA); map labels use `text-size: 10` (`KenyaMap.jsx:292`)
    below the 12px minimum; light label text on the light Positron basemap.
30. **Null / zero guards** - null `conf`/`disease`/`sev` render "0%" or
    "undefined" (`SignalFeed.jsx:51,59`); divide-by-zero NaN% in
    `HumanVsLivestock.jsx:10` and `DiseaseDistribution.jsx:34-45`; counties
    with null lat/lng produce `[null,null]` markers and can break the weather
    request for all counties.
31. **No offline map fallback** - if `/counties.geojson` fails the map has no
    polygons (`KenyaMap.jsx:176-183`), contrary to CLAUDE.md.
32. **Map remounts on every tab switch** - re-creates MapLibre and re-downloads
    style and GeoJSON. Keep it mounted and hide it.
33. **nginx** - no `Cache-Control: no-cache` on `index.html` (stale index after
    deploy) and no security headers (HSTS, CSP, `X-Content-Type-Options`).

### Backend
34. `/signals` only pages newest-first - add a `before` keyset param and an
    index on `(county_id, event_time DESC)`.
35. `/counties.geojson` serializes full-resolution geometry on every request -
    `ST_SimplifyPreserveTopology` + `Cache-Control`.
36. `/api/docs` and `/api/openapi.json` are public in prod; `/health/temporal`
    returns raw exception text; `GET /refresh/{id}` describes any workflow id.

---

## P3 - housekeeping

37. **Tests** - one assert-based `backend/tests/test_classify.py` covering
    "avoid" not -> Voi, "declared free" not CRITICAL, legacy tweet date
    parsing, two-county text. One vitest file for refresh polling and the
    divide-by-zero guards.
38. **Docs drift** - `README.md` still describes the browser-only app
    (`gdelt.js`, `apify.js`, `VITE_APIFY_TOKEN`) and says the analyzer uses a
    local Ollama (it proxies to Ollama Cloud). `CLAUDE.md` "Sample data vs.
    live data" is out of date (markers, metrics, diseases and trend are all
    live now) and has no Production section.
39. **Stray files** - `reso.json` (623 KB raw tweet dump, unused) is committed
    and rsynced to the server; `public/data/empres-rvf-events.csv` (228 KB) is
    shipped publicly but only used by a backend script. Remove both from the
    public paths.
40. **Hard-coded DB credentials** - `zonotic/zonotic` in the prod compose.
    Postgres is not publicly reachable (verified), but move it to
    `${POSTGRES_PASSWORD:?}`.
41. **Small leftovers** - tweet coordinates parsed but never written to
    `signals.geom`; `/trend` matches an `'RVF'` disease label the classifier
    never emits; duplicated severity colours and inconsistent risk thresholds
    across `risk.js`, `CountyDetailCard.jsx:14` and `WeatherPanel.jsx:27`;
    `auth.jsx` lint warnings (move API functions to a separate module);
    `DataSourcesPanel.jsx` keyword/handle lists can drift from the backend
    config.

---

## Checked and fine
- Postgres, Temporal gRPC/UI and the backend port are not publicly reachable.
- All services have `restart: unless-stopped`.
- `.env` is gitignored; deploy docs now exclude it from rsync.
- `npm run lint` (0 errors) and `npm run build` pass.

## Suggested order
1. Items 1-6 (security, backups, deploy correctness) - mostly small changes.
2. Items 7, 8, 9, 13 - these explain the "national only" and stale-data
   symptoms on the dashboard.
3. Item 10 (one line), then 11-12 with the tests from item 37.
4. Risk model (16-17) as the planned Phase 2 work.
