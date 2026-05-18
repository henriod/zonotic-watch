"""Analytics read endpoints — case trend and disease distribution.

`/trend` aggregates `county_week_features` (the analytics join point);
`/diseases` aggregates `signals` directly. Both replace the static
`TREND` / `DISEASES` seed arrays.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.analytics import CountyRiskOut, DiseaseSlice, TrendPoint

router = APIRouter(tags=["analytics"])


def _week_label(d: date) -> str:
    """ISO date of the week's Monday — unique and unambiguous on a chart
    that may span many years of sparse events."""
    return d.isoformat()


@router.get("/trend", response_model=list[TrendPoint])
async def trend(
    days: int = Query(120, ge=7, le=9000, description="lookback window in days"),
    session: AsyncSession = Depends(get_session),
) -> list[TrendPoint]:
    """Weekly human / animal / RVF case trend over `county_week_features`."""
    rows = (
        await session.execute(
            text(
                """
                SELECT week_start,
                       COALESCE(sum(human_cases), 0)  AS human,
                       COALESCE(sum(animal_cases), 0) AS animal,
                       COALESCE(sum(
                           COALESCE((disease_breakdown ->> 'Rift Valley Fever')::int, 0)
                         + COALESCE((disease_breakdown ->> 'RVF')::int, 0)
                       ), 0) AS rvf
                FROM county_week_features
                WHERE week_start >= current_date - make_interval(days => :days)
                GROUP BY week_start
                ORDER BY week_start
                """
            ),
            {"days": days},
        )
    ).mappings().all()
    return [
        TrendPoint(
            day=_week_label(r["week_start"]),
            human=r["human"],
            animal=r["animal"],
            rvf=r["rvf"],
        )
        for r in rows
    ]


@router.get("/diseases", response_model=list[DiseaseSlice])
async def diseases(
    session: AsyncSession = Depends(get_session),
) -> list[DiseaseSlice]:
    """Disease distribution across the whole signal feed, highest first."""
    rows = (
        await session.execute(
            text(
                """
                SELECT disease AS name, count(*) AS total
                FROM signals
                WHERE disease IS NOT NULL
                GROUP BY disease
                ORDER BY total DESC, name
                """
            )
        )
    ).mappings().all()
    grand_total = sum(r["total"] for r in rows) or 1
    return [
        DiseaseSlice(
            name=r["name"],
            total=r["total"],
            pct=round(r["total"] / grand_total, 4),
        )
        for r in rows
    ]


@router.get("/risk", response_model=list[CountyRiskOut])
async def risk(
    week: str | None = Query(None, description="ISO week-start date; latest if omitted"),
    session: AsyncSession = Depends(get_session),
) -> list[CountyRiskOut]:
    """Per-county Gi* risk scores for a week (the latest week by default)."""
    target = week
    if target is None:
        target = (
            await session.execute(text("SELECT max(week_start) FROM county_risk"))
        ).scalar()
    if target is None:
        return []
    rows = (
        await session.execute(
            text(
                """
                SELECT county_id, week_start, risk, gi_star_z, gi_p_value, method
                FROM county_risk
                WHERE week_start = :wk
                ORDER BY risk DESC NULLS LAST
                """
            ),
            {"wk": target},
        )
    ).mappings().all()
    return [CountyRiskOut(**r) for r in rows]
