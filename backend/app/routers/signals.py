"""Signal feed + ingestion-trigger endpoints.

`GET /signals` is a pure DB read. `POST /refresh` starts the Temporal
`IngestionWorkflow` and returns immediately; `GET /refresh/{workflow_id}`
polls its status — no slow work ever runs inside an HTTP handler.
"""

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from temporalio.client import WorkflowExecutionStatus

from app.config import get_settings
from app.db.models import Signal
from app.db.session import get_session
from app.schemas.signal import SignalOut
from app.temporal.client import get_temporal_client
from app.temporal.workflows import IngestionWorkflow

router = APIRouter(tags=["signals"])


@router.get("/signals", response_model=list[SignalOut])
async def list_signals(
    limit: int = Query(100, ge=1, le=500),
    since: datetime | None = Query(None, description="ISO datetime; only newer signals"),
    county: str | None = Query(None, description="filter by county id (slug)"),
    session: AsyncSession = Depends(get_session),
) -> list[SignalOut]:
    """Signal feed, newest first. Optional `since` / `county` filters."""
    stmt = select(Signal).order_by(Signal.event_time.desc())
    if since is not None:
        stmt = stmt.where(Signal.event_time >= since)
    if county is not None:
        stmt = stmt.where(Signal.county_id == county)
    stmt = stmt.limit(limit)

    rows = (await session.execute(stmt)).scalars().all()
    return [SignalOut.from_signal(s) for s in rows]


@router.post("/refresh", status_code=202)
async def trigger_refresh() -> dict:
    """Start an ingestion run; return immediately with workflow identifiers."""
    settings = get_settings()
    client = await get_temporal_client()
    workflow_id = f"ingest-{uuid4()}"
    handle = await client.start_workflow(
        IngestionWorkflow.run,
        id=workflow_id,
        task_queue=settings.temporal_task_queue,
    )
    return {"workflow_id": workflow_id, "run_id": handle.first_execution_run_id}


@router.get("/refresh/{workflow_id}")
async def refresh_status(workflow_id: str) -> dict:
    """Poll an ingestion run; includes the summary once it has completed."""
    client = await get_temporal_client()
    handle = client.get_workflow_handle(workflow_id)
    try:
        desc = await handle.describe()
    except Exception as exc:  # noqa: BLE001 — unknown id -> 404
        raise HTTPException(status_code=404, detail="workflow not found") from exc

    status = desc.status.name if desc.status else "UNKNOWN"
    result = None
    if desc.status == WorkflowExecutionStatus.COMPLETED:
        result = await handle.result()
    return {"workflow_id": workflow_id, "status": status, "result": result}
