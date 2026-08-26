from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LOCALTRACK_",
        env_file=".env",
        extra="ignore",
    )

    app_name: str = "LocalTrack"
    database_url: str = ""
    data_dir: Path = Path("./data")
    frontend_dist: Path | None = None
    host: str = "0.0.0.0"
    port: int = 8080
    max_upload_bytes: int = 64 * 1024 * 1024
    token_ttl_days: int = 365
    login_rate_limit: int = 10
    login_rate_window_s: int = 300


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.database_url:
        s.database_url = f"sqlite:///{(s.data_dir / 'localtrack.db').as_posix()}"
    if s.frontend_dist is None or str(s.frontend_dist) in ("", "."):
        s.frontend_dist = _repo_root() / "frontend" / "dist"
    return s
