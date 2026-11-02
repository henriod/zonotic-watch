"""ebola_cases table — MoH-confirmed Ebola case figures

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-02

Ebola case numbers are sensitive and never derived from media volume.
Admins record each Ministry of Health (@MOH_Kenya) confirmed figure with
its source post; the dashboard shows the latest entry.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ebola_cases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("reported_on", sa.Date(), nullable=False),
        sa.Column("confirmed", sa.Integer(), nullable=False),
        sa.Column("deaths", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("confirmed >= 0 AND deaths >= 0", name="ebola_cases_nonneg_chk"),
    )


def downgrade() -> None:
    op.drop_table("ebola_cases")
