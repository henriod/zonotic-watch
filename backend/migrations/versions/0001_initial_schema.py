"""initial schema: postgis extension + core tables

Revision ID: 0001
Revises:
Create Date: 2026-05-17

Creates the five tables from docs/backend-plan.md section 2:
counties, ingest_runs, signals, county_week_features, county_risk.
Spatial columns use spatial_index=False; GIST indexes are created
explicitly so this migration fully owns the DDL.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography, Geometry
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    # ── counties ─────────────────────────────────────────────────────
    op.create_table(
        "counties",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False, unique=True),
        sa.Column(
            "centroid",
            Geography("POINT", srid=4326, spatial_index=False),
            nullable=True,
        ),
        sa.Column(
            "geom",
            Geometry("MULTIPOLYGON", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column(
            "monitored",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index("ix_counties_geom", "counties", ["geom"], postgresql_using="gist")
    op.create_index(
        "ix_counties_centroid", "counties", ["centroid"], postgresql_using="gist"
    )

    # ── ingest_runs ──────────────────────────────────────────────────
    op.create_table(
        "ingest_runs",
        sa.Column(
            "id",
            sa.UUID(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("gdelt_count", sa.Integer(), nullable=True),
        sa.Column("apify_count", sa.Integer(), nullable=True),
        sa.Column("notes", postgresql.JSONB(), nullable=True),
    )

    # ── signals ──────────────────────────────────────────────────────
    op.create_table(
        "signals",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("src", sa.Text(), nullable=False),
        sa.Column("handle", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("disease", sa.Text(), nullable=True),
        sa.Column("severity", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column(
            "county_id",
            sa.Text(),
            sa.ForeignKey("counties.id"),
            nullable=True,
        ),
        sa.Column("loc_name", sa.Text(), nullable=True),
        sa.Column(
            "geom",
            Geography("POINT", srid=4326, spatial_index=False),
            nullable=True,
        ),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "ingest_run_id",
            sa.UUID(),
            sa.ForeignKey("ingest_runs.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_signals_event_time", "signals", [sa.column("event_time").desc()]
    )
    op.create_index("ix_signals_county_id", "signals", ["county_id"])
    op.create_index("ix_signals_disease", "signals", ["disease"])

    # ── county_week_features ─────────────────────────────────────────
    op.create_table(
        "county_week_features",
        sa.Column(
            "county_id", sa.Text(), sa.ForeignKey("counties.id"), nullable=False
        ),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("signal_count", sa.Integer(), nullable=True),
        sa.Column("human_cases", sa.Integer(), nullable=True),
        sa.Column("animal_cases", sa.Integer(), nullable=True),
        sa.Column("disease_breakdown", postgresql.JSONB(), nullable=True),
        sa.Column("mean_severity", sa.Float(), nullable=True),
        sa.Column("weather_temp", sa.Float(), nullable=True),
        sa.Column("weather_rain", sa.Float(), nullable=True),
        sa.Column("weather_humidity", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("county_id", "week_start"),
    )

    # ── county_risk ──────────────────────────────────────────────────
    op.create_table(
        "county_risk",
        sa.Column(
            "county_id", sa.Text(), sa.ForeignKey("counties.id"), nullable=False
        ),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("risk", sa.Float(), nullable=True),
        sa.Column("gi_star_z", sa.Float(), nullable=True),
        sa.Column("gi_p_value", sa.Float(), nullable=True),
        sa.Column("method", sa.Text(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("county_id", "week_start"),
    )


def downgrade() -> None:
    op.drop_table("county_risk")
    op.drop_table("county_week_features")
    op.drop_index("ix_signals_disease", table_name="signals")
    op.drop_index("ix_signals_county_id", table_name="signals")
    op.drop_index("ix_signals_event_time", table_name="signals")
    op.drop_table("signals")
    op.drop_table("ingest_runs")
    op.drop_index("ix_counties_centroid", table_name="counties")
    op.drop_index("ix_counties_geom", table_name="counties")
    op.drop_table("counties")
    # The PostGIS extension is intentionally left installed.
