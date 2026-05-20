"""FastAPI application factory.

Mounts the read endpoints (`/counties`, `/counties.geojson`, `/signals`,
`/trend`, `/diseases`, `/risk`), the AI analyzer proxy (`/analyze`), and
the auth router (`/auth/*`). Writes (`POST /refresh`, `POST /analyze`)
are gated by `require_user` in their respective routers.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.db.models import User
from app.db.session import async_session_maker
from app.routers import analytics, analyze, auth, counties, health, signals
from app.security import hash_password


async def _bootstrap_admin() -> None:
    """Seed the first admin from env when the users table is empty.

    Runs idempotently on every startup: if the table already has rows, or
    the env vars are blank, this is a no-op. Resetting an admin's password
    is *not* possible by setting these vars again — that's intentional, so
    a redeploy never silently rotates credentials.
    """
    settings = get_settings()
    if not settings.admin_username or not settings.admin_password:
        return
    async with async_session_maker() as session:
        existing = (await session.execute(select(User).limit(1))).scalar_one_or_none()
        if existing is not None:
            return
        session.add(
            User(
                username=settings.admin_username,
                password_hash=hash_password(settings.admin_password),
                role="admin",
            )
        )
        await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _bootstrap_admin()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ZonoticWatch Kenya API", version="0.2.0", lifespan=lifespan
    )

    # Session cookie middleware — backs the auth router's `request.session`.
    # `https_only=cookie_secure` is True in prod (HTTPS), False on localhost
    # so the cookie still sets during dev.
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie="zw_session",
        same_site="lax",
        https_only=settings.cookie_secure,
        max_age=14 * 24 * 3600,  # 14 days
    )

    # The structural fix for the GDELT-CORS problem: the browser only ever
    # talks to this backend, which sets explicit CORS headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(counties.router)
    app.include_router(signals.router)
    app.include_router(analytics.router)
    app.include_router(analyze.router)
    return app


app = create_app()
