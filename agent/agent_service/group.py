"""What a friend agent may share about its friend, and when the group is free.

Friend agents only pass on things that are already shared with the group
(agent posts about the friend, check-ins, goals) plus free/busy times. Free
times count as planning data, so they're shared unless calendar is off.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .stdb import StdbClient

# Agent posts the coordinator repeats in a digest.
HIGHLIGHT_KINDS = {"highlight", "goal_hit", "obscure_place", "roast"}


@dataclass
class Friend:
    id: int
    name: str
    city: str
    timezone: str


@dataclass
class FriendUpdate:
    friend: Friend
    highlights: list[str] = field(default_factory=list)
    free_blocks: list[tuple[datetime, datetime]] = field(default_factory=list)


async def group_friends(stdb: StdbClient, group_id: int) -> list[Friend]:
    member_ids = {
        r["friend_id"]
        for r in await stdb.sql(f"SELECT friend_id FROM membership WHERE group_id = {group_id}")
    }
    rows = await stdb.sql("SELECT id, name, city, timezone FROM friend")
    return [Friend(**r) for r in rows if r["id"] in member_ids]


async def first_group_id(stdb: StdbClient) -> int | None:
    ids = [r["id"] for r in await stdb.sql("SELECT id FROM friend_group")]
    return min(ids) if ids else None


async def friend_update(stdb: StdbClient, friend: Friend, since: datetime) -> FriendUpdate:
    fid = friend.id
    update = FriendUpdate(friend)

    posts = await stdb.sql(f"SELECT kind, text, created_by, created_at FROM feed_item WHERE friend_id = {fid}")
    for p in sorted(posts, key=lambda p: p["created_at"]):
        if p["created_by"] == "agent" and p["kind"] in HIGHLIGHT_KINDS and p["created_at"] >= since:
            update.highlights.append(p["text"])

    checkins = await stdb.sql(f"SELECT text, created_at FROM checkin WHERE friend_id = {fid}")
    for c in sorted(checkins, key=lambda c: c["created_at"]):
        if c["created_at"] >= since:
            update.highlights.append(f"Check-in: {c['text']}")

    goals = await stdb.sql(f"SELECT description, target, progress, status FROM goal WHERE friend_id = {fid}")
    for g in goals:
        state = "done" if g["status"] == "done" else f"{g['progress']:g}/{g['target']:g}"
        update.highlights.append(f"Goal: {g['description']} ({state})")

    calendar = await stdb.sql(
        f"SELECT share_level FROM consent WHERE friend_id = {fid} AND source = 'calendar'"
    )
    if calendar and calendar[0]["share_level"] != "off":
        blocks = await stdb.sql(f"SELECT start, end FROM free_block WHERE friend_id = {fid}")
        update.free_blocks = sorted((b["start"], b["end"]) for b in blocks)
    return update


def common_free_windows(
    updates: list[FriendUpdate],
    *,
    min_length: timedelta = timedelta(hours=1),
    limit: int = 3,
) -> list[tuple[datetime, datetime]]:
    """Earliest windows when every friend is free, at least `min_length` long."""
    if not updates:
        return []
    windows = updates[0].free_blocks
    for u in updates[1:]:
        windows = [
            (max(a0, b0), min(a1, b1))
            for a0, a1 in windows
            for b0, b1 in u.free_blocks
            if max(a0, b0) < min(a1, b1)
        ]
    long_enough = sorted(w for w in windows if w[1] - w[0] >= min_length)
    # One option per day reads better than three back-to-back slots.
    picked, days = [], set()
    for start, end in long_enough:
        if start.date() not in days:
            picked.append((start, end))
            days.add(start.date())
        if len(picked) == limit:
            break
    return picked


def format_time(moment: datetime, friends: list[Friend]) -> str:
    """'Sat Oct 24, 7:00 PM EDT / 4:00 PM PDT', one time per distinct zone."""
    zones = list(dict.fromkeys(f.timezone for f in friends))
    parts = []
    for i, zone in enumerate(zones):
        local = moment.astimezone(ZoneInfo(zone))
        clock = local.strftime("%-I:%M %p %Z")
        parts.append(local.strftime("%a %b %-d, ") + clock if i == 0 else clock)
    return " / ".join(parts)
