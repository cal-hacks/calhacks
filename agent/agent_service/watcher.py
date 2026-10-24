"""Watches the shared world state and acts on it (plan flows B and C).

- A friend's check-in or a goal reaching its target: Claude decides whether
  it's worth a group-chat post, and the friend's agent posts it.
- "We should catch up" (and similar) in the chat: the coordinator finds times
  everyone's free and posts a plan to vote on.

Python has no SpacetimeDB subscription SDK, so this polls over HTTP SQL and
remembers the last ids it saw. The first poll only records where things are,
so restarting the agents never re-posts old news.
"""

import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from .coordinator import propose
from .group import FriendUpdate
from .llm import Llm
from .stdb import ReducerRejected, StdbClient

log = logging.getLogger(__name__)

CATCH_UP = re.compile(
    r"\b(catch ?up|hang ?out|get together|plan something|video call|facetime|let'?s (call|meet|hop on))\b",
    re.I,
)

STORY_SYSTEM = """You are a friend's agent in a group chat of college friends who moved to different cities. \
You decide whether one thing that just happened is worth a short post to the group, and write it.

Rules:
- Celebrate wins. Never shame, compare friends, or point out something negative.
- No health interpretations or diagnoses. Don't mention sleep, weight or mood unless it's an obvious win the friend shared.
- If it's too personal, sad, or unclear, set share to false.
- Write in third person about the friend, one or two short sentences, warm and a little playful, one emoji at most.
- Where it fits, end with a light hook for friends to reply to ("Anyone want to join?")."""

STORY_SCHEMA = {
    "type": "object",
    "properties": {
        "share": {"type": "boolean"},
        "text": {"type": "string"},
    },
    "required": ["share", "text"],
    "additionalProperties": False,
}


@dataclass
class Friendly:
    id: int
    name: str
    timezone: str

    @property
    def first(self) -> str:
        return self.name.split()[0]

    def local_date(self, now: datetime | None = None) -> str:
        now = now or datetime.now(UTC)
        try:
            return now.astimezone(ZoneInfo(self.timezone)).date().isoformat()
        except Exception:  # unknown zone name from a profile
            return now.date().isoformat()


@dataclass
class Watcher:
    stdb: StdbClient
    llm: Llm
    primed: bool = False
    last_checkin: int = 0
    last_message: int = 0
    done_goals: set[int] = field(default_factory=set)

    async def tick(self, gather: Callable[[], Awaitable[list[FriendUpdate]]]) -> None:
        """One poll. `gather` asks the friend agents for updates (used for plans)."""
        friends = {
            r["id"]: Friendly(r["id"], r["name"], r["timezone"])
            for r in await self.stdb.sql("SELECT id, name, timezone FROM friend")
        }
        checkins = await self.stdb.sql("SELECT id, friend_id, text, source FROM checkin")
        goals = await self.stdb.sql("SELECT id, friend_id, description, status FROM goal")
        messages = await self.stdb.sql(
            "SELECT id, group_id, friend_id, text FROM feed_item WHERE kind = 'message'"
        )
        done = {g["id"] for g in goals if g["status"] == "done"}

        if not self.primed:
            self.last_checkin = max((c["id"] for c in checkins), default=0)
            self.last_message = max((m["id"] for m in messages), default=0)
            self.done_goals = done
            self.primed = True
            return
        # A reset gives everything new, lower ids; start over from there.
        if checkins and max(c["id"] for c in checkins) < self.last_checkin or (
            messages and max(m["id"] for m in messages) < self.last_message
        ):
            self.primed = False
            return

        for c in sorted(checkins, key=lambda c: c["id"]):
            if c["id"] > self.last_checkin:
                self.last_checkin = c["id"]
                if friend := friends.get(c["friend_id"]):
                    await self.share(friend, "highlight", f"{friend.first} checked in: \"{c['text']}\"",
                                     fallback=f"{friend.first} checked in: {c['text']}")

        for g in goals:
            if g["id"] in done and g["id"] not in self.done_goals:
                if friend := friends.get(g["friend_id"]):
                    await self.share(friend, "goal_hit", f"{friend.first} just reached their goal: {g['description']}.",
                                     fallback=f"{friend.first} hit their goal: {g['description']} 🎯")
        self.done_goals = done

        for m in sorted(messages, key=lambda m: m["id"]):
            if m["id"] > self.last_message:
                self.last_message = m["id"]
                if CATCH_UP.search(m["text"]):
                    await self.plan(m["group_id"], gather)

    async def share(self, friend: Friendly, kind: str, what: str, *, fallback: str) -> None:
        group = await self.group_of(friend.id)
        if group is None:
            return
        story = await self.llm.write_json(STORY_SYSTEM, what, STORY_SCHEMA)
        if story is not None and not story["share"]:
            log.info("Agent for %s chose not to share: %s", friend.name, what)
            return
        text = (story or {}).get("text") or fallback
        try:
            await self.stdb.call(
                "post_feed_item",
                group_id=group,
                friend_id=friend.id,
                kind=kind,
                text=text,
                reply_to_id=0,
                local_date=friend.local_date(),
            )
            log.info("Posted %s for %s", kind, friend.name)
        except ReducerRejected as e:
            # Daily limit or consent: the module said no, so skip.
            log.info("Skipped %s for %s: %s", kind, friend.name, e)

    async def plan(self, group_id: int, gather: Callable[[], Awaitable[list[FriendUpdate]]]) -> None:
        updates = await gather()
        result = await propose(self.stdb, group_id, updates)
        log.info("Catch-up request: %s", result.splitlines()[0])

    async def group_of(self, friend_id: int) -> int | None:
        rows = await self.stdb.sql(f"SELECT group_id FROM membership WHERE friend_id = {friend_id}")
        return rows[0]["group_id"] if rows else None
