"""Fetch.ai agents: one friend agent per friend plus the group coordinator.

The coordinator speaks the Agent Chat Protocol, so ASI:One can find and talk
to it. When asked, it messages every friend agent for an update, then answers
with a digest and, if asked, a plan posted to the in-app group chat.

Run from agent/:  uv run python -m agent_service.fetch_agents
Each agent prints an Agentverse inspector link on start; open it once per
agent to connect its mailbox.
"""

import asyncio
import logging
import re
import socket
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from uagents import Agent, Bureau, Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from .config import load_settings
from .coordinator import answer
from .group import Friend, FriendUpdate, first_group_id, friend_update, group_friends
from .llm import Llm
from .stdb import StdbClient
from .watcher import Watcher

log = logging.getLogger(__name__)
LOOKBACK = timedelta(days=7)
README = Path(__file__).resolve().parents[1] / "AGENTS.md"


class UpdateRequest(Model):
    since: str  # ISO time; only share things from after this


class UpdateReply(Model):
    friend_id: int
    name: str
    city: str
    timezone: str
    highlights: list[str]
    free_blocks: list[list[str]]  # [[start, end], ...] ISO


def to_reply(u: FriendUpdate) -> UpdateReply:
    return UpdateReply(
        friend_id=u.friend.id,
        name=u.friend.name,
        city=u.friend.city,
        timezone=u.friend.timezone,
        highlights=u.highlights,
        free_blocks=[[s.isoformat(), e.isoformat()] for s, e in u.free_blocks],
    )


def from_reply(r: UpdateReply) -> FriendUpdate:
    return FriendUpdate(
        Friend(r.friend_id, r.name, r.city, r.timezone),
        r.highlights,
        [(datetime.fromisoformat(s), datetime.fromisoformat(e)) for s, e in r.free_blocks],
    )


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def friend_agent(friend: Friend, seed: str, stdb: StdbClient, *, mailbox: bool = True) -> Agent:
    # Keyed by name, not id: ids change on every reseed, and a new address
    # would have to be connected to Agentverse again.
    agent = Agent(
        name=f"catchup-friend-{slug(friend.name)}",
        seed=f"{seed}/friend/{slug(friend.name)}",
        mailbox=mailbox,
        description=f"Shares {friend.name}'s highlights and free time with their friend group.",
    )

    @agent.on_message(UpdateRequest, replies=UpdateReply)
    async def on_request(ctx: Context, sender: str, msg: UpdateRequest):
        # Look the friend up again: reset_demo/seed_demo give everyone new ids.
        rows = await stdb.sql("SELECT id, name, city, timezone FROM friend")
        current = next((Friend(**r) for r in rows if slug(r["name"]) == slug(friend.name)), friend)
        update = await friend_update(stdb, current, datetime.fromisoformat(msg.since))
        await ctx.send(sender, to_reply(update))

    return agent


def coordinator_agent(
    seed: str,
    stdb: StdbClient,
    llm: Llm,
    group_id: int,
    friend_addresses: list[str],
    *,
    mailbox: bool = True,
) -> Agent:
    agent = Agent(
        name="catchup-coordinator",
        seed=f"{seed}/coordinator",
        mailbox=mailbox,
        readme_path=str(README) if README.exists() else None,
        description=(
            "Catches you up on your long-distance friends and finds a time "
            "everyone's free to call."
        ),
    )
    chat = Protocol(spec=chat_protocol_spec)

    async def gather(ctx: Context) -> list[FriendUpdate]:
        since = (datetime.now(UTC) - LOOKBACK).isoformat()
        results = await asyncio.gather(
            *(
                ctx.send_and_receive(addr, UpdateRequest(since=since), response_type=UpdateReply, timeout=20)
                for addr in friend_addresses
            )
        )
        updates = []
        for reply, status in results:
            if isinstance(reply, UpdateReply):
                updates.append(from_reply(reply))
            else:
                ctx.logger.warning("No update from a friend agent: %s", status)
        return updates

    @chat.on_message(ChatMessage)
    async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
        text = msg.text().strip()
        if not text:
            return
        ctx.logger.info("Chat from %s: %s", sender, text)
        updates = await gather(ctx)
        # Same reason as above: the group id changes after a reseed.
        current_group = await first_group_id(stdb) or group_id
        reply = await answer(stdb, llm, current_group, updates, text)
        ctx.logger.info("Replied with %d characters", len(reply))
        await ctx.send(sender, ChatMessage(content=[TextContent(text=reply), EndSessionContent()]))

    watcher = Watcher(stdb, llm)

    @agent.on_interval(period=3.0)
    async def watch(ctx: Context):
        try:
            await watcher.tick(lambda: gather(ctx))
        except Exception:
            # A bad poll (server restarting, network blip) shouldn't stop the loop.
            ctx.logger.exception("Watcher poll failed")

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    agent.include(chat, publish_manifest=True)
    return agent


async def load_group(settings) -> tuple[int, list[Friend]]:
    stdb = StdbClient(settings.stdb_uri, settings.stdb_db, settings.stdb_token)
    try:
        group_id = await first_group_id(stdb)
        if group_id is None:
            raise SystemExit("No friend group yet. Run seed_demo or join_group first.")
        return group_id, await group_friends(stdb, group_id)
    finally:
        await stdb.aclose()


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("0.0.0.0", port))
        except OSError:
            return True
    return False


def build_bureau() -> Bureau:
    settings = load_settings()
    if port_in_use(settings.fetch_port):
        raise SystemExit(
            f"Port {settings.fetch_port} is in use: the agents are probably already running "
            "in another terminal. Stop that one with Ctrl+C first, or set FETCH_PORT."
        )
    if not settings.fetch_agent_seed:
        raise SystemExit("Set FETCH_AGENT_SEED in .env (any long random string; it fixes the agent addresses).")
    # uAgents runs on the current event loop, so load on that loop and keep it open.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    group_id, friends = loop.run_until_complete(load_group(settings))

    stdb = StdbClient(settings.stdb_uri, settings.stdb_db, settings.stdb_token)
    llm = Llm(settings.anthropic_api_key)
    friends_agents = [friend_agent(f, settings.fetch_agent_seed, stdb) for f in friends]
    coordinator = coordinator_agent(
        settings.fetch_agent_seed, stdb, llm, group_id, [a.address for a in friends_agents]
    )
    bureau = Bureau(port=settings.fetch_port)
    for a in [coordinator, *friends_agents]:
        bureau.add(a)
    # Agents in a Bureau don't print their inspector links, so print them here.
    local = quote(f"http://127.0.0.1:{settings.fetch_port}", safe="")
    named = [("coordinator", coordinator), *((f"friend {f.name}", a) for f, a in zip(friends, friends_agents))]
    for label, a in named:
        log.info("%s: %s", label, a.address)
        log.info("  connect: %s/inspect/?uri=%s&address=%s", a.agentverse.url, local, a.address)
    return bureau


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    build_bureau().run()
