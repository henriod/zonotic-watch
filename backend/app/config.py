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

    # Ollama Cloud — the AI Signal Analyzer proxies through the backend so
    # the API key never reaches the browser bundle. Blank `ollama_api_key`
    # disables the /analyze endpoint (503).
    ollama_api_url: str = "https://ollama.com"
    ollama_api_key: str = ""
    ollama_model: str = "gemma3:27b-cloud"

    # Auth — invite-only login (see docs/refresh-access-control.md Phase 3).
    # `session_secret` MUST be set in any deployment that serves real users;
    # the default below only exists so a fresh dev checkout boots without
    # blowing up. `cookie_secure=True` in prod (HTTPS); False on localhost.
    # `admin_username` / `admin_password` seed the first admin on startup
    # when the users table is empty; leave blank after that to avoid resets.
    session_secret: str = "dev-only-change-me-in-prod"
    cookie_secure: bool = False
    admin_username: str = ""
    admin_password: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
