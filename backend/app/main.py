"""FastAPI application factory.

Rollout step 3 (docs/backend-plan.md section 5): health + read endpoints
(`/counties`, `/counties.geojson`, `/signals`) are mounted. Ingestion and
analytics routers are added in later steps.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import analytics, counties, health, signals


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="ZonoticWatch Kenya API", version="0.1.0")

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
    app.include_router(counties.router)
    app.include_router(signals.router)
    app.include_router(analytics.router)
    return app


app = create_app()
