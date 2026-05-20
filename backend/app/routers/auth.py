"""Auth endpoints — invite-only login + admin-managed users.

Account creation is admin-only; there is no public signup. A bootstrap
admin is seeded in `main.py` lifespan when the table is empty and the
`ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars are set.

Sessions are signed cookies managed by `SessionMiddleware` (in main.py);
this router only writes `user_id` into the session on login and clears
it on logout.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.db.session import get_session
from app.schemas.auth import LoginIn, UserCreate, UserOut
from app.security import (
    current_user,
    hash_password,
    require_admin,
    require_user,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
async def login(
    payload: LoginIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> User:
    user = (
        await session.execute(
            select(User).where(User.username == payload.username)
        )
    ).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid username or password"
        )
    if user.disabled_at is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    request.session["user_id"] = str(user.id)
    return user


@router.post("/logout", response_class=Response, status_code=204)
async def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=204)


@router.get("/me", response_model=UserOut | None)
async def me(user: User | None = Depends(current_user)) -> User | None:
    """Whoami — returns null when unauthenticated (used to hydrate the SPA)."""
    return user


@router.get("/users", response_model=list[UserOut])
async def list_users(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[User]:
    return list(
        (
            await session.execute(select(User).order_by(User.created_at))
        )
        .scalars()
        .all()
    )


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    payload: UserCreate,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> User:
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        created_by=admin.id,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Username '{payload.username}' is taken"
        ) from exc
    await session.refresh(user)
    return user


@router.delete("/users/{user_id}", response_class=Response, status_code=204)
async def disable_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Soft-disable — sets disabled_at and clears the session-bearing column.

    Admins cannot disable themselves (would lock the only admin out).
    """
    if admin.id == user_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Admins cannot disable their own account"
        )
    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.disabled_at is None:
        user.disabled_at = datetime.now(timezone.utc)
        await session.commit()
    return Response(status_code=204)


# Re-exported so other routers can import a single name to gate writes.
__all__ = ["router", "require_user"]
