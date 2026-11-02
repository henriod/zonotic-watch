"""County read endpoints — list, GeoJSON boundaries.

All endpoints are pure PostGIS reads. Risk is the latest `county_risk` row
per county; case counts are summed straight from `signals` over the last
`_WINDOW_DAYS` (the old "latest county_week_features row" read showed a
single, often stale or zeroed, week).
"""

import json

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.county import CountyOut
from app.schemas.geojson import CountyFeature, CountyFeatureCollection, CountyProperties
from app.temporal.activities import _ANIMAL_RE, _HUMAN_DISEASES, _HUMAN_RE

router = APIRouter(tags=["counties"])

# Must match the metric cards' /trend window in ZonoticWatch.jsx.
_WINDOW_DAYS = 90

_RISK_JOIN = """
    LEFT JOIN LATERAL (
        SELECT risk FROM county_risk cr
        WHERE cr.county_id = c.id ORDER BY week_start DESC LIMIT 1
    ) r ON true
"""

# Human / animal report counts + most common disease per county, last N days.
_CASES_JOIN = """
    LEFT JOIN LATERAL (
        SELECT count(*) FILTER (
                   WHERE s.text ~* :human_re OR s.disease = ANY(:human_diseases)
               ) AS human,
               count(*) FILTER (WHERE s.text ~* :animal_re) AS animal,
               mode() WITHIN GROUP (ORDER BY s.disease) AS disease
        FROM signals s
        WHERE s.county_id = c.id
          AND s.event_time >= now() - make_interval(days => :days)
    ) f ON true
"""


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
                       r.risk, f.human, f.animal, f.disease
                FROM counties c
                {_RISK_JOIN}
                {_CASES_JOIN}
                ORDER BY c.id
                """
            ),
            {
                "human_re": _HUMAN_RE,
                "animal_re": _ANIMAL_RE,
                "human_diseases": _HUMAN_DISEASES,
                "days": _WINDOW_DAYS,
            },
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
            disease=row["disease"],
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
                {_RISK_JOIN}
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
