"""County response schema — county list with current risk + case counts."""

from pydantic import BaseModel


class CountyOut(BaseModel):
    id: str
    name: str
    monitored: bool
    lat: float | None = None
    lng: float | None = None
    risk: float | None = None  # latest county_risk; null until Phase 2 for unseeded
    human: int = 0
    animal: int = 0
    disease: str | None = None  # dominant disease from the latest week features
