"""Analytics response schemas — trend, disease distribution, county risk."""

from datetime import date

from pydantic import BaseModel


class TrendPoint(BaseModel):
    """One weekly bucket of the case trend."""

    day: str  # short week label, e.g. "May 11"
    human: int
    animal: int
    rvf: int


class DiseaseSlice(BaseModel):
    """One disease's share of the signal feed."""

    name: str
    total: int
    pct: float  # 0-1


class CountyRiskOut(BaseModel):
    """A county's computed risk for one ISO week."""

    county_id: str
    week_start: date
    risk: float | None
    gi_star_z: float | None
    gi_p_value: float | None
    method: str | None
