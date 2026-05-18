"""One-off loader: GADM county polygons -> the `counties` table.

Run inside the backend container after `alembic upgrade head`:

    docker compose exec backend python -m scripts.load_counties

Idempotent (ON CONFLICT upsert) — safe to re-run. Geometry and centroid
are computed server-side by PostGIS from the GeoJSON; centroid uses
ST_PointOnSurface so the marker always falls inside the polygon.
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path

from sqlalchemy import text

from app.db.session import async_session_maker, engine

# The 14 counties the dashboard actively monitors. Slug ids here must
# match COUNTIES[].id in src/data/surveillance.js exactly.
MONITORED_IDS: set[str] = {
    "nairobi", "mombasa", "kisumu", "nakuru", "baringo", "turkana",
    "garissa", "marsabit", "isiolo", "mandera", "wajir", "kakamega",
    "kitui", "machakos",
}

# GeoJSON lookup order: explicit env var, the docker-compose mount, then
# the repo path (for host runs).
CANDIDATE_PATHS: list[str | None] = [
    os.environ.get("GADM_GEOJSON"),
    "/app/data/kenya-counties.geojson",
    str(Path(__file__).resolve().parents[2] / "public" / "data" / "kenya-counties.geojson"),
]

UPSERT = text(
    """
    INSERT INTO counties (id, name, geom, centroid, monitored)
    VALUES (
        :id,
        :name,
        ST_Multi(ST_GeomFromGeoJSON(:geojson)),
        ST_PointOnSurface(ST_GeomFromGeoJSON(:geojson))::geography,
        :monitored
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        geom = EXCLUDED.geom,
        centroid = EXCLUDED.centroid,
        monitored = EXCLUDED.monitored
    """
)


def slugify(name: str) -> str:
    """GADM county name -> stable slug id ('Elgeyo-Marakwet' -> 'elgeyo-marakwet')."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "")).strip("-")


def resolve_geojson_path() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    for candidate in CANDIDATE_PATHS:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise FileNotFoundError(
        "kenya-counties.geojson not found. Pass a path argument or set GADM_GEOJSON."
    )


async def main() -> None:
    path = resolve_geojson_path()
    features = json.loads(path.read_text())["features"]
    print(f"Loading {len(features)} county polygons from {path}")

    seen: set[str] = set()
    async with async_session_maker() as session:
        for feat in features:
            name = feat["properties"]["name"]
            cid = slugify(name)
            if cid in seen:
                raise ValueError(f"Duplicate slug '{cid}' for county '{name}'")
            seen.add(cid)
            await session.execute(
                UPSERT,
                {
                    "id": cid,
                    "name": name,
                    "geojson": json.dumps(feat["geometry"]),
                    "monitored": cid in MONITORED_IDS,
                },
            )
        await session.commit()

    # ── verification ─────────────────────────────────────────────────
    async with async_session_maker() as session:
        total = (await session.execute(text("SELECT count(*) FROM counties"))).scalar_one()
        monitored = (
            await session.execute(text("SELECT count(*) FROM counties WHERE monitored"))
        ).scalar_one()
        missing = (
            await session.execute(
                text("SELECT count(*) FROM counties WHERE geom IS NULL OR centroid IS NULL")
            )
        ).scalar_one()
    await engine.dispose()

    print(f"counties: total={total}  monitored={monitored}  missing_geometry={missing}")

    not_loaded = MONITORED_IDS - seen
    ok = (
        total == len(features)
        and monitored == len(MONITORED_IDS)
        and missing == 0
        and not not_loaded
    )
    if not ok:
        if not_loaded:
            print(f"  ERROR: monitored ids never loaded: {sorted(not_loaded)}")
        print("  ERROR: county load did not match expectations.")
        sys.exit(1)
    print("OK — county load verified.")


if __name__ == "__main__":
    asyncio.run(main())
