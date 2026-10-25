"""The coordinator's answers: a catch-up digest and a plan from shared free time.

Kept apart from the uAgents wiring so it can be tested without Agentverse.
"""

import json
import re

from .group import FriendUpdate, common_free_windows, format_time
from .llm import Llm
from .stdb import ReducerRejected, StdbClient

PLAN_WORDS = re.compile(r"\b(plan|meet|meetup|call|hang ?out|get together|catch up)\b", re.I)

DIGEST_SYSTEM = """You write a short catch-up digest for a group of college friends who \
live in different cities. You get what each friend's agent chose to share.

Rules:
- Use only the facts given. Don't invent events or numbers.
- Celebrate; never shame or compare who did worse.
- One or two short lines per friend, warm and a little playful. Plain text, no headings.
- End with one line that nudges the group to reply to each other."""


def wants_plan(text: str) -> bool:
    return bool(PLAN_WORDS.search(text))


def plain_digest(updates: list[FriendUpdate]) -> str:
    lines = []
    for u in updates:
        news = "; ".join(u.highlights) if u.highlights else "quiet week so far"
        lines.append(f"• {u.friend.name} ({u.friend.city}): {news}")
    return "\n".join(lines)


async def digest(llm: Llm, updates: list[FriendUpdate]) -> str:
    facts = "\n".join(
        f"{u.friend.name} ({u.friend.city}): "
        + (" | ".join(u.highlights) if u.highlights else "nothing shared")
        for u in updates
    )
    return await llm.write(DIGEST_SYSTEM, facts) or plain_digest(updates)


async def propose(stdb: StdbClient, group_id: int, updates: list[FriendUpdate]) -> str:
    """Posts a plan to the group chat and returns the options as text.

    Asking again while a plan is still open points back to it instead of
    posting a duplicate.
    """
    open_plans = await stdb.sql(f"SELECT id FROM plan WHERE group_id = {group_id} AND status = 'open'")
    if open_plans:
        ids = [p["id"] for p in open_plans]
        rows = await stdb.sql("SELECT plan_id, label FROM plan_option")
        labels = [r["label"] for r in rows if r["plan_id"] == max(ids)]
        listed = "\n".join(f"{i}. {label}" for i, label in enumerate(labels, 1))
        return f"There's already a plan open in the group chat:\n{listed}\nVote there to lock it in."

    friends = [u.friend for u in updates]
    windows = common_free_windows(updates, limit=7)
    if not windows:
        return "I couldn't find a time this week when everyone's free. Want me to check next week?"
    # Prefer times after anyone's heavy week, if there are any.
    busy = [(u.friend, u.busy_through) for u in updates if u.busy_through]
    last_busy = max((d for _, d in busy), default=None)
    after = [w for w in windows if last_busy is None or w[0].date() > last_busy]
    picked = (after or windows)[:3]
    note = ""
    unknown = [u.friend.name.split()[0] for u in updates if not u.free_blocks]
    if unknown:
        note += f"; {' and '.join(unknown)} not sharing a calendar"
    if busy and after:
        names = " and ".join(f.name.split()[0] for f, _ in busy)
        note += f"; after {names}'s deadlines"
    options = [
        {
            "label": f"Video call · {format_time(start, friends)}",
            "detail": f"Everyone's free for {int((end - start).total_seconds() // 3600)}h+{note}",
            "startsAt": start.isoformat(),
        }
        for start, end in picked
    ]
    try:
        await stdb.call(
            "propose_plan",
            group_id=group_id,
            title="Catch-up call 📞",
            options=json.dumps(options),
        )
    except ReducerRejected as e:
        return f"I couldn't post the plan: {e}"
    listed = "\n".join(f"{i}. {o['label']}" for i, o in enumerate(options, 1))
    return f"Here are times when everyone's free:\n{listed}\nI posted these to the group chat to vote on."


async def answer(
    stdb: StdbClient, llm: Llm, group_id: int, updates: list[FriendUpdate], text: str
) -> str:
    reply = await digest(llm, updates)
    if wants_plan(text):
        reply += "\n\n" + await propose(stdb, group_id, updates)
    return reply
