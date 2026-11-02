"""Temporal worker entrypoint.

Runs as its own container/process (see docker-compose.yml). Registers all
workflows and activities on the `zonoticwatch` task queue.

Run locally with:  python -m app.temporal.worker
"""

import asyncio
import logging
from datetime import timedelta

from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleAlreadyRunningError,
    ScheduleIntervalSpec,
    ScheduleOverlapPolicy,
    SchedulePolicy,
    ScheduleSpec,
)
from temporalio.worker import Worker

from app.config import get_settings
from app.temporal import activities, workflows
from app.temporal.client import get_temporal_client

logging.basicConfig(level=logging.INFO)
# httpx logs every request URL at INFO; keep it quiet so no credential in a
# URL can ever reach the logs.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("zonoticwatch.worker")


_MAX_ATTEMPTS = 30
_RETRY_DELAY_SECONDS = 2.0
_SCHEDULE_ID = "ingest-schedule"


async def ensure_ingest_schedule(client: Client, interval_minutes: int) -> None:
    """Create the recurring GDELT-only ingestion schedule (idempotent).

    Workflow ids are "ingest-scheduled-<ts>" so GET /refresh/{id} can
    describe them. OVERLAP SKIP means a slow run is never stacked.
    """
    if interval_minutes <= 0:
        logger.info("Ingestion schedule disabled (INGEST_INTERVAL_MINUTES=0)")
        return
    settings = get_settings()
    try:
        await client.create_schedule(
            _SCHEDULE_ID,
            Schedule(
                action=ScheduleActionStartWorkflow(
                    workflows.IngestionWorkflow.run,
                    ["gdelt"],
                    id="ingest-scheduled",
                    task_queue=settings.temporal_task_queue,
                ),
                spec=ScheduleSpec(
                    intervals=[ScheduleIntervalSpec(every=timedelta(minutes=interval_minutes))]
                ),
                policy=SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP),
            ),
        )
        logger.info("Created ingestion schedule every %d min", interval_minutes)
    except ScheduleAlreadyRunningError:
        # ponytail: interval changes need a delete in the Temporal UI; add
        # handle.update() if the interval is ever tuned in prod.
        logger.info("Ingestion schedule already exists")


async def main() -> None:
    settings = get_settings()

    # Temporal's auto-setup registers the `default` namespace shortly after
    # its container starts. docker-compose gates us on a healthcheck, but
    # retry anyway so a host run (or any transient hiccup) self-heals
    # instead of crashing with a NamespaceNotFound validation error.
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            client = await get_temporal_client()
            worker = Worker(
                client,
                task_queue=settings.temporal_task_queue,
                workflows=[
                    workflows.PingWorkflow,
                    workflows.IngestionWorkflow,
                    workflows.RiskComputationWorkflow,
                ],
                activities=[
                    activities.ping,
                    activities.create_ingest_run,
                    activities.fetch_gdelt,
                    activities.fetch_apify,
                    activities.classify_and_geocode,
                    activities.upsert_signals,
                    activities.finalize_ingest_run,
                    activities.rebuild_week_features,
                    activities.compute_getis_ord,
                    activities.write_county_risk,
                ],
            )
            logger.info(
                "Worker started on task queue '%s'", settings.temporal_task_queue
            )
            await ensure_ingest_schedule(client, settings.ingest_interval_minutes)
            await worker.run()
            return
        except RuntimeError as exc:
            transient = "Namespace" in str(exc) or "NotFound" in str(exc)
            if not transient or attempt == _MAX_ATTEMPTS:
                raise
            logger.warning(
                "Temporal not ready (attempt %d/%d): %s",
                attempt,
                _MAX_ATTEMPTS,
                exc,
            )
            await asyncio.sleep(_RETRY_DELAY_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
