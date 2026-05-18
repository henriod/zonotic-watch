"""SQLAlchemy ORM models — schema per docs/backend-plan.md section 2.

`sqlalchemy.text` is imported as `sql_text` because the `signals` table
has a column literally named `text`, which would otherwise shadow it.
"""

from __future__ import annotations

import datetime as dt
import uuid

from geoalchemy2 import Geography, Geometry
from geoalchemy2.elements import WKBElement
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class County(Base):
    """The 47 GADM level-1 polygons; the 14 monitored are a flagged subset."""

    __tablename__ = "counties"

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # slug, matches COUNTIES[].id
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)  # GADM name; join key
    centroid: Mapped[WKBElement | None] = mapped_column(
        Geography("POINT", srid=4326, spatial_index=False)
    )
    geom: Mapped[WKBElement] = mapped_column(
        Geometry("MULTIPOLYGON", srid=4326, spatial_index=False), nullable=False
    )
    monitored: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )

    __table_args__ = (
        Index("ix_counties_geom", "geom", postgresql_using="gist"),
        Index("ix_counties_centroid", "centroid", postgresql_using="gist"),
    )


class IngestRun(Base):
    """One row per Temporal ingestion run, for observability."""

    __tablename__ = "ingest_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=sql_text("gen_random_uuid()"),
    )
    workflow_id: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str | None] = mapped_column(Text)  # RUNNING|SUCCEEDED|FAILED|PARTIAL
    gdelt_count: Mapped[int | None] = mapped_column(Integer)
    apify_count: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[dict | None] = mapped_column(JSONB)


class Signal(Base):
    """Geocoded ingested signals — replaces the SIGNALS seed array."""

    __tablename__ = "signals"

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # source-stable id
    src: Mapped[str] = mapped_column(Text, nullable=False)
    handle: Mapped[str | None] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    disease: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[str | None] = mapped_column(Text)  # CRITICAL|HIGH|MEDIUM|LOW
    confidence: Mapped[float | None] = mapped_column(Float)
    county_id: Mapped[str | None] = mapped_column(ForeignKey("counties.id"))
    loc_name: Mapped[str | None] = mapped_column(Text)
    geom: Mapped[WKBElement | None] = mapped_column(
        Geography("POINT", srid=4326, spatial_index=False)
    )
    event_time: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ingest_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ingest_runs.id")
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sql_text("now()")
    )

    __table_args__ = (
        Index("ix_signals_event_time", sql_text("event_time DESC")),
        Index("ix_signals_county_id", "county_id"),
        Index("ix_signals_disease", "disease"),
    )


class CountyWeekFeature(Base):
    """Phase 2 analytics join point: one row per county × ISO week."""

    __tablename__ = "county_week_features"

    county_id: Mapped[str] = mapped_column(
        ForeignKey("counties.id"), primary_key=True
    )
    week_start: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    signal_count: Mapped[int | None] = mapped_column(Integer)
    human_cases: Mapped[int | None] = mapped_column(Integer)
    animal_cases: Mapped[int | None] = mapped_column(Integer)
    disease_breakdown: Mapped[dict | None] = mapped_column(JSONB)
    mean_severity: Mapped[float | None] = mapped_column(Float)
    weather_temp: Mapped[float | None] = mapped_column(Float)
    weather_rain: Mapped[float | None] = mapped_column(Float)
    weather_humidity: Mapped[float | None] = mapped_column(Float)


class CountyRisk(Base):
    """Phase 2 computed risk output; the map reads the latest week per county."""

    __tablename__ = "county_risk"

    county_id: Mapped[str] = mapped_column(
        ForeignKey("counties.id"), primary_key=True
    )
    week_start: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    risk: Mapped[float | None] = mapped_column(Float)  # 0-1
    gi_star_z: Mapped[float | None] = mapped_column(Float)
    gi_p_value: Mapped[float | None] = mapped_column(Float)
    method: Mapped[str | None] = mapped_column(Text)  # getis_ord|kriging|blended
    computed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
