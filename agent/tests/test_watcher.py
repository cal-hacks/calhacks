import json
import re
from datetime import UTC, datetime, timedelta

import httpx

from agent_service.group import Friend, FriendUpdate
from agent_service.stdb import StdbClient
from agent_service.watcher import Watcher

COLUMN_TYPES = {"text": {"String": []}, "name": {"String": []}, "timezone": {"String": []},
                "source": {"String": []}, "description": {"String": []}, "status": {"String": []}}


class FakeDb:
    """Answers the watcher's SQL from in-memory tables and records reducer calls."""

    def __init__(self):
        self.tables = {
            "friend": [{"id": 1, "name": "Maya Chen", "timezone": "America/Chicago"},
                       {"id": 2, "name": "Sam Lee", "timezone": "America/Los_Angeles"}],
            "membership": [{"friend_id": 1, "group_id": 7}, {"friend_id": 2, "group_id": 7}],
            "checkin": [{"id": 10, "friend_id": 1, "text": "old news", "source": "app"}],
            "goal": [{"id": 3, "friend_id": 2, "description": "Read 2 books", "status": "active"}],
            "feed_item": [{"id": 50, "group_id": 7, "friend_id": 1, "text": "hey", "kind": "message"}],
            "plan": [],
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
    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    async def write_json(self, system, prompt, schema):
        self.prompts.append(prompt)
        return self.reply


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
    assert json.loads(args["options"])[0]["startsAt"] == start.isoformat()


async def test_reset_restarts_from_new_ids():
    db, w = setup()
    await w.tick(no_updates)
    db.tables["checkin"] = [{"id": 2, "friend_id": 1, "text": "seeded again", "source": "app"}]
    await w.tick(no_updates)
    assert db.calls == [] and not w.primed
    await w.tick(no_updates)
    assert w.last_checkin == 2 and db.calls == []
