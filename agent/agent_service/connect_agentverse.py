"""Connect every running agent's mailbox to Agentverse, without the inspector page.

Does what the inspector's Connect → Mailbox button does: POSTs to each
agent's local /connect endpoint with your Agentverse API key. Run it while
the agents are running, from agent/:

    uv run python -m agent_service.connect_agentverse

Needs AGENTVERSE_API_KEY in .env (Agentverse → profile → API Keys).
"""

import asyncio

import httpx

from .config import load_settings
from .fetch_agents import coordinator_agent, friend_agent, load_group
from .llm import Llm
from .stdb import StdbClient


def agent_addresses(settings, loop) -> list[tuple[str, str]]:
    """(label, address) for each agent, built the same way fetch_agents does."""
    _, friends = loop.run_until_complete(load_group(settings))
    stdb = StdbClient(settings.stdb_uri, settings.stdb_db, settings.stdb_token)
    friends_agents = [friend_agent(f, settings.fetch_agent_seed, stdb) for f in friends]
    coordinator = coordinator_agent(settings.fetch_agent_seed, stdb, Llm(""), 0, [])
    return [("coordinator", coordinator.address)] + [
        (f"friend {f.name}", a.address) for f, a in zip(friends, friends_agents)
    ]


def main() -> None:
    settings = load_settings()
    if not settings.agentverse_api_key:
        raise SystemExit("Set AGENTVERSE_API_KEY in .env (Agentverse → profile → API Keys).")
    if not settings.fetch_agent_seed:
        raise SystemExit("Set FETCH_AGENT_SEED in .env.")
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    url = f"http://127.0.0.1:{settings.fetch_port}/connect"
    for label, address in agent_addresses(settings, loop):
        try:
            r = httpx.post(
                url,
                headers={"x-uagents-address": address},
                json={"user_token": settings.agentverse_api_key, "agent_type": "mailbox"},
                timeout=30,
            )
        except httpx.ConnectError:
            raise SystemExit(f"Nothing on port {settings.fetch_port}. Start the agents first.")
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
        ok = r.status_code == 200 and isinstance(body, dict) and body.get("success")
        print(f"{'connected' if ok else 'FAILED'}  {label}  {address}" + ("" if ok else f"  ({r.status_code}: {body})"))


if __name__ == "__main__":
    main()
