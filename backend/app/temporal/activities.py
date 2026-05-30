"""Temporal activities for the ingestion pipeline.

Activities do all the slow / rate-limited / retry-prone work — HTTP calls
to GDELT and Apify, classification, geocoding, and DB writes — so the
workflow stays a thin deterministic orchestrator. See docs/backend-plan.md
section 3.
"""

from __future__ import annotations

import asyncio
import json
import math
import uuid
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import text
from temporalio import activity

from app.config import get_settings
from app.db.session import async_session_maker
from app.geo.classify import (
    GDELT_QUERY,
    HANDLE_TOPIC,
    SCRAPE_KEYWORDS,
    TWITTER_HANDLES,
    classify_articles,
    classify_tweets,
)
from app.geo.geocode import load_counties, resolve_county

_APIFY_BASE = "https://api.apify.com/v2"
_APIFY_ACTOR = "apidojo~tweet-scraper"
_APIFY_TERMINAL = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}


@activity.defn
async def ping() -> str:
    """Trivial smoke activity (registered for /health diagnostics)."""
    return "pong"


@activity.defn
async def create_ingest_run(workflow_id: str) -> str:
    """Insert a RUNNING ingest_runs row; return its uuid."""
    async with async_session_maker() as session:
        row = await session.execute(
            text(
                """
                INSERT INTO ingest_runs (workflow_id, started_at, status)
                VALUES (:wf, now(), 'RUNNING')
                RETURNING id
                """
            ),
            {"wf": workflow_id},
        )
        run_id = row.scalar_one()
        await session.commit()
    return str(run_id)


@activity.defn
async def fetch_gdelt(timespan: str, max_records: int) -> list[dict]:
    """Pull recent Kenya zoonotic news from the GDELT DOC API.

    Server-to-server, so no CORS problem. A 429 raises a retryable error;
    the workflow gives this activity a long initial retry interval.
    """
    settings = get_settings()
    params = {
        "query": GDELT_QUERY,
        "mode": "ArtList",
        "format": "json",
        "maxrecords": str(max_records),
        "sort": "DateDesc",
        "timespan": timespan,
    }
    url = f"{settings.gdelt_api_base}/api/v2/doc/doc"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(url, params=params)

    if res.status_code == 429:
        raise RuntimeError("GDELT rate limit (429) — retryable")
    res.raise_for_status()

    # GDELT returns plain text (not JSON) on a malformed query.
    try:
        data = res.json()
    except ValueError as exc:
        raise RuntimeError(
            f"GDELT returned a non-JSON response: {res.text[:120]}"
        ) from exc
    articles = data.get("articles", [])
    activity.logger.info("GDELT returned %d article(s)", len(articles))
    return articles


@activity.defn
async def fetch_apify(max_items: int) -> list[dict]:
    """Run the apidojo Tweet Scraper actor and return its dataset items.

    Long activity: heartbeats each poll. The actor needs a paid Apify
    plan — free runs come back empty (filtered downstream).
    """
    settings = get_settings()
    token = settings.apify_token
    if not token:
        raise RuntimeError("APIFY_TOKEN is not set — skipping X/Twitter source")

    terms = list(SCRAPE_KEYWORDS)
    if TWITTER_HANDLES:
        froms = " OR ".join(f"from:{h}" for h in TWITTER_HANDLES)
        terms.append(f"({froms}) {HANDLE_TOPIC}")

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. Start the actor run.
        res = await client.post(
            f"{_APIFY_BASE}/acts/{_APIFY_ACTOR}/runs",
            params={"token": token},
            json={
                "searchTerms": terms,
                "maxItems": max_items,
                "tweetLanguage": "en",
                "sort": "Latest",
            },
        )
        res.raise_for_status()
        run = res.json()["data"]
        run_id = run["id"]
        status = run["status"]

        # 2. Poll to a terminal state, heartbeating so Temporal sees progress.
        for _ in range(90):  # ~6 min
            if status in _APIFY_TERMINAL:
                break
            activity.heartbeat(status)
            await asyncio.sleep(4)
            res = await client.get(
                f"{_APIFY_BASE}/acts/{_APIFY_ACTOR}/runs/{run_id}",
                params={"token": token},
            )
            res.raise_for_status()
            status = res.json()["data"]["status"]

        if status != "SUCCEEDED":
            raise RuntimeError(f"Apify run did not succeed (status: {status})")

        # 3. Pull dataset items.
        res = await client.get(
            f"{_APIFY_BASE}/datasets/{run['defaultDatasetId']}/items",
            params={"token": token, "clean": "true"},
        )
        res.raise_for_status()
        items = res.json()

    activity.logger.info("Apify returned %d item(s)", len(items))
    return items


@activity.defn
async def classify_and_geocode(raw_items: list[dict], source: str) -> list[dict]:
    """Classify raw items and resolve each to a county.

    `source` is "gdelt" or "apify". Open-search tweets must clear the
    Kenya + zoonotic-topic relevance gate; GDELT articles and verified
    accounts bypass it. Returns rows ready for `upsert_signals`.
    """
    classified = (
        classify_articles(raw_items)
        if source == "gdelt"
        else classify_tweets(raw_items)
    )
    if not classified:
        return []

    rows: list[dict] = []
    async with async_session_maker() as session:
        counties = await load_counties(session)
        for c in classified:
            county_id, loc_name = await resolve_county(
                session, c["text"], counties, c.get("lat"), c.get("lng")
            )
            resolved = county_id is not None

            # Relevance gate — open-search tweets only.
            if source == "apify" and not c["verified"]:
                mentions_kenya = resolved or "kenya" in c["text"].lower()
                relevant = mentions_kenya and (c["hits"] > 0 or c["topic"])
                if not relevant:
                    continue

            if source == "gdelt":
                conf = 0.5 + c["hits"] * 0.13 + (0.1 if resolved else 0.0)
                conf = min(0.95, conf)
            else:
                conf = (
                    0.4
                    + c["hits"] * 0.15
                    + (0.12 if resolved else 0.0)
                    + (0.15 if c["verified"] else 0.0)
                )
                conf = min(0.97, conf)

            rows.append(
                {
                    "id": c["id"],
                    "src": c["src"],
                    "handle": c["handle"],
                    "text": c["text"],
                    "disease": c["disease"],
                    "severity": c["severity"],
                    "confidence": round(conf, 2),
                    "county_id": county_id,
                    "loc_name": loc_name,
                    "event_time": c["event_time"],
                }
            )

    activity.logger.info("Classified %d %s signal(s)", len(rows), source)
    return rows


@activity.defn
async def upsert_signals(rows: list[dict], ingest_run_id: str) -> int:
    """Insert signal rows, skipping ids already present. Returns inserted count.

    `ON CONFLICT (id) DO NOTHING` replaces the client-side de-dup-by-id.
    """
    if not rows:
        return 0

    run_uuid = uuid.UUID(ingest_run_id)
    stmt = text(
        """
        INSERT INTO signals
            (id, src, handle, text, disease, severity, confidence,
             county_id, loc_name, event_time, ingest_run_id)
        VALUES
            (:id, :src, :handle, :text, :disease, :severity, :confidence,
             :county_id, :loc_name, :event_time, :ingest_run_id)
        ON CONFLICT (id) DO NOTHING
        """
    )
    inserted = 0
    async with async_session_maker() as session:
        for r in rows:
            event_time = datetime.fromisoformat(r["event_time"])
            result = await session.execute(
                stmt,
                {
                    "id": r["id"],
                    "src": r["src"],
                    "handle": r["handle"],
                    "text": r["text"],
                    "disease": r["disease"],
                    "severity": r["severity"],
                    "confidence": r["confidence"],
                    "county_id": r["county_id"],
                    "loc_name": r["loc_name"],
                    "event_time": event_time,
                    "ingest_run_id": run_uuid,
                },
            )
            inserted += result.rowcount or 0
        await session.commit()
    return inserted


@activity.defn
async def finalize_ingest_run(
    ingest_run_id: str,
    status: str,
    gdelt_count: int,
    apify_count: int,
    notes: dict,
) -> None:
    """Mark the ingest_runs row finished with counts and per-source notes."""
    async with async_session_maker() as session:
        await session.execute(
            text(
                """
                UPDATE ingest_runs
                SET finished_at = now(),
                    status = :status,
                    gdelt_count = :gdelt_count,
                    apify_count = :apify_count,
                    notes = CAST(:notes AS jsonb)
                WHERE id = :id
                """
            ),
            {
                "id": uuid.UUID(ingest_run_id),
                "status": status,
                "gdelt_count": gdelt_count,
                "apify_count": apify_count,
                "notes": json.dumps(notes),
            },
        )
        await session.commit()


# ── Phase 2 — feature aggregation ────────────────────────────────────────

# Severity -> ordinal score, averaged into county_week_features.mean_severity.
_SEVERITY_SCORE = (
    "CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 "
    "WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE NULL END"
)

# Case-insensitive POSIX regexes splitting a signal's subject. A signal can
# match both; these are report-volume proxies, not literal case counts.
_HUMAN_RE = (
    r"human|people|persons?|patients?|hospital(is|iz)ed?|children|child|"
    r"residents?|\bmen\b|women|health workers?"
)
_ANIMAL_RE = (
    r"livestock|cattle|cows?|goats?|sheep|camels?|herds?|carcass|poultry|"
    r"animals?|flocks?|abattoir|mifugo|wanyama|ng'ombe"
)
# Filoviruses are human-dominant (human-to-human outbreaks): count them as
# human cases even when the report wording doesn't trip _HUMAN_RE. Must match
# the disease labels in app/geo/classify.py DISEASE_KEYWORDS.
_HUMAN_DISEASES = ["Ebola", "Marburg", "Viral Hemorrhagic Fever"]

# Zero the signal-derived columns before re-aggregating, so counties/weeks
# that no longer have signals (or were only ever seeded) drop to 0 instead
# of keeping stale values. Weather columns are deliberately left intact.
_RESET_WEEK_FEATURES = text(
    """
    UPDATE county_week_features
    SET signal_count = 0, human_cases = 0, animal_cases = 0,
        mean_severity = NULL, disease_breakdown = NULL
    """
)

_REBUILD_WEEK_FEATURES = text(
    f"""
    WITH per_signal AS (
        SELECT county_id,
               date_trunc('week', event_time)::date AS wk,
               disease, severity, text
        FROM signals
        WHERE county_id IS NOT NULL
    ),
    agg AS (
        SELECT county_id, wk,
               count(*) AS signal_count,
               count(*) FILTER (
                   WHERE text ~* :human_re OR disease = ANY(:human_diseases)
               ) AS human_cases,
               count(*) FILTER (WHERE text ~* :animal_re) AS animal_cases,
               avg({_SEVERITY_SCORE}) AS mean_severity
        FROM per_signal
        GROUP BY county_id, wk
    ),
    dis AS (
        SELECT county_id, wk, jsonb_object_agg(disease, c) AS disease_breakdown
        FROM (
            SELECT county_id, wk, disease, count(*) AS c
            FROM per_signal
            GROUP BY county_id, wk, disease
        ) t
        GROUP BY county_id, wk
    )
    INSERT INTO county_week_features
        (county_id, week_start, signal_count, human_cases,
         animal_cases, mean_severity, disease_breakdown)
    SELECT a.county_id, a.wk, a.signal_count, a.human_cases,
           a.animal_cases, a.mean_severity, dis.disease_breakdown
    FROM agg a
    JOIN dis ON dis.county_id = a.county_id AND dis.wk = a.wk
    ON CONFLICT (county_id, week_start) DO UPDATE SET
        signal_count = EXCLUDED.signal_count,
        human_cases = EXCLUDED.human_cases,
        animal_cases = EXCLUDED.animal_cases,
        mean_severity = EXCLUDED.mean_severity,
        disease_breakdown = EXCLUDED.disease_breakdown
    """
)


@activity.defn
async def rebuild_week_features() -> int:
    """Aggregate `signals` into `county_week_features` (county × ISO week).

    Rebuilds every week present in `signals`. Stale signal-derived values
    are reset first; weather columns are left untouched. Returns the number
    of (county, week) rows with signals.
    """
    async with async_session_maker() as session:
        await session.execute(_RESET_WEEK_FEATURES)
        result = await session.execute(
            _REBUILD_WEEK_FEATURES,
            {
                "human_re": _HUMAN_RE,
                "animal_re": _ANIMAL_RE,
                "human_diseases": _HUMAN_DISEASES,
            },
        )
        await session.commit()
        rows = result.rowcount or 0
    activity.logger.info("rebuild_week_features wrote %d (county, week) row(s)", rows)
    return rows


# ── Phase 2 — Getis-Ord Gi* hotspot risk ─────────────────────────────────
#
# Per-week Gi* is not viable on this data (most weeks have signals in only
# 1-2 counties). Gi* instead runs on the all-time cumulative cross-section:
# 47 counties, queen-contiguity weights, cumulative signal counts. This is
# a textbook areal-hotspot use of Gi* and surfaces the real RVF belt.


def _normalize_risk(z: float | None) -> float:
    """Gi* z-score -> 0-1 risk via a fixed monotonic (logistic) transform.

    Tuned so a non-significant county (z≈0) reads low, a significant
    hotspot (z≈1.96) crosses into "high", and a strong cluster (z≳3.3)
    reaches "critical" — matching riskColor()'s 0.45/0.65/0.85 thresholds.
    """
    if z is None or math.isnan(z):
        return 0.1
    return round(1.0 / (1.0 + math.exp(-(z - 1.0) / 1.3)), 3)


def _compute_gi_star(
    county_ids: list[str],
    neighbors: dict[str, list[str]],
    totals: dict[str, int],
) -> list[dict]:
    """Run Gi* (CPU-bound, sync). Imported lazily so the heavy spatial
    stack only loads in the worker, not the FastAPI process."""
    import numpy as np
    from esda.getisord import G_Local
    from libpysal.weights import W

    y = np.array([totals.get(cid, 0) for cid in county_ids], dtype=float)

    # Degenerate input (no signals anywhere) — Gi* is undefined.
    if np.allclose(y, y[0]):
        return [
            {"county_id": cid, "gi_star_z": None, "gi_p_value": None,
             "risk": _normalize_risk(None)}
            for cid in county_ids
        ]

    w = W(neighbors, silence_warnings=True)
    y_ordered = np.array([totals.get(cid, 0) for cid in w.id_order], dtype=float)
    gi = G_Local(y_ordered, w, transform="R", star=True, permutations=999)

    rows: list[dict] = []
    for cid, z, p in zip(w.id_order, gi.Zs, gi.p_sim):
        zf = None if np.isnan(z) else float(z)
        rows.append(
            {
                "county_id": cid,
                "gi_star_z": zf,
                "gi_p_value": None if np.isnan(p) else float(p),
                "risk": _normalize_risk(zf),
            }
        )
    return rows


@activity.defn
async def compute_getis_ord() -> list[dict]:
    """Getis-Ord Gi* over cumulative county RVF signal counts.

    County adjacency (queen contiguity) is resolved by PostGIS; the Gi*
    statistic itself runs in a worker thread. Returns one scored row per
    county: gi_star_z, gi_p_value, and the normalized 0-1 risk.
    """
    async with async_session_maker() as session:
        county_ids = [
            r[0]
            for r in (
                await session.execute(text("SELECT id FROM counties ORDER BY id"))
            ).all()
        ]
        adjacency = (
            await session.execute(
                text(
                    """
                    SELECT a.id, b.id
                    FROM counties a JOIN counties b
                      ON a.id <> b.id AND ST_Intersects(a.geom, b.geom)
                    """
                )
            )
        ).all()
        totals = {
            cid: int(total)
            for cid, total in (
                await session.execute(
                    text(
                        """
                        SELECT county_id, COALESCE(sum(signal_count), 0)
                        FROM county_week_features GROUP BY county_id
                        """
                    )
                )
            ).all()
        }

    neighbors: dict[str, list[str]] = {cid: [] for cid in county_ids}
    for a, b in adjacency:
        neighbors[a].append(b)

    rows = await asyncio.to_thread(_compute_gi_star, county_ids, neighbors, totals)
    hotspots = sum(1 for r in rows if (r["gi_star_z"] or 0) >= 1.96)
    activity.logger.info(
        "compute_getis_ord scored %d counties (%d significant hotspots)",
        len(rows),
        hotspots,
    )
    return rows


@activity.defn
async def write_county_risk(rows: list[dict]) -> int:
    """Upsert Gi* results into county_risk under the current ISO week."""
    if not rows:
        return 0
    today = date.today()
    week_start = today - timedelta(days=today.weekday())

    stmt = text(
        """
        INSERT INTO county_risk
            (county_id, week_start, risk, gi_star_z, gi_p_value, method, computed_at)
        VALUES (:cid, :wk, :risk, :z, :p, 'getis_ord', now())
        ON CONFLICT (county_id, week_start) DO UPDATE SET
            risk = EXCLUDED.risk,
            gi_star_z = EXCLUDED.gi_star_z,
            gi_p_value = EXCLUDED.gi_p_value,
            method = EXCLUDED.method,
            computed_at = EXCLUDED.computed_at
        """
    )
    async with async_session_maker() as session:
        for r in rows:
            await session.execute(
                stmt,
                {
                    "cid": r["county_id"],
                    "wk": week_start,
                    "risk": r["risk"],
                    "z": r["gi_star_z"],
                    "p": r["gi_p_value"],
                },
            )
        await session.commit()
    activity.logger.info("write_county_risk wrote %d rows for %s", len(rows), week_start)
    return len(rows)
