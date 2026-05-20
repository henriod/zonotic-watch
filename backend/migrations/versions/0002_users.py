"""users table for invite-only auth

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-20

Adds a `users` table for login-gated endpoints (`/refresh`, `/analyze`).
Account creation is admin-only; a bootstrap admin is seeded on first
backend startup from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("username", sa.Text(), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "role", sa.Text(), nullable=False, server_default=sa.text("'analyst'")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('admin','analyst')", name="users_role_chk"),
    )


def downgrade() -> None:
    op.drop_table("users")
