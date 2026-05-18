"""Temporal workflow definitions.

`IngestionWorkflow` replaces the frontend's `handleRefresh()` fan-out.
GDELT and Apify run as independent activity branches so one source
failing does not abort the other (preserving today's behaviour). All
slow work lives in activities; the workflow only orchestrates.

`RiskComputationWorkflow` (Phase 2, rollout step 8) is started as a
child of this workflow once it exists.
"""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from app.temporal.activities import (
        classify_and_geocode,
        compute_getis_ord,
        create_ingest_run,
        fetch_apify,
        fetch_gdelt,
        finalize_ingest_run,
        ping,
        rebuild_week_features,
        upsert_signals,
        write_county_risk,
    )

# Ingestion tuning — kept here as deterministic workflow constants.
_GDELT_TIMESPAN = "3m"
_GDELT_MAX_RECORDS = 25
_APIFY_MAX_ITEMS = 60


@workflow.defn
class PingWorkflow:
    """Placeholder smoke workflow — round-trips the `ping` activity."""

    @workflow.run
    async def run(self) -> str:
        return await workflow.execute_activity(
            ping, start_to_close_timeout=timedelta(seconds=10)
        )


@workflow.defn
class IngestionWorkflow:
    """Pull from every source, classify + geocode, upsert into `signals`."""

    @workflow.run
    async def run(self) -> dict:
        ingest_run_id = await workflow.execute_activity(
            create_ingest_run,
            workflow.info().workflow_id,
            start_to_close_timeout=timedelta(seconds=30),
        )

        notes: dict[str, str] = {}
        gdelt_rows: list[dict] = []
        apify_rows: list[dict] = []

        # ── Source 1: GDELT news (free, no key). 429 is retryable with a
        #    long initial interval — the durable fix for manual retries. ──
        try:
            articles = await workflow.execute_activity(
                fetch_gdelt,
                args=[_GDELT_TIMESPAN, _GDELT_MAX_RECORDS],
                start_to_close_timeout=timedelta(minutes=3),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=60),
                    backoff_coefficient=2.0,
                    maximum_attempts=3,
                ),
            )
            gdelt_rows = await workflow.execute_activity(
                classify_and_geocode,
                args=[articles, "gdelt"],
                start_to_close_timeout=timedelta(minutes=2),
            )
            notes["gdelt"] = f"{len(gdelt_rows)} signal(s)"
        except ActivityError as exc:
            notes["gdelt"] = f"failed: {exc.cause}"

        # ── Source 2: Apify Tweet Scraper (needs a paid plan). ──
        try:
            items = await workflow.execute_activity(
                fetch_apify,
                args=[_APIFY_MAX_ITEMS],
                start_to_close_timeout=timedelta(minutes=10),
                heartbeat_timeout=timedelta(seconds=45),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )
            apify_rows = await workflow.execute_activity(
                classify_and_geocode,
                args=[items, "apify"],
                start_to_close_timeout=timedelta(minutes=2),
            )
            notes["apify"] = f"{len(apify_rows)} signal(s)"
        except ActivityError as exc:
            notes["apify"] = f"failed: {exc.cause}"

        # ── Upsert everything; ON CONFLICT handles de-dup. ──
        all_rows = gdelt_rows + apify_rows
        inserted = 0
        if all_rows:
            inserted = await workflow.execute_activity(
                upsert_signals,
                args=[all_rows, ingest_run_id],
                start_to_close_timeout=timedelta(minutes=1),
            )

        # ── Phase 2: flow new signals into county_week_features (and, from
        #    step 8, into computed risk) via a child workflow. Best-effort —
        #    a recompute failure does not fail the ingestion run. ──
        try:
            risk = await workflow.execute_child_workflow(
                RiskComputationWorkflow.run,
                id=f"{workflow.info().workflow_id}-risk",
            )
            notes["risk"] = f"{risk.get('week_feature_rows', 0)} week-feature row(s)"
        except Exception as exc:  # noqa: BLE001 — recompute is best-effort
            notes["risk"] = f"recompute failed: {exc}"

        gdelt_failed = notes.get("gdelt", "").startswith("failed")
        apify_failed = notes.get("apify", "").startswith("failed")
        if gdelt_failed and apify_failed:
            status = "FAILED"
        elif gdelt_failed or apify_failed:
            status = "PARTIAL"
        else:
            status = "SUCCEEDED"

        await workflow.execute_activity(
            finalize_ingest_run,
            args=[ingest_run_id, status, len(gdelt_rows), len(apify_rows), notes],
            start_to_close_timeout=timedelta(seconds=30),
        )

        return {
            "ingest_run_id": ingest_run_id,
            "status": status,
            "gdelt_count": len(gdelt_rows),
            "apify_count": len(apify_rows),
            "inserted": inserted,
            "notes": notes,
        }


@workflow.defn
class RiskComputationWorkflow:
    """Phase 2 — derives analytics + risk from ingested signals.

    1. `rebuild_week_features` aggregates `signals` into
       `county_week_features`.
    2. `compute_getis_ord` runs a Getis-Ord Gi* hotspot analysis over the
       cumulative county cross-section (per-week Gi* is not viable on this
       data's density — see docs/backend-plan.md).
    3. `write_county_risk` upserts the normalized risk scores.
    """

    @workflow.run
    async def run(self) -> dict:
        feature_rows = await workflow.execute_activity(
            rebuild_week_features,
            start_to_close_timeout=timedelta(minutes=2),
        )
        gi_results = await workflow.execute_activity(
            compute_getis_ord,
            start_to_close_timeout=timedelta(minutes=3),
        )
        risk_rows = await workflow.execute_activity(
            write_county_risk,
            gi_results,
            start_to_close_timeout=timedelta(minutes=1),
        )
        return {"week_feature_rows": feature_rows, "risk_rows": risk_rows}
