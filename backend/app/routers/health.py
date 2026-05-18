"""Liveness endpoints."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.temporal.client import ping_temporal

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """API liveness — no external dependencies."""
    return {"status": "ok", "service": "zonoticwatch-backend"}


@router.get("/health/temporal")
async def health_temporal() -> JSONResponse:
    """Temporal connectivity probe — opens a fresh connection each call."""
    settings = get_settings()
    try:
        await ping_temporal()
    except Exception as exc:  # noqa: BLE001 — surface any connect failure
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "detail": str(exc)},
        )
    return JSONResponse(
        content={"status": "ok", "temporal_address": settings.temporal_address}
    )
