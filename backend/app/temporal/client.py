"""Temporal client helpers.

`get_temporal_client()` returns a process-wide singleton used by routers to
trigger workflows. `ping_temporal()` opens a throwaway connection for health
checks so a stale cached client never masks an outage.
"""

import asyncio

from temporalio.client import Client

from app.config import get_settings

_client: Client | None = None
_lock = asyncio.Lock()


async def get_temporal_client() -> Client:
    """Lazily connect and cache a singleton Temporal client."""
    global _client
    if _client is None:
        async with _lock:
            if _client is None:
                settings = get_settings()
                _client = await Client.connect(
                    settings.temporal_address,
                    namespace=settings.temporal_namespace,
                )
    return _client


async def ping_temporal() -> None:
    """Open a fresh connection purely to verify Temporal is reachable."""
    settings = get_settings()
    await Client.connect(
        settings.temporal_address,
        namespace=settings.temporal_namespace,
    )
