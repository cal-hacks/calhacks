"""The coordinator's answers: a catch-up digest and a plan from shared free time.

Kept apart from the uAgents wiring so it can be tested without Agentverse.
"""

import json
import re

from .activities import GEOCODER, Geocoder, Idea, Nearby, fallback_ideas, locate_friends, miles_between, suggest
from .events import EVENTS, chat_name
from .group import Friend, FriendUpdate, common_free_windows, format_time
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


async def recent_messages(stdb: StdbClient, group_id: int, friends: list[Friend], limit: int = 20) -> list[str]:
    """The chat's last messages as 'Maya: text', oldest first, so ideas fit the conversation."""
    rows = await stdb.sql(f"SELECT id, friend_id, text FROM feed_item WHERE group_id = {group_id} AND kind = 'message'")
    who = {f.id: f.name.split()[0] for f in friends}
    latest = sorted(rows, key=lambda r: r["id"])[-limit:]
    return [f"{who.get(r['friend_id'], 'Someone')}: {r['text']}" for r in latest]


def plan_title(ideas: list[Idea]) -> str:
    """Names the mix, so a plan of meetups doesn't read as a call."""
    in_person = sum(i.in_person for i in ideas)
    if in_person == len(ideas):
        return "Meetup 📍"
    return "Hangout plans 🎉" if in_person else "Virtual hangout 🎬"


async def propose(
    stdb: StdbClient,
    group_id: int,
    updates: list[FriendUpdate],
    *,
    llm: Llm | None = None,
    geo: Geocoder | None = None,
) -> str:
    """Posts a plan to the group chat and returns the options as text.

    Each option is one shared free window plus something to do: in person
    for friends who live close, otherwise a specific virtual hangout. Claude
    (with web search) picks timely ideas; without it, simple ones still post.
    Asking again while a plan is still open points back to it instead of
    posting a duplicate.
    """
    open_plans = await stdb.sql(f"SELECT id FROM plan WHERE group_id = {group_id} AND status = 'open'")
    if open_plans:
        await EVENTS.emit("think", "There’s already a plan open here: vote on it first", group=group_id)
        ids = [p["id"] for p in open_plans]
        rows = await stdb.sql("SELECT plan_id, label FROM plan_option")
        labels = [r["label"] for r in rows if r["plan_id"] == max(ids)]
        listed = "\n".join(f"{i}. {label}" for i, label in enumerate(labels, 1))
        return f"There's already a plan open in the group chat:\n{listed}\nVote there to lock it in."

    friends = [u.friend for u in updates]
    windows = common_free_windows(updates, limit=7)
    if not windows:
        await EVENTS.emit("think", "No time this week when everyone’s free", group=group_id)
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

    await EVENTS.emit(
        "think",
        f"Found {len(windows)} times everyone’s free",
        detail=f"Waiting until after {' and '.join(f.name.split()[0] for f, _ in busy)}’s deadlines" if busy and after else "",
        group=group_id,
        pause=True,
    )

    geo = geo or GEOCODER
    nearby = await locate_friends(friends, geo)
    await explain_nearby(nearby, geo, group_id)
    messages = await recent_messages(stdb, group_id, friends)
    starts = [start for start, _ in picked]
    searching = llm is not None and getattr(llm, "available", True)
    if searching:
        await EVENTS.emit("think", "Asking Claude for ideas, with web search", detail="Reads the chat and what friends shared", group=group_id)
    suggested = await suggest(llm, friends, nearby, updates, starts, messages)
    for query in getattr(llm, "last_queries", []):
        await EVENTS.emit("search", f"Searched “{query}”", group=group_id, pause=True)
    if suggested is None and searching:
        await EVENTS.emit("think", "Search took too long: using quick ideas", group=group_id)
    title, ideas = suggested or ("", fallback_ideas(friends, nearby, len(picked)))
    options = []
    for idea in ideas:
        start, end = picked[idea.window]
        free = f"Everyone's free for {int((end - start).total_seconds() // 3600)}h+{note}"
        options.append({
            "label": f"{idea.label} · {format_time(start, idea.who)}",
            "detail": f"{idea.detail} · {free}" if idea.detail else free,
            "startsAt": start.isoformat(),
        })
    try:
        await stdb.call(
            "propose_plan",
            group_id=group_id,
            title=title or plan_title(ideas),
            options=json.dumps(options),
        )
    except ReducerRejected as e:
        return f"I couldn't post the plan: {e}"
    await EVENTS.emit(
        "post",
        f"Posted a plan to {await chat_name(stdb, group_id)}",
        detail=" · ".join(idea.label for idea in ideas),
        group=group_id,
    )
    listed = "\n".join(f"{i}. {o['label']}" for i, o in enumerate(options, 1))
    return f"Here are some plans for when everyone's free:\n{listed}\nI posted these to the group chat to vote on."


async def explain_nearby(nearby: Nearby, geo: Geocoder, group_id: int) -> None:
    """Who could meet in person, with the distance, for the Agent Network screen."""
    for group in nearby.groups:
        a, b = (await geo.locate(group[0].city), await geo.locate(group[1].city))
        miles = f"{miles_between(a, b):.1f} mi" if a and b else "close"
        names = " and ".join(f.name.split()[0] for f in group)
        await EVENTS.emit("think", f"{names} live {miles} apart → an in-person idea", group=group_id, pause=True)
    if not nearby.groups and len(nearby.unknown) < 2:
        await EVENTS.emit("think", "Everyone lives far apart → virtual ideas", group=group_id, pause=True)


async def answer(
    stdb: StdbClient, llm: Llm, group_id: int, updates: list[FriendUpdate], text: str
) -> str:
    reply = await digest(llm, updates)
    if wants_plan(text):
        reply += "\n\n" + await propose(stdb, group_id, updates, llm=llm)
    return reply
