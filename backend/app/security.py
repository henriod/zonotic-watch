"""Authentication helpers — bcrypt password hashing and session deps.

The session itself is a signed cookie managed by Starlette's
`SessionMiddleware` (mounted in `main.py`). This module only deals with
hashing passwords and resolving the current user from the session.
"""

from __future__ import annotations

import uuid

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.db.session import get_session

# bcrypt silently truncates inputs beyond 72 bytes; we truncate explicitly so
# the behaviour is documented and consistent across hash/verify.
_BCRYPT_MAX = 72


def _to72(plain: str) -> bytes:
    return plain.encode("utf-8")[:_BCRYPT_MAX]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_to72(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to72(plain), hashed.encode("utf-8"))
    except ValueError:
        return False


async def current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """Resolve the session's user, or None if no/expired/invalid session."""
    raw = request.session.get("user_id")
    if not raw:
        return None
    try:
        user_id = uuid.UUID(raw)
    except (TypeError, ValueError):
        return None
    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None or user.disabled_at is not None:
        return None
    return user


async def require_user(user: User | None = Depends(current_user)) -> User:
    """Auth gate — 401 if no valid session."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return user


async def require_admin(user: User = Depends(require_user)) -> User:
    """Admin gate — 403 if the session user isn't an admin."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return user
