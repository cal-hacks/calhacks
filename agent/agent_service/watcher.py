"""Watches the shared world state and acts on it (plan flows B and C).

- A friend's check-in, a goal reaching its target, a workout or big step day
  (Health Shortcut), or a Screen Time win: Claude decides whether it's worth a
  group-chat post, and the friend's agent posts it. An unusual photo becomes a
  "weirdest place" post.
- "We should catch up" (and similar) in a chat (1:1 or group): the coordinator
  finds times everyone in that chat is free, pairs each with something to do
  (in person for friends who live close), and posts a plan to vote on.

Agent posts go to the friend's first group chat, never a 1:1: a highlight is
for the group, and friends with only 1:1 chats get no agent posts.

Python has no SpacetimeDB subscription SDK, so this polls over HTTP SQL and
remembers the last ids it saw. The first poll only records where things are,
so restarting the agents never re-posts old news.
"""

import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from .coordinator import propose
from .group import FriendUpdate, friend_update, group_friends
from .llm import Llm
from .stdb import ReducerRejected, StdbClient

log = logging.getLogger(__name__)

CATCH_UP = re.compile(
    r"\b(catch ?up|hang ?out|get together|plan something|video call|facetime|let'?s (call|meet|hop on))\b",
    re.I,
)
# How far back a plan looks for what each friend shared.
LOOKBACK = timedelta(days=7)

STORY_SYSTEM = """You are a friend's agent in a group chat of college friends who moved to different cities. \
You decide whether one thing that just happened is worth a short post to the group, and write it.

Rules:
- Celebrate wins. Never shame, compare friends, or point out something negative.
- No health interpretations or diagnoses. Don't mention sleep, weight or mood unless it's an obvious win the friend shared.
- If it's too personal, sad, or unclear, set share to false.
- Write in third person about the friend, one or two short sentences, warm and a little playful, one emoji at most.
- Where it fits, end with a light hook for friends to reply to ("Anyone want to join?")."""

ROAST_SYSTEM = """You are a friend's agent in a group chat of college friends. This friend has explicitly \
opted in to being gently roasted. Write one short, affectionate, clearly playful line (third person, one \
emoji at most) that crowns them champion of the stat you're given. Never mean, never about health or worth. \
Set share to false if it could land badly."""

# Steps worth a post on their own.
STEP_WIN = 10_000
# Photos at least this unusual become "weirdest place" posts.
OBSCURE_PLACE = 0.6

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
    last_stat: int = 0
    last_photo: int = 0
    done_goals: set[int] = field(default_factory=set)
    # The demo group: reset_demo + seed_demo makes a new one. New 1:1s and
    # groups appear all the time and don't change it.
    first_group: int | None = None

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
        stats = await self.stdb.sql("SELECT id, friend_id, type, value, source FROM stat")
        photos = await self.stdb.sql("SELECT id, friend_id, place_name, obscurity_score, caption FROM photo")
        done = {g["id"] for g in goals if g["status"] == "done"}

        # reset_demo + seed_demo makes a new group, and ids keep counting up, so
        # the reseeded history would look new. Start over when that happens.
        first_group = min((r["id"] for r in await self.stdb.sql("SELECT id FROM friend_group")), default=None)
        if not self.primed or first_group != self.first_group:
            self.last_checkin = max((c["id"] for c in checkins), default=0)
            self.last_message = max((m["id"] for m in messages), default=0)
            self.last_stat = max((x["id"] for x in stats), default=0)
            self.last_photo = max((p["id"] for p in photos), default=0)
            self.done_goals = done
            self.first_group = first_group
            self.primed = True
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

        new_stats = [x for x in sorted(stats, key=lambda x: x["id"]) if x["id"] > self.last_stat]
        if new_stats:
            self.last_stat = new_stats[-1]["id"]
            await self.stats(friends, new_stats, stats)

        for p in sorted(photos, key=lambda p: p["id"]):
            if p["id"] > self.last_photo:
                self.last_photo = p["id"]
                friend = friends.get(p["friend_id"])
                if friend and p["obscurity_score"] >= OBSCURE_PLACE:
                    # The caption was already written (and consent checked) when it was added.
                    await self.post(friend, "obscure_place", f"Weirdest place of the week: {p['caption']}")

        for m in sorted(messages, key=lambda m: m["id"]):
            if m["id"] > self.last_message:
                self.last_message = m["id"]
                if CATCH_UP.search(m["text"]):
                    await self.plan(m["group_id"], gather)

    async def stats(self, friends: dict[int, Friendly], new: list[dict], all_stats: list[dict]) -> None:
        """Real data (not seed) becomes a post only if the friend shares that source as highlights."""
        consent = {
            (r["friend_id"], r["source"]): r["share_level"]
            for r in await self.stdb.sql("SELECT friend_id, source, share_level FROM consent")
        }
        roast_ok = {
            r["friend_id"]: r["roast_ok"] for r in await self.stdb.sql("SELECT friend_id, roast_ok FROM friend_settings")
        }
        for x in new:
            friend = friends.get(x["friend_id"])
            if friend is None or x["source"] == "seed":
                continue
            try:
                value = json.loads(x["value"])
            except ValueError:
                continue
            health = consent.get((friend.id, "health")) == "highlights"
            if x["type"] == "workout" and health:
                bits = [value.get("kind", "workout")]
                if value.get("distance_km"):
                    bits.append(f"{value['distance_km']} km")
                if value.get("minutes"):
                    bits.append(f"{value['minutes']} min")
                await self.share(friend, "highlight", f"{friend.first} just logged a workout: {', '.join(bits)}.",
                                 fallback=f"{friend.first} got a workout in: {', '.join(bits)} 💪")
            elif x["type"] == "steps" and health and value.get("count", 0) >= STEP_WIN:
                await self.share(friend, "highlight", f"{friend.first} walked {value['count']:,} steps today.",
                                 fallback=f"{friend.first} walked {value['count']:,} steps today 👟")
            elif x["type"] == "screen_time" and consent.get((friend.id, "screen_time")) == "highlights":
                await self.screen_time(friend, value, friends, all_stats, consent, roast_ok)
            # Sleep and Canvas deadlines are never posted: they're for check-on-me and planning only.

    async def screen_time(self, friend, value, friends, all_stats, consent, roast_ok) -> None:
        """Lowest in the group gets praised; highest only as an opted-in roast."""
        latest: dict[int, float] = {}
        for x in sorted(all_stats, key=lambda x: x["id"]):
            if x["type"] == "screen_time" and consent.get((x["friend_id"], "screen_time")) == "highlights":
                try:
                    latest[x["friend_id"]] = float(json.loads(x["value"])["daily_avg_hours"])
                except (ValueError, KeyError, TypeError):
                    pass
        if len(latest) < 2 or friend.id not in latest:
            return
        hours = latest[friend.id]
        if hours == min(latest.values()):
            await self.share(friend, "highlight",
                             f"{friend.first} has the least screen time in the group: {hours:g} hours a day.",
                             fallback=f"Least screen time in the group: {friend.first}, at {hours:g}h a day 🌿")
        elif hours == max(latest.values()) and roast_ok.get(friend.id):
            await self.share(friend, "roast",
                             f"{friend.first} has the most screen time in the group: {hours:g} hours a day.",
                             fallback=f"Screen Time champion of the week 📱👑 {friend.first}, at {hours:g}h a day.",
                             system=ROAST_SYSTEM)

    async def share(
        self, friend: Friendly, kind: str, what: str, *, fallback: str, system: str = STORY_SYSTEM
    ) -> None:
        story = await self.llm.write_json(system, what, STORY_SCHEMA)
        if story is not None and not story["share"]:
            log.info("Agent for %s chose not to share: %s", friend.name, what)
            return
        await self.post(friend, kind, (story or {}).get("text") or fallback)

    async def post(self, friend: Friendly, kind: str, text: str) -> None:
        group = await self.group_of(friend.id)
        if group is None:
            return
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
        """Plans for the people in this chat only. Friends without a running
        agent (signed up since the agents started) are read directly."""
        members = await group_friends(self.stdb, group_id)
        ids = {f.id for f in members}
        updates = [u for u in await gather() if u.friend.id in ids]
        have = {u.friend.id for u in updates}
        since = datetime.now(UTC) - LOOKBACK
        updates += [await friend_update(self.stdb, f, since) for f in members if f.id not in have]
        result = await propose(self.stdb, group_id, updates, llm=self.llm)
        log.info("Catch-up request: %s", result.splitlines()[0])

    async def group_of(self, friend_id: int) -> int | None:
        """The friend's first group chat (not a 1:1), if any."""
        mine = {r["group_id"] for r in await self.stdb.sql(f"SELECT group_id FROM membership WHERE friend_id = {friend_id}")}
        groups = await self.stdb.sql("SELECT id, is_direct FROM friend_group")
        return min((g["id"] for g in groups if g["id"] in mine and not g["is_direct"]), default=None)
