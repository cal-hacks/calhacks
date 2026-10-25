"""Reset the demo before a run-through.

    uv run python -m agent_service.demo            # reseed + a ready-made plan
    uv run python -m agent_service.demo --no-plan  # reseed only

Wipes the database (every account, not just the cast), seeds the demo world
(server/src/seed.ts) and posts a plan in the Class of '25 chat. The plan is
the real thing, not canned text: the coordinator reads the seeded chat and
what friends shared, geocodes everyone's city (Riley and Priya are close
enough to meet in person) and has Claude search the web for specific ideas,
so it's waiting on screen when the demo starts. Saying "let's catch up" in a
1:1 (Riley and Priya's is set up for it) shows the same thing live.

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


async def reset(plan: bool = True) -> None:
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
    parser.add_argument("--no-plan", action="store_true", help="reseed only; skip the ready-made plan")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(reset(plan=not args.no_plan))


if __name__ == "__main__":
    main()
