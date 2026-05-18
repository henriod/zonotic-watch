"""Application settings, loaded from environment / `.env` via pydantic-settings.

`get_settings()` is `lru_cache`d so the env is parsed once per process.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://zonotic:zonotic@localhost:5432/zonotic"

    # Temporal
    temporal_address: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "zonoticwatch"

    # CORS — comma-separated origins.
    cors_origins: str = "http://localhost:5173"

    # Ingestion sources (used from rollout step 4 onward).
    gdelt_api_base: str = "https://api.gdeltproject.org"
    apify_token: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
