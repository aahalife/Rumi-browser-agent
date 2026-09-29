from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class AgentSettings(BaseSettings):
    # Repo-root .env first, then backend/.env overrides it; empty values never override.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), env_ignore_empty=True, extra="ignore")

    llm_provider: Literal["rork", "anthropic", "bedrock"] = "rork"
    llm_model: str = "anthropic/claude-sonnet-5.5"
    expo_public_toolkit_url: str = ""
    expo_public_rork_toolkit_secret_key: str = ""
    llm_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    # The SDK reads ANTHROPIC_API_KEY from the process env; this also picks it up from .env.
    anthropic_api_key: str | None = None
    aws_region: str = "us-east-1"
    perception_mode: Literal["dom", "screenshot"] = "dom"
    max_steps: int = 30
    # How many recent observations stay in full; older ones collapse to one line plus a text excerpt.
    keep_observations: int = 3
    demo_api_key: str = "change-me"
    traces_dir: Path = Path("./data/traces")
    action_timeout_seconds: float = 20
    llm_timeout_seconds: float = 60
    confirm_timeout_seconds: float = 300


settings = AgentSettings()
