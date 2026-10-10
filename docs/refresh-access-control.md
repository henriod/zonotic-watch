# Access control for ingestion (`POST /refresh`)

**Status:** proposal — not yet implemented.

## Problem

`POST /refresh` (see `backend/app/routers/signals.py`) starts the Temporal
`IngestionWorkflow` and is **completely unauthenticated**. Since the cutover
to `watch.kadiri.app` it is reachable by anyone on the internet:

```
curl -X POST https://watch.kadiri.app/api/refresh
```

Every call triggers a real ingestion run. The "Pull live signals" button in
the dashboard's **Data Sources** tab does exactly this — but so can a bot, a
scraper, or a refresh loop left open in a browser tab.

## Why this matters — cost and rate-limit exposure

An ingestion run fans out to two sources (`backend/app/temporal/`):

| Source     | Cost of abuse                                                    |
| ---------- | ---------------------------------------------------------------- |
| **Apify**  | The `apidojo/tweet-scraper` actor is **paid — ~$0.40 / 1,000 tweets**. Unbounded `/refresh` calls translate directly into a billing line. |
| **GDELT**  | Free, but rate-limited. Hammering it gets the server's IP throttled or blocked, degrading ingestion for legitimate use. |
| **Temporal / DB** | Each call queues a workflow and writes to Postgres. Enough concurrent runs can saturate the worker and the DB. |

`POST /refresh` is the single highest-value endpoint to lock down. The read
endpoints (`/signals`, `/counties`, `/trend`, …) are cheap DB reads and are
acceptable to leave public.

## Threat model

- **Not** trying to defeat a determined, targeted attacker.
- **Are** trying to stop: opportunistic abuse, scraping bots, accidental
  refresh loops, and anyone who reads the JS bundle and replays the call.
- Constraint: the frontend is a **static bundle**. Any secret shipped to the
  browser is visible in DevTools — an embedded API key is *obfuscation, not
  authentication*. Real protection must live server-side or at the proxy.

## Options

| # | Approach | Effort | Stops abuse? | Notes |
|---|----------|--------|--------------|-------|
| A | Traefik `basicAuth` on `/api/refresh` | minutes, no app code | Yes | Native browser login dialog; ugly but effective. |
| B | Traefik `rateLimit` on `/api/refresh` | minutes, no app code | Caps it | Defense-in-depth; doesn't identify callers. |
| C | Backend single-flight + cooldown guard | small | Caps it | Protects every path, even the scheduled one. |
| D | Backend API key (header) | small | Weak alone | Useless if the SPA ships the key; fine for `curl`/operators. |
| E | Real auth page (login + session/JWT) | larger | Yes | Proper fix if the dashboard needs accounts/roles. |
| F | Make ingestion scheduled; drop the public button | small | Yes | Removes the attack surface entirely for the common case. |

These are **complementary**, not exclusive. The recommendation below stacks
several.

## Recommended rollout

### Phase 1 — proxy-level guard (do this first; no app deploy)

The stack's Traefik already routes `watch.kadiri.app`. Add a **dedicated,
higher-priority router** for the refresh path with basic auth + a rate limit.
A longer path rule (`/api/refresh`) outranks the general `/api` rule, so
refresh traffic lands here while everything else is untouched.

In `traefik/traefik.yml` (router/service names there are `watch-api`,
`strip-api` and `backend`):

```yaml
http:
  routers:
    # Add ABOVE the general zonotic-api-router.
    zonotic-refresh-router:
      rule: 'Host(`watch.kadiri.app`) && PathPrefix(`/api/refresh`)'
      entryPoints:
        - web-secure
      middlewares:
        - zonotic-refresh-auth
        - zonotic-refresh-ratelimit
        - zonotic-stripapi          # reuse the existing /api StripPrefix
      service: zonotic-backend
      tls:
        certResolver: letsencrypt

  middlewares:
    zonotic-refresh-auth:
      basicAuth:
        # Generate with:  htpasswd -nbB admin '<password>'
        users:
          - 'admin:$2y$05$REPLACE_WITH_BCRYPT_HASH'

    zonotic-refresh-ratelimit:
      rateLimit:
        average: 6        # ~6 refreshes/hour sustained
        period: 1h
        burst: 2
```

Caveat: basic auth covers both `POST /api/refresh` and the
`GET /api/refresh/{id}` poll. That is fine — the browser caches the
credentials for the session after the first prompt, so polling still works.

### Phase 2 — backend single-flight + cooldown (defense in depth)

Protects against abuse even if the proxy is bypassed, and stops a stampede of
concurrent runs. In `trigger_refresh()`:

- **Single-flight:** refuse to start a new run while one is already running.
  Either query Temporal for a running `IngestionWorkflow`, or start it with a
  fixed `id` (e.g. `ingest-current`) and a `WorkflowIDReusePolicy` /
  `id_conflict_policy` that rejects a duplicate, returning the existing
  handle instead.
- **Cooldown:** record the last successful run time (a small `kv` row or the
  newest `signals.ingested_at`); reject calls inside an `N`-minute window
  with HTTP `429`.

Sketch:

```python
from fastapi import HTTPException, status

REFRESH_COOLDOWN = timedelta(minutes=15)

@router.post("/refresh", status_code=202)
async def trigger_refresh(session: AsyncSession = Depends(get_session)) -> dict:
    last = await _last_ingestion_at(session)
    if last and datetime.now(timezone.utc) - last < REFRESH_COOLDOWN:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "ingestion ran recently — try again later")
    # ... start workflow with a conflict-rejecting id policy ...
```

The frontend should surface a `429` as a friendly "refreshed recently"
message rather than an error.

### Phase 3 — auth page (only if the dashboard needs accounts)

If ZonoticWatch grows past a single trusted operator — multiple users, an
"analyst vs. admin" split, audit of who triggered what — replace the basic
auth with a real login:

- `POST /api/auth/login` validates credentials and issues a **short-lived
  JWT** or sets an **HttpOnly, Secure** session cookie.
- A `/login` route in the React app; unauthenticated users are redirected
  there. Decide whether to gate **only `/refresh`** or the **whole
  dashboard**.
- `/refresh` (and any future write endpoints) depend on an auth check:

  ```python
  @router.post("/refresh", dependencies=[Depends(require_user)])
  ```

- Start with a single admin credential in backend settings
  (`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`); add a `users` table only when
  more than one account is genuinely needed.

### Phase 4 (optional) — schedule ingestion, demote the button

Move routine ingestion to a **Temporal Schedule** (e.g. every 30–60 min) so
fresh data arrives without anyone clicking anything. The manual `/refresh`
then becomes an admin-only convenience, not a public feature — which shrinks
the attack surface to almost nothing regardless of the above.

## Summary

| When        | Action                                                       |
| ----------- | ------------------------------------------------------------ |
| Immediately | Phase 1 — Traefik `basicAuth` + `rateLimit` on `/api/refresh`. |
| Next        | Phase 2 — backend single-flight + cooldown (`429`).          |
| If needed   | Phase 3 — real auth page with session/JWT.                   |
| Nice to have| Phase 4 — scheduled ingestion; manual refresh becomes admin-only. |

Phase 1 alone closes the open door and can ship today with no application
deploy. Phases 2–4 harden it and improve the product.
