import asyncio
import re

from agent_service.director import DECIDING_VOTE_WAIT_S, Director
from agent_service.llm import VISION_MODEL


class FakeStdb:
    """In-memory tables answering the director's SQL, and the reducers it calls."""

    def __init__(self):
        self.tables = {
            # Riley (1) and Maya (2) are signed in; Priya (3) and Sam (4) are the cast.
            "friend": [
                {"id": 1, "name": "Riley Demo", "username": "demo", "identity": "0xabc"},
                {"id": 2, "name": "Maya Chen", "username": "maya_runs", "identity": "0xdef"},
                {"id": 3, "name": "Priya Kumar", "username": "priya.k", "identity": None},
                {"id": 4, "name": "Sam Lee", "username": "sam_l", "identity": None},
            ],
            "friend_group": [{"id": 7, "name": "Class of ’25", "is_direct": False},
                             {"id": 9, "name": "", "is_direct": True}],
            "membership": [{"group_id": 7, "friend_id": f} for f in (1, 2, 3, 4)]
                          + [{"group_id": 9, "friend_id": 1}, {"group_id": 9, "friend_id": 3}],
            "feed_item": [{"id": 1, "group_id": 7, "friend_id": 2, "kind": "message", "text": "it's dead in here", "created_by": "friend"}],
            "plan": [],
            "plan_option": [],
            "plan_vote": [],
        }
        self.calls: list[tuple[str, dict]] = []

    async def sql(self, query: str) -> list[dict]:
        m = re.match(r"SELECT (.+?) FROM (\w+)(?: WHERE (.+))?$", query)
        columns, table, where = m.group(1).split(", "), m.group(2), m.group(3)
        rows = self.tables[table]
        for cond in (where.split(" AND ") if where else []):
            col, val = cond.split(" = ")
            rows = [r for r in rows if str(r[col]) == val.strip("'")]
        return [{c: r[c] for c in columns} for r in rows]

    async def call(self, reducer: str, **args) -> None:
        self.calls.append((reducer, args))
        if reducer == "cast_send_message":
            self.add_item(args["group_id"], args["friend_id"], "message", args["text"], "friend")
        elif reducer == "post_feed_item":
            self.add_item(args["group_id"], args["friend_id"], args["kind"], args["text"], "agent")
        elif reducer == "vote_plan":
            self.vote(args["plan_id"], args["friend_id"], args["option_id"])

    def add_item(self, group, friend, kind, text, by):
        self.tables["feed_item"].append({"id": max(f["id"] for f in self.tables["feed_item"]) + 1, "group_id": group,
                                         "friend_id": friend, "kind": kind, "text": text, "created_by": by})

    def vote(self, plan_id, friend_id, option_id):
        votes = self.tables["plan_vote"]
        votes[:] = [v for v in votes if not (v["plan_id"] == plan_id and v["friend_id"] == friend_id)]
        votes.append({"plan_id": plan_id, "friend_id": friend_id, "option_id": option_id})
        plan = next(p for p in self.tables["plan"] if p["id"] == plan_id)
        members = [m for m in self.tables["membership"] if m["group_id"] == plan["group_id"]]
        if sum(v["option_id"] == option_id for v in votes if v["plan_id"] == plan_id) * 2 > len(members):
            plan.update(status="confirmed", confirmed_option_id=option_id)

    def propose(self, plan_id, group, labels):
        self.tables["plan"].append({"id": plan_id, "group_id": group, "status": "open", "confirmed_option_id": 0, "title": "Plans"})
        for i, label in enumerate(labels):
            self.tables["plan_option"].append({"id": plan_id * 10 + i, "plan_id": plan_id, "label": label})


class FakeLlm:
    def __init__(self, reply="omg yes!!"):
        self.reply = reply
        self.calls = []

    async def write(self, system, prompt, *, effort="low", model=None):
        self.calls.append((system, prompt, model))
        return self.reply


async def settle(d: Director):
    while d.tasks:
        await asyncio.gather(*list(d.tasks))


async def setup(reply="omg yes!!"):
    db, llm = FakeStdb(), FakeLlm(reply)
    d = Director(db, llm, pace=0)  # type: ignore[arg-type]
    await d.tick()  # primes: nothing that already happened gets a response
    assert db.calls == []
    return db, llm, d


def said(db):
    return [(a["friend_id"], a["group_id"], a["text"]) for r, a in db.calls if r == "cast_send_message"]


async def test_a_cast_member_replies_in_a_one_to_one_in_their_voice():
    db, llm, d = await setup()
    db.add_item(9, 1, "message", "you around this weekend?", "friend")
    await d.tick()
    await settle(d)
    assert said(db) == [(3, 9, "omg yes!!")]
    system, prompt, model = llm.calls[0]
    assert "Priya" in system and model == VISION_MODEL
    assert "Riley: you around this weekend?" in prompt


async def test_the_cast_never_answers_itself():
    db, _, d = await setup()
    db.add_item(9, 3, "message", "hiii", "friend")  # Priya (cast) said something
    await d.tick()
    await settle(d)
    assert said(db) == []


async def test_the_named_cast_member_answers_in_a_group():
    db, _, d = await setup("gerald says hi")
    db.add_item(7, 1, "message", "sam how is gerald", "friend")
    await d.tick()
    await settle(d)
    assert said(db) == [(4, 7, "gerald says hi")]


async def test_a_goal_win_gets_reactions_and_a_reply():
    db, _, d = await setup("so proud!!")
    db.add_item(7, 2, "goal_hit", "Maya hit her goal 🎉", "agent")
    await d.tick()
    await settle(d)
    reacts = [a for r, a in db.calls if r == "cast_react"]
    assert {a["friend_id"] for a in reacts} == {3, 4}
    assert all(a["emoji"] in ("🎉", "👏") for a in reacts)
    assert len(said(db)) == 1


async def test_without_claude_the_cast_uses_canned_lines():
    db, _, d = await setup(reply=None)
    db.add_item(9, 1, "message", "hey!", "friend")
    await d.tick()
    await settle(d)
    (_, _, text), = said(db)
    assert text  # one of Priya's canned lines


async def test_cast_votes_stop_short_so_a_person_decides():
    db, _, d = await setup()
    d.pace = 0  # the deciding-vote wait is skipped too, so check the order of votes
    db.propose(5, 7, ["🍕 Pizza · Wed", "🎨 Gartic Phone · Thu"])
    await d.tick()
    # Riley votes first: the cast follows her pick.
    db.vote(5, 1, 51)
    await settle(d)
    votes = [(a["friend_id"], a["option_id"]) for r, a in db.calls if r == "vote_plan"]
    # 4 members: majority is 3. Riley + 2 cast votes for option 51 confirm it.
    assert {o for _, o in votes} == {51}
    assert db.tables["plan"][0]["status"] == "confirmed"
    await d.tick()
    await settle(d)
    locked = [a for r, a in db.calls if r == "post_feed_item"]
    assert locked and locked[0]["kind"] == "plan_locked" and "Gartic Phone" in locked[0]["text"]
    assert DECIDING_VOTE_WAIT_S > 10


async def test_a_reseed_starts_over_quietly():
    db, _, d = await setup()
    db.tables["friend_group"] = [{"id": 12, "name": "Class of ’25", "is_direct": False}]
    db.add_item(12, 1, "message", "hello?", "friend")
    await d.tick()
    await settle(d)
    assert said(db) == []
