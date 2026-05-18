"""Temporal worker entrypoint.

Runs as its own container/process (see docker-compose.yml). Registers all
workflows and activities on the `zonoticwatch` task queue.

Run locally with:  python -m app.temporal.worker
"""

import asyncio
import logging

from temporalio.worker import Worker

from app.config import get_settings
from app.temporal import activities, workflows
from app.temporal.client import get_temporal_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zonoticwatch.worker")


_MAX_ATTEMPTS = 30
_RETRY_DELAY_SECONDS = 2.0


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
