"""GeoJSON response schema for /counties.geojson.

Shape matches what `KenyaMap.jsx` expects: each feature carries `name`,
`countyId`, `monitored`, and `risk` in `properties`. The route serves
this with `response_model_exclude_none=True`, so `risk` is omitted
entirely for counties without a score — keeping MapLibre's
`["has", "risk"]` expression correct.
"""

from typing import Literal

from pydantic import BaseModel


class CountyProperties(BaseModel):
    name: str
    countyId: str
    monitored: bool
    risk: float | None = None


class CountyFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: dict
    properties: CountyProperties


class CountyFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[CountyFeature]
