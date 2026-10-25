"""Reset the demo before a run-through.

    uv run python -m agent_service.demo          # reseed: the scene is set, nothing has happened yet
    uv run python -m agent_service.demo --plan   # reseed + a ready-made plan in the Class of '25

Wipes the database (every account, not just the cast, and the Agent Network
history) and seeds the demo world (server/src/seed.ts): a quiet group chat
and a few hints. The demo itself (a goal win, "let's catch up", the cast
replying and voting) happens live. --plan is a backup that posts a real plan
up front: the coordinator reads the chat, geocodes everyone's city and has
Claude search the web, so there's something to show if the network is slow.

Restart the agents after a reset, or wait for them to notice (a few seconds).

Point it at Maincloud with SPACETIMEDB_URI, SPACETIMEDB_DB_NAME and
SPACETIMEDB_TOKEN (the database owner's token), like the agents themselves.
"""

import argparse
import asyncio
import logging
from datetime import UTC, datetime

from .config import load_settings
from .coordinator import propose
from .group import first_group_id, friend_update, group_friends
from .llm import Llm
from .stdb import StdbClient
from .watcher import LOOKBACK

log = logging.getLogger(__name__)


async def reset(plan: bool = False) -> None:
    settings = load_settings()
    stdb = StdbClient(settings.stdb_uri, settings.stdb_db, settings.stdb_token)
    await stdb.call("reset_demo")
    await stdb.call("seed_demo")
    print(f"Reseeded {settings.stdb_db}.")
    if not plan:
        return
    group = await first_group_id(stdb)
    if group is None:
        raise SystemExit("No group after seeding; check the module.")
    if not settings.anthropic_api_key:
        print("No ANTHROPIC_API_KEY: the plan uses the plain fallback ideas.")
    members = await group_friends(stdb, group)
    since = datetime.now(UTC) - LOOKBACK
    updates = [await friend_update(stdb, f, since) for f in members]
    print("Asking Claude for plan ideas (web search; about a minute)…")
    print(await propose(stdb, group, updates, llm=Llm(settings.anthropic_api_key)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset the Waggle demo world.")
    parser.add_argument("--plan", action="store_true", help="also post a ready-made plan in the Class of '25")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(reset(plan=args.plan))


if __name__ == "__main__":
    main()
