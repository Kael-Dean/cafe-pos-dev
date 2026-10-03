from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = Field(...)
    TEST_DATABASE_URL: str | None = None

    JWT_SECRET: str = Field(..., min_length=16)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30

    PUSHER_APP_ID: str | None = None
    PUSHER_KEY: str | None = None
    PUSHER_SECRET: str | None = None
    PUSHER_CLUSTER: str = "ap1"

    # Cloudflare R2 (S3-compatible) — product images. Leave blank to disable uploads.
    R2_ACCOUNT_ID: str | None = None
    R2_ACCESS_KEY_ID: str | None = None
    R2_SECRET_ACCESS_KEY: str | None = None
    R2_BUCKET: str | None = None
    # Public base for serving objects, e.g. https://pub-xxxx.r2.dev or https://img.yourcafe.com
    R2_PUBLIC_BASE_URL: str | None = None

    CORS_ORIGINS: str = "http://localhost:3000"

    LOG_LEVEL: str = "INFO"
    ENVIRONMENT: Literal["local", "test", "staging", "production"] = "local"

    @field_validator("DATABASE_URL", "TEST_DATABASE_URL")
    @classmethod
    def _require_async_driver(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must use the postgresql+asyncpg:// driver")
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
