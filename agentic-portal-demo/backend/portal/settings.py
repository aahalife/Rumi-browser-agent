from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class PortalSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), env_ignore_empty=True, extra="ignore")

    jwt_secret: str = "change-me"
    cookie_secure: bool = False
    access_token_ttl_seconds: int = 300
    refresh_token_ttl_seconds: int = 7 * 24 * 3600
    data_dir: Path = Path("./data")
    reseed: bool = False

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'portal.db'}"


settings = PortalSettings()
