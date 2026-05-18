"""Loader: FAO EMPRES-i Rift Valley fever events (Kenya) -> the `signals` table.

EMPRES-i is authoritative FAO animal-health surveillance: confirmed RVF
events with real coordinates, dates, and human/animal involvement. Each
Kenya event becomes one signal — geocoded by point-in-polygon (the first
source to populate `signals.geom`).

    docker compose exec backend python -m scripts.load_empres_rvf

Idempotent (ON CONFLICT upsert). Afterwards, run a recompute so the
events flow into county_week_features / the analytics endpoints (a
`POST /refresh` triggers it, or start RiskComputationWorkflow directly).
"""

import asyncio
import csv
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from app.db.session import async_session_maker, engine

CANDIDATE_PATHS: list[str | None] = [
    os.environ.get("EMPRES_CSV"),
    "/app/data/empres-rvf-events.csv",
    str(Path(__file__).resolve().parents[2] / "public" / "data" / "empres-rvf-events.csv"),
]

POINT_IN_COUNTY = text(
    """
    SELECT id FROM counties
    WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
    LIMIT 1
    """
)

UPSERT_SIGNAL = text(
    """
    INSERT INTO signals
        (id, src, handle, text, disease, severity, confidence,
         county_id, loc_name, geom, event_time)
    VALUES
        (:id, :src, :handle, :text, :disease, :severity, :confidence,
         :county_id, :loc_name,
         ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
         :event_time)
    ON CONFLICT (id) DO UPDATE SET
        src = EXCLUDED.src, handle = EXCLUDED.handle, text = EXCLUDED.text,
        disease = EXCLUDED.disease, severity = EXCLUDED.severity,
        confidence = EXCLUDED.confidence, county_id = EXCLUDED.county_id,
        loc_name = EXCLUDED.loc_name, geom = EXCLUDED.geom,
        event_time = EXCLUDED.event_time
    """
)


def resolve_csv_path() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    for candidate in CANDIDATE_PATHS:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise FileNotFoundError(
        "empres-rvf-events.csv not found. Pass a path or set EMPRES_CSV."
    )


def _to_int(raw: str | None) -> int:
    """Lenient int parse — EMPRES-i count fields are often blank."""
    raw = (raw or "").strip()
    if not raw:
        return 0
    try:
        return int(float(raw))
    except ValueError:
        return 0


def _event_time(row: dict) -> datetime | None:
    for key in ("observation_date", "Report Date"):
        raw = (row.get(key) or "").strip()
        if raw:
            try:
                return datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def _clean(value: str | None) -> str:
    """Trim, treating the CSV's 'no_value' placeholder as empty."""
    value = (value or "").strip()
    return "" if value.lower() == "no_value" else value


def _signal_text(row: dict, humans: int, deaths: int) -> str:
    animal = _clean(row.get("Animal Species")) or _clean(row.get("Animal Type")) or "livestock"
    locality = _clean(row.get("Locality")) or "Kenya"
    source = _clean(row.get("Diagnosis Source")) or "FAO EMPRES-i"
    parts = [f"Confirmed Rift Valley fever in {animal} at {locality}, Kenya."]
    if humans or deaths:
        parts.append(f"{humans} human case(s), {deaths} death(s).")
    parts.append(f"Source: {source}.")
    return " ".join(parts)


async def main() -> None:
    path = resolve_csv_path()
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rows = [r for r in csv.DictReader(fh) if (r.get("Country") or "").strip() == "Kenya"]
    print(f"Loading {len(rows)} Kenya RVF events from {path}")

    loaded = 0
    geocoded = 0
    skipped = 0
    async with async_session_maker() as session:
        for row in rows:
            event_id = (row.get("Event ID") or "").strip()
            lat_raw = (row.get("lat") or "").strip()
            lon_raw = (row.get("lon") or "").strip()
            event_time = _event_time(row)
            if not event_id or not lat_raw or not lon_raw or event_time is None:
                skipped += 1
                continue
            lat, lon = float(lat_raw), float(lon_raw)

            humans = _to_int(row.get("Humans Affected"))
            deaths = _to_int(row.get("humans_deaths"))
            severity = "CRITICAL" if (humans or deaths) else "HIGH"

            county_id = (
                await session.execute(POINT_IN_COUNTY, {"lat": lat, "lon": lon})
            ).scalar_one_or_none()
            if county_id:
                geocoded += 1
            locality = _clean(row.get("Locality"))

            await session.execute(
                UPSERT_SIGNAL,
                {
                    "id": f"empres-{event_id}",
                    "src": "EMPRES-i",
                    "handle": _clean(row.get("Diagnosis Source")) or "FAO EMPRES-i",
                    "text": _signal_text(row, humans, deaths),
                    "disease": "Rift Valley Fever",
                    "severity": severity,
                    "confidence": 0.95,  # confirmed FAO surveillance
                    "county_id": county_id,
                    "loc_name": locality or "Kenya",
                    "lat": lat,
                    "lon": lon,
                    "event_time": event_time,
                },
            )
            loaded += 1
        await session.commit()

        total_empres = (
            await session.execute(
                text("SELECT count(*) FROM signals WHERE src = 'EMPRES-i'")
            )
        ).scalar_one()
    await engine.dispose()

    print(f"loaded={loaded}  geocoded_to_county={geocoded}  skipped={skipped}")
    print(f"signals with src='EMPRES-i' now in DB: {total_empres}")
    if loaded == 0:
        print("  ERROR: nothing loaded.")
        sys.exit(1)
    print("OK — EMPRES-i RVF events loaded. Run a recompute to update analytics.")


if __name__ == "__main__":
    asyncio.run(main())
