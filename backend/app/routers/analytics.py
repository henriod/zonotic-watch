"""Analytics read endpoints — case trend and disease distribution.

`/trend` and `/diseases` both aggregate `signals` directly. Both replace the static
`TREND` / `DISEASES` seed arrays.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.analytics import CountyRiskOut, DiseaseSlice, TrendPoint
from app.temporal.activities import _ANIMAL_RE, _HUMAN_DISEASES, _HUMAN_RE

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
    """Weekly human / animal / RVF case trend over all `signals`.

    Reads `signals`, not `county_week_features`: most live reports are
    national ("Kenya", no county) and the per-county table drops them.
    Human/animal splits use the same regexes as `rebuild_week_features`.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT date_trunc('week', event_time)::date AS week_start,
                       count(*) FILTER (
                           WHERE text ~* :human_re OR disease = ANY(:human_diseases)
                       ) AS human,
                       count(*) FILTER (WHERE text ~* :animal_re) AS animal,
                       count(*) FILTER (
                           WHERE disease IN ('Rift Valley Fever', 'RVF')
                       ) AS rvf
                FROM signals
                WHERE event_time >= current_date - make_interval(days => :days)
                GROUP BY week_start
                ORDER BY week_start
                """
            ),
            {
                "days": days,
                "human_re": _HUMAN_RE,
                "animal_re": _ANIMAL_RE,
                "human_diseases": _HUMAN_DISEASES,
            },
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
