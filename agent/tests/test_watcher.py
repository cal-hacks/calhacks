import json
import re
from datetime import UTC, datetime, timedelta

import httpx

from agent_service.group import Friend, FriendUpdate
from agent_service.stdb import StdbClient
from agent_service.watcher import Watcher

STRING = {"String": []}
COLUMN_TYPES = {c: STRING for c in ("text", "name", "city", "timezone", "source", "description", "status", "type",
                                    "value", "place_name", "caption", "share_level")}
COLUMN_TYPES |= {"obscurity_score": {"F64": []}, "roast_ok": {"Bool": []}, "is_direct": {"Bool": []}}


class FakeDb:
    """Answers the watcher's SQL from in-memory tables and records reducer calls."""

    def __init__(self):
        self.tables = {
            "friend": [{"id": 1, "name": "Maya Chen", "city": "Austin", "timezone": "America/Chicago"},
                       {"id": 2, "name": "Sam Lee", "city": "Seattle", "timezone": "America/Los_Angeles"}],
            "membership": [{"friend_id": 1, "group_id": 7}, {"friend_id": 2, "group_id": 7}],
            "checkin": [{"id": 10, "friend_id": 1, "text": "old news", "source": "app"}],
            "goal": [{"id": 3, "friend_id": 2, "description": "Read 2 books", "status": "active"}],
            "feed_item": [{"id": 50, "group_id": 7, "friend_id": 1, "text": "hey", "kind": "message"}],
            "plan": [],
            "friend_group": [{"id": 7, "is_direct": False}],
            "stat": [{"id": 100, "friend_id": 1, "type": "steps", "value": '{"count": 4000}', "source": "seed"}],
            "photo": [],
            "consent": [
                {"friend_id": 1, "source": "health", "share_level": "highlights"},
                {"friend_id": 2, "source": "health", "share_level": "planning_only"},
                {"friend_id": 1, "source": "screen_time", "share_level": "highlights"},
                {"friend_id": 2, "source": "screen_time", "share_level": "highlights"},
            ],
            "friend_settings": [{"friend_id": 1, "roast_ok": False}, {"friend_id": 2, "roast_ok": True}],
        }
        self.calls: list[tuple[str, dict]] = []
        self.reject: str | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sql"):
            return self.sql(request.content.decode())
        reducer = request.url.path.rsplit("/", 1)[-1]
        if self.reject:
            return httpx.Response(530, text=self.reject)
        self.calls.append((reducer, json.loads(request.content)))
        return httpx.Response(200)

    def sql(self, query: str) -> httpx.Response:
        m = re.match(r"SELECT (.+?) FROM (\w+)(?: WHERE (.+))?$", query)
        columns, table, where = m.group(1).split(", "), m.group(2), m.group(3)
        rows = self.tables[table]
        if where:
            for cond in where.split(" AND "):
                col, val = cond.split(" = ")
                val = val.strip("'")
                rows = [r for r in rows if str(r[col]) == val]
        return httpx.Response(200, json=[{
            "schema": {"elements": [{"name": {"some": c}, "algebraic_type": COLUMN_TYPES.get(c, {"U64": []})} for c in columns]},
            "rows": [[r[c] for c in columns] for r in rows],
        }])


class FakeLlm:
    def __init__(self, reply, ideas=None):
        self.reply = reply
        self.ideas = ideas
        self.prompts = []
        self.idea_prompts = []

    async def write_json(self, system, prompt, schema):
        self.prompts.append(prompt)
        return self.reply

    async def search_json(self, system, prompt):
        self.idea_prompts.append(prompt)
        return self.ideas


async def no_updates():
    return []


def setup(reply={"share": True, "text": "Maya ran her first 10K 🎉 Anyone want to join her next one?"}):
    db = FakeDb()
    stdb = StdbClient("http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(db.handler)))
    return db, Watcher(stdb, FakeLlm(reply))


async def test_first_poll_only_records_history():
    db, w = setup()
    await w.tick(no_updates)
    assert db.calls == []
    assert (w.last_checkin, w.last_message) == (10, 50)


async def test_checkin_becomes_highlight():
    db, w = setup()
    await w.tick(no_updates)
    db.tables["checkin"].append({"id": 11, "friend_id": 1, "text": "ran my first 10K 🎉", "source": "app"})
    await w.tick(no_updates)
    assert w.llm.prompts == ['Maya checked in: "ran my first 10K 🎉"']
    (reducer, args), = db.calls
    assert reducer == "post_feed_item"
    assert args["groupId"] == 7 and args["friendId"] == 1 and args["kind"] == "highlight"
    assert args["text"].startswith("Maya ran her first 10K")
    assert len(args["localDate"]) == 10


async def test_agent_can_decide_not_to_share():
    db, w = setup(reply={"share": False, "text": ""})
    await w.tick(no_updates)
    db.tables["checkin"].append({"id": 11, "friend_id": 1, "text": "rough week honestly", "source": "app"})
    await w.tick(no_updates)
    assert db.calls == []


async def test_without_claude_uses_plain_text():
    db, w = setup(reply=None)
    await w.tick(no_updates)
    db.tables["goal"][0]["status"] = "done"
    await w.tick(no_updates)
    (reducer, args), = db.calls
    assert (args["kind"], args["text"]) == ("goal_hit", "Sam hit their goal: Read 2 books 🎯")
    # Only once per goal.
    await w.tick(no_updates)
    assert len(db.calls) == 1


async def test_rejected_post_is_skipped():
    db, w = setup()
    await w.tick(no_updates)
    db.reject = "already posted about this friend today"
    db.tables["checkin"].append({"id": 11, "friend_id": 1, "text": "another one", "source": "app"})
    await w.tick(no_updates)  # doesn't raise
    assert w.last_checkin == 11


async def test_catch_up_message_proposes_plan():
    db, w = setup()
    await w.tick(no_updates)
    start = datetime(2026, 10, 27, 1, tzinfo=UTC)
    block = [(start, start + timedelta(hours=3))]

    async def updates():
        return [FriendUpdate(Friend(1, "Maya Chen", "Austin", "America/Chicago"), free_blocks=block),
                FriendUpdate(Friend(2, "Sam Lee", "Seattle", "America/Los_Angeles"), free_blocks=block)]

    db.tables["feed_item"].append({"id": 51, "group_id": 7, "friend_id": 2, "text": "ok we should catch up soon", "kind": "message"})
    db.tables["feed_item"].append({"id": 52, "group_id": 7, "friend_id": 1, "text": "lol", "kind": "message"})
    await w.tick(updates)
    (reducer, args), = db.calls
    assert reducer == "propose_plan" and args["groupId"] == 7
    option, = json.loads(args["options"])
    assert option["startsAt"] == start.isoformat()
    # Austin and Seattle are far apart, and the fake Claude has no ideas: a virtual fallback.
    assert option["label"].startswith("🎬 Watch party · ")
    assert args["title"] == "Virtual hangout 🎬"


async def test_plan_ideas_use_the_chat_and_what_friends_shared():
    ideas = {"title": "Game night 🎮", "options": [
        {"slot": 1, "label": "🎮 Gartic Phone night", "detail": "Sam's been asking for a rematch.", "in_person": []},
    ]}
    db, w = setup()
    w.llm.ideas = ideas
    await w.tick(no_updates)
    start = datetime(2026, 10, 27, 1, tzinfo=UTC)
    block = [(start, start + timedelta(hours=3))]

    async def updates():
        return [FriendUpdate(Friend(1, "Maya Chen", "Austin", "America/Chicago"), highlights=["ran a 10K"],
                             free_blocks=block),
                FriendUpdate(Friend(2, "Sam Lee", "Seattle", "America/Los_Angeles"), free_blocks=block)]

    db.tables["feed_item"].append({"id": 51, "group_id": 7, "friend_id": 2, "text": "let's catch up, I miss gartic", "kind": "message"})
    await w.tick(updates)
    prompt, = w.llm.idea_prompts
    assert "Maya: hey" in prompt and "Sam: let's catch up, I miss gartic" in prompt
    assert "Maya: ran a 10K" in prompt
    (_, args), = db.calls
    assert args["title"] == "Game night 🎮"
    option, = json.loads(args["options"])
    assert option["label"].startswith("🎮 Gartic Phone night · ")
    assert option["startsAt"] == start.isoformat()


async def test_reseed_is_not_news():
    db, w = setup()
    await w.tick(no_updates)
    # reset_demo + seed_demo: a new group, and the seeded history gets higher ids.
    db.tables["friend_group"] = [{"id": 8, "is_direct": False}]
    db.tables["checkin"] = [{"id": 20, "friend_id": 1, "text": "seeded again", "source": "app"}]
    db.tables["feed_item"] = [{"id": 90, "group_id": 8, "friend_id": 1, "text": "we should catch up", "kind": "message"}]
    await w.tick(no_updates)
    assert db.calls == []
    assert (w.last_checkin, w.last_message) == (20, 90)
    # Real news after the reseed is still picked up.
    db.tables["checkin"].append({"id": 21, "friend_id": 1, "text": "ran a 10K", "source": "app"})
    db.tables["membership"] = [{"friend_id": 1, "group_id": 8}, {"friend_id": 2, "group_id": 8}]
    await w.tick(no_updates)
    assert len(db.calls) == 1


async def test_posts_go_to_every_chat_the_friend_is_in():
    db, w = setup(reply=None)
    # Maya is in the group (7) and a 1:1 with Sam (3); a 1:1 left by an
    # unfriended friend (4) has only Maya in it.
    db.tables["friend_group"] += [{"id": 3, "is_direct": True}, {"id": 4, "is_direct": True}]
    db.tables["membership"] += [{"friend_id": 1, "group_id": 3}, {"friend_id": 2, "group_id": 3},
                                {"friend_id": 1, "group_id": 4}]
    await w.tick(no_updates)
    db.tables["checkin"].append({"id": 11, "friend_id": 1, "text": "ran a 10K", "source": "app"})
    await w.tick(no_updates)
    assert sorted(a["groupId"] for _, a in db.calls) == [3, 7]
    # Only a 1:1: it still gets there.
    db.calls.clear()
    db.tables["membership"] = [m for m in db.tables["membership"] if m["group_id"] != 7]
    db.tables["checkin"].append({"id": 12, "friend_id": 1, "text": "another 10K", "source": "app"})
    await w.tick(no_updates)
    assert [a["groupId"] for _, a in db.calls] == [3]


async def test_goal_that_arrives_already_done_is_not_news():
    db, w = setup(reply=None)
    await w.tick(no_updates)
    # An app syncs a goal it had already reached before connecting.
    db.tables["goal"].append({"id": 4, "friend_id": 1, "description": "Study at the library", "status": "done"})
    await w.tick(no_updates)
    assert db.calls == []
    # A new goal that's reached later still is.
    db.tables["goal"].append({"id": 5, "friend_id": 1, "description": "Call a friend", "status": "active"})
    await w.tick(no_updates)
    db.tables["goal"][-1]["status"] = "done"
    await w.tick(no_updates)
    (_, args), = db.calls
    assert args["kind"] == "goal_hit" and "Call a friend" in args["text"]


async def test_goal_win_is_posted_even_if_claude_would_skip_it():
    db, w = setup(reply={"share": False, "text": "Sam finished Read 2 books 📚 Who's next?"})
    await w.tick(no_updates)
    db.tables["goal"][0]["status"] = "done"
    await w.tick(no_updates)
    (_, args), = db.calls
    assert args["kind"] == "goal_hit" and args["text"].startswith("Sam finished")


async def test_screen_time_comparisons_stay_in_group_chats():
    db, w = setup(reply=None)
    db.tables["friend_group"].append({"id": 3, "is_direct": True})
    db.tables["membership"] += [{"friend_id": 1, "group_id": 3}, {"friend_id": 2, "group_id": 3}]
    await w.tick(no_updates)
    stat(db, 101, 2, "screen_time", {"daily_avg_hours": 6.4}, source="upload")
    stat(db, 102, 1, "screen_time", {"daily_avg_hours": 2.1}, source="upload")
    await w.tick(no_updates)
    # Maya's praise and Sam's opted-in roast, both only in the group.
    assert sorted((a["kind"], a["groupId"]) for _, a in db.calls) == [("highlight", 7), ("roast", 7)]


async def test_new_chats_do_not_reset_the_watcher():
    db, w = setup(reply=None)
    await w.tick(no_updates)
    db.tables["friend_group"].append({"id": 9, "is_direct": True})
    db.tables["checkin"].append({"id": 11, "friend_id": 1, "text": "ran a 10K", "source": "app"})
    await w.tick(no_updates)
    assert len(db.calls) == 1


async def test_plan_in_a_one_to_one_uses_only_its_two_people():
    db, w = setup()
    db.tables["friend"].append({"id": 4, "name": "Jordan Park", "city": "New York", "timezone": "America/New_York"})
    db.tables["friend_group"].append({"id": 3, "is_direct": True})
    db.tables["membership"] += [{"friend_id": 1, "group_id": 3}, {"friend_id": 2, "group_id": 3}]
    await w.tick(no_updates)
    start = datetime(2026, 10, 27, 1, tzinfo=UTC)
    block = [(start, start + timedelta(hours=3))]

    async def updates():
        # Jordan has no free time, but isn't in this chat, so it doesn't matter.
        return [FriendUpdate(Friend(1, "Maya Chen", "Austin", "America/Chicago"), free_blocks=block),
                FriendUpdate(Friend(2, "Sam Lee", "Seattle", "America/Los_Angeles"), free_blocks=block),
                FriendUpdate(Friend(4, "Jordan Park", "New York", "America/New_York"))]

    db.tables["feed_item"].append({"id": 51, "group_id": 3, "friend_id": 2, "text": "let's catch up this week", "kind": "message"})
    await w.tick(updates)
    (reducer, args), = db.calls
    assert reducer == "propose_plan" and args["groupId"] == 3
    options = json.loads(args["options"])
    assert options[0]["startsAt"] == start.isoformat()
    assert all("Jordan" not in o.get("detail", "") for o in options)


def stat(db, id, friend_id, type, value, source="shortcut"):
    db.tables["stat"].append({"id": id, "friend_id": friend_id, "type": type, "value": json.dumps(value), "source": source})


async def test_workout_becomes_highlight_only_with_health_highlights():
    db, w = setup(reply=None)
    await w.tick(no_updates)
    stat(db, 101, 1, "workout", {"kind": "run", "minutes": 31, "distance_km": 5.2})
    stat(db, 102, 2, "workout", {"kind": "climbing", "minutes": 90})  # Sam: planning_only
    stat(db, 103, 1, "sleep", {"hours": 4.5})  # never posted
    stat(db, 104, 1, "workout", {"kind": "run", "minutes": 20}, source="seed")  # seed is ignored
    await w.tick(no_updates)
    (reducer, args), = db.calls
    assert args["friendId"] == 1 and args["kind"] == "highlight"
    assert args["text"] == "Maya got a workout in: run, 5.2 km, 31 min 💪"


async def test_big_step_day():
    db, w = setup(reply=None)
    await w.tick(no_updates)
    stat(db, 101, 1, "steps", {"count": 9_000})
    stat(db, 102, 1, "steps", {"count": 12_345})
    await w.tick(no_updates)
    assert [a["text"] for _, a in db.calls] == ["Maya walked 12,345 steps today 👟"]


async def test_screen_time_praises_lowest_and_roasts_highest_only_if_opted_in():
    db, w = setup(reply=None)
    await w.tick(no_updates)
    stat(db, 101, 2, "screen_time", {"daily_avg_hours": 6.4}, source="upload")
    await w.tick(no_updates)
    assert db.calls == []  # one person can't be compared with anyone
    stat(db, 102, 1, "screen_time", {"daily_avg_hours": 2.1}, source="upload")
    await w.tick(no_updates)
    (_, praise), = db.calls
    assert praise["friendId"] == 1 and praise["kind"] == "highlight" and "least screen time" in praise["text"].lower()

    db.calls.clear()
    stat(db, 103, 2, "screen_time", {"daily_avg_hours": 7.0}, source="upload")  # Sam opted into roasts
    await w.tick(no_updates)
    (_, roast), = db.calls
    assert roast["friendId"] == 2 and roast["kind"] == "roast"

    db.calls.clear()
    db.tables["friend_settings"][1]["roast_ok"] = False
    stat(db, 104, 2, "screen_time", {"daily_avg_hours": 8.0}, source="upload")
    await w.tick(no_updates)
    assert db.calls == []


async def test_unusual_photo_becomes_weirdest_place():
    db, w = setup()
    await w.tick(no_updates)
    db.tables["photo"] += [
        {"id": 1, "friend_id": 2, "place_name": "Target, Seattle", "obscurity_score": 0.1, "caption": "Sam at Target"},
        {"id": 2, "friend_id": 2, "place_name": "Llama farm, Snohomish", "obscurity_score": 0.9, "caption": "Sam made a llama friend 🦙"},
    ]
    await w.tick(no_updates)
    (_, args), = db.calls
    assert args["kind"] == "obscure_place"
    assert args["text"] == "Weirdest place of the week: Sam made a llama friend 🦙"
    assert w.llm.prompts == []  # captions are written at upload time
