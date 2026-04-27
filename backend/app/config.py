from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Sentinel used by the dev defaults below and by .env.example. Any environment
# that ships with this value as its real JWT_SECRET would let anyone forge
# tokens, so we reject it outside dev. Dev gets the sentinel so local docker
# compose can boot without forcing the user to set one immediately.
_PLACEHOLDER_JWT_SECRET = "change-me-in-env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"

    database_url: str = "postgresql+asyncpg://askdocs:askdocs@localhost:5432/askdocs"

    jwt_secret: str = _PLACEHOLDER_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60 * 24

    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o-mini"

    storage_dir: str = "./storage"
    max_upload_bytes: int = 50 * 1024 * 1024

    cors_origins: list[str] = ["http://localhost:3000"]

    @model_validator(mode="after")
    def _reject_placeholder_jwt_secret_outside_dev(self) -> "Settings":
        if self.env == "dev":
            return self
        if not self.jwt_secret.strip() or self.jwt_secret == _PLACEHOLDER_JWT_SECRET:
            raise ValueError(
                "JWT_SECRET is empty or the placeholder value; refusing to "
                "start with ENV != 'dev'. Set JWT_SECRET to a strong random "
                "value (e.g. `openssl rand -base64 48`)."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
