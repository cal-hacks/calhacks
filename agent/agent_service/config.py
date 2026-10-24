"""Settings from the repo-root .env (see .env.example)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    stdb_uri: str
    stdb_db: str
    stdb_token: str
    anthropic_api_key: str
    web_origins: list[str]
    fetch_agent_seed: str
    agentverse_api_key: str
    fetch_port: int
    google_token_file: Path


def load_settings() -> Settings:
    token = os.environ.get("SPACETIMEDB_TOKEN", "")
    if not token:
        raise RuntimeError(
            "SPACETIMEDB_TOKEN is not set. Put the owner token "
            "(spacetime login show --token) in .env at the repo root."
        )
    return Settings(
        stdb_uri=os.environ.get("SPACETIMEDB_URI", "http://localhost:3000"),
        stdb_db=os.environ.get("SPACETIMEDB_DB_NAME", "calhacks"),
        stdb_token=token,
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        web_origins=[
            o.strip()
            for o in os.environ.get("WEB_ORIGINS", "*").split(",")
            if o.strip()
        ],
        fetch_agent_seed=os.environ.get("FETCH_AGENT_SEED", ""),
        agentverse_api_key=os.environ.get("AGENTVERSE_API_KEY", ""),
        fetch_port=int(os.environ.get("FETCH_PORT", "8001")),
        google_token_file=Path(
            os.environ.get("GOOGLE_TOKEN_FILE") or REPO_ROOT / "agent" / ".google_tokens.json"
        ),
    )
