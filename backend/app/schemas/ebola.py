"""Pydantic schemas for `app/routers/ebola.py`."""

from __future__ import annotations

import datetime as dt
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Only Ministry of Health sources are accepted: an @MOH_Kenya post on X or
# a page on health.go.ke. This is the whole point of the table.
MOH_SOURCE_RE = re.compile(
    r"^https?://("
    r"(www\.)?(x|twitter)\.com/MOH_Kenya/status/\d+"
    r"|([a-z0-9-]+\.)*health\.go\.ke(/|$)"
    r")",
    re.IGNORECASE,
)


class EbolaCaseIn(BaseModel):
    reported_on: dt.date
    confirmed: int = Field(..., ge=0)
    deaths: int = Field(0, ge=0)
    source_url: str = Field(..., max_length=500)
    note: str | None = Field(None, max_length=500)

    @field_validator("source_url")
    @classmethod
    def _moh_only(cls, v: str) -> str:
        v = v.strip()
        if not MOH_SOURCE_RE.match(v):
            raise ValueError(
                "source must be an @MOH_Kenya post (x.com/MOH_Kenya/status/...) "
                "or a health.go.ke page"
            )
        return v


class EbolaCaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reported_on: dt.date
    confirmed: int
    deaths: int
    source_url: str
    note: str | None
    created_at: dt.datetime
