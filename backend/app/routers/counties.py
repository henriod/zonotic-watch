"""County read endpoints — list, GeoJSON boundaries.

All endpoints are pure PostGIS reads. Risk and case counts come from the
latest `county_risk` / `county_week_features` rows per county (a LATERAL
join picks the most recent `week_start`).
"""

import json

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.county import CountyOut
from app.schemas.geojson import CountyFeature, CountyFeatureCollection, CountyProperties

router = APIRouter(tags=["counties"])

# Latest risk + week-feature row per county.
_LATEST_JOINS = """
    LEFT JOIN LATERAL (
        SELECT risk FROM county_risk cr
        WHERE cr.county_id = c.id ORDER BY week_start DESC LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL (
        SELECT human_cases, animal_cases, disease_breakdown
        FROM county_week_features cwf
        WHERE cwf.county_id = c.id ORDER BY week_start DESC LIMIT 1
    ) f ON true
"""


def _top_disease(breakdown) -> str | None:
    """Dominant disease from a {disease: count} breakdown (jsonb or str)."""
    if not breakdown:
        return None
    if isinstance(breakdown, str):
        breakdown = json.loads(breakdown)
    return max(breakdown, key=breakdown.get) if breakdown else None


@router.get("/counties", response_model=list[CountyOut])
async def list_counties(session: AsyncSession = Depends(get_session)) -> list[CountyOut]:
    """All 47 counties with current risk and case counts."""
    rows = (
        await session.execute(
            text(
                f"""
                SELECT c.id, c.name, c.monitored,
                       ST_Y(c.centroid::geometry) AS lat,
                       ST_X(c.centroid::geometry) AS lng,
                       r.risk,
                       COALESCE(f.human_cases, 0)  AS human,
                       COALESCE(f.animal_cases, 0) AS animal,
                       f.disease_breakdown
                FROM counties c
                {_LATEST_JOINS}
                ORDER BY c.id
                """
            )
        )
    ).mappings().all()
    return [
        CountyOut(
            id=row["id"],
            name=row["name"],
            monitored=row["monitored"],
            lat=row["lat"],
            lng=row["lng"],
            risk=row["risk"],
            human=row["human"],
            animal=row["animal"],
            disease=_top_disease(row["disease_breakdown"]),
        )
        for row in rows
    ]


@router.get(
    "/counties.geojson",
    response_model=CountyFeatureCollection,
    response_model_exclude_none=True,
)
async def counties_geojson(
    session: AsyncSession = Depends(get_session),
) -> CountyFeatureCollection:
    """GADM polygons as a FeatureCollection, risk in feature properties."""
    rows = (
        await session.execute(
            text(
                f"""
                SELECT c.id, c.name, c.monitored,
                       ST_AsGeoJSON(c.geom) AS geometry,
                       r.risk
                FROM counties c
                {_LATEST_JOINS}
                ORDER BY c.id
                """
            )
        )
    ).mappings().all()
    features = [
        CountyFeature(
            geometry=json.loads(row["geometry"]),
            properties=CountyProperties(
                name=row["name"],
                countyId=row["id"],
                monitored=row["monitored"],
                risk=row["risk"],
            ),
        )
        for row in rows
    ]
    return CountyFeatureCollection(features=features)
