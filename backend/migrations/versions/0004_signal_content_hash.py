"""signals.content_hash — cross-run de-dup of syndicated stories / retweets

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-03

`content_hash` is a stored generated column (md5 of the lower-cased text
with a leading "RT @user:" dropped and runs of non-word characters
collapsed), so the normalisation lives in exactly one place. The unique
index makes the second copy of a syndicated headline or a retweet a no-op
for `INSERT ... ON CONFLICT DO NOTHING`. Existing duplicates are removed
first (oldest row kept).
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONTENT_HASH_SQL = (
    r"md5(btrim(regexp_replace("
    r"regexp_replace(lower(text), '^rt @\w+:\s*', ''), '\W+', ' ', 'g')))"
)


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE signals ADD COLUMN content_hash text "
        f"GENERATED ALWAYS AS ({CONTENT_HASH_SQL}) STORED"
    )
    op.execute(
        """
        DELETE FROM signals s
        USING signals keep
        WHERE s.content_hash = keep.content_hash
          AND (s.created_at, s.id) > (keep.created_at, keep.id)
        """
    )
    op.create_index(
        "uq_signals_content_hash", "signals", ["content_hash"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_signals_content_hash", table_name="signals")
    op.drop_column("signals", "content_hash")
