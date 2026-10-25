import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from agent_service.activities import Geocoder, group_nearby, locate_friends, miles_between
from agent_service.coordinator import plain_digest, propose, wants_plan
from agent_service.group import Friend, FriendUpdate, common_free_windows, format_time
from agent_service.stdb import StdbClient
from tests.conftest import CITIES

MAYA = Friend(1, "Maya", "New York", "America/New_York")
SAM = Friend(2, "Sam", "Austin", "America/Chicago")
JORDAN = Friend(3, "Jordan", "San Francisco", "America/Los_Angeles")


def at(day: int, hour: float) -> datetime:
    return datetime(2026, 10, 24, tzinfo=UTC) + timedelta(days=day, hours=hour)


def test_common_windows_intersect_everyone():
    updates = [
        FriendUpdate(MAYA, free_blocks=[(at(0, 22), at(1, 2)), (at(1, 22), at(2, 2))]),
        FriendUpdate(SAM, free_blocks=[(at(0, 23), at(1, 3)), (at(1, 23), at(1, 23.5))]),
        FriendUpdate(JORDAN, free_blocks=[(at(1, 0), at(1, 5))]),
    ]
    # Day 0: everyone overlaps 00:00-02:00 on day 1. Day 1's overlap is 30 min, too short.
    assert common_free_windows(updates) == [(at(1, 0), at(1, 2))]


def test_common_windows_one_per_day_and_limit():
    blocks = [(at(d, 18), at(d, 22)) for d in range(5)] + [(at(0, 23), at(0, 23.9))]
    updates = [FriendUpdate(MAYA, free_blocks=blocks), FriendUpdate(SAM, free_blocks=blocks)]
    assert common_free_windows(updates) == [(at(d, 18), at(d, 22)) for d in range(3)]


def test_friends_without_calendar_data_dont_block_a_plan():
    block = [(at(0, 1), at(0, 5))]
    assert common_free_windows([FriendUpdate(MAYA, free_blocks=block), FriendUpdate(SAM)]) == block
    assert common_free_windows([FriendUpdate(MAYA), FriendUpdate(SAM)]) == []


def test_format_time_lists_each_zone_once():
    # 23:00 UTC Oct 24 = 7 PM EDT = 4 PM PDT
    assert format_time(at(0, 23), [MAYA, JORDAN, MAYA]) == "Sat Oct 24, 7:00 PM EDT / 4:00 PM PDT"


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Catch me up on my friends and plan something for this week", True),
        ("can we set up a call?", True),
        ("what's new with everyone?", False),
    ],
)
def test_wants_plan(text, expected):
    assert wants_plan(text) is expected


def test_plain_digest():
    text = plain_digest([FriendUpdate(MAYA, highlights=["ran 8 km"]), FriendUpdate(SAM)])
    assert text == "• Maya (New York): ran 8 km\n• Sam (Austin): quiet week so far"


async def test_propose_posts_plan_with_options():
    calls = []

    def handler(request: httpx.Request):
        if request.url.path.endswith("/sql"):
            return httpx.Response(200, json=[{"schema": {"elements": []}, "rows": []}])
        calls.append((request.url.path, json.loads(request.content)))
        return httpx.Response(200)

    stdb = StdbClient("http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    block = [(at(0, 23), at(1, 2))]
    text = await propose(stdb, 7, [FriendUpdate(MAYA, free_blocks=block), FriendUpdate(JORDAN, free_blocks=block)])

    path, body = calls[0]
    assert path == "/v1/database/calhacks/call/propose_plan"
    assert body["groupId"] == 7
    options = json.loads(body["options"])
    # New York and San Francisco are far apart and there's no Claude: a virtual idea.
    assert body["title"] == "Virtual hangout 🎬"
    assert options == [{
        "label": "🎬 Watch party · Sat Oct 24, 7:00 PM EDT / 4:00 PM PDT",
        "detail": "Pick a movie, sync it up with Teleparty or a shared screen, and react together. · Everyone's free for 3h+",
        "startsAt": "2026-10-24T23:00:00+00:00",
    }]
    assert "1. 🎬 Watch party" in text


def sql_rows(columns, rows):
    return httpx.Response(200, json=[{
        "schema": {"elements": [{"name": {"some": c}, "algebraic_type": {"U64": []}} for c in columns]},
        "rows": rows,
    }])


async def test_propose_without_common_time_posts_nothing():
    def handler(request: httpx.Request):
        if request.url.path.endswith("/sql"):
            return sql_rows(["id"], [])
        return httpx.Response(500)

    stdb = StdbClient("http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    text = await propose(stdb, 7, [FriendUpdate(MAYA), FriendUpdate(SAM)])
    assert "couldn't find a time" in text


async def test_propose_reuses_open_plan():
    def handler(request: httpx.Request):
        query = request.content.decode()
        if "FROM plan_option" in query:
            return httpx.Response(200, json=[{
                "schema": {"elements": [
                    {"name": {"some": "plan_id"}, "algebraic_type": {"U64": []}},
                    {"name": {"some": "label"}, "algebraic_type": {"String": []}},
                ]},
                "rows": [[4, "Video call · Tue"], [5, "Video call · Wed"]],
            }])
        if "FROM plan" in query:
            return sql_rows(["id"], [[4], [5]])
        raise AssertionError("should not call a reducer")

    stdb = StdbClient("http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    block = [(at(0, 23), at(1, 2))]
    text = await propose(stdb, 7, [FriendUpdate(MAYA, free_blocks=block)])
    assert text == "There's already a plan open in the group chat:\n1. Video call · Wed\nVote there to lock it in."


async def test_propose_prefers_times_after_a_heavy_week():
    calls = []

    def handler(request: httpx.Request):
        if request.url.path.endswith("/sql"):
            return httpx.Response(200, json=[{"schema": {"elements": []}, "rows": []}])
        calls.append(json.loads(request.content))
        return httpx.Response(200)

    stdb = StdbClient("http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    blocks = [(at(d, 23), at(d + 1, 2)) for d in range(6)]
    jordan = FriendUpdate(JORDAN, free_blocks=blocks, busy_through=at(2, 0).date())
    await propose(stdb, 7, [FriendUpdate(MAYA, free_blocks=blocks), jordan])
    options = json.loads(calls[0]["options"])
    # Oct 24-26 are Jordan's deadline days; the first option is the 27th.
    assert [o["startsAt"][:10] for o in options] == ["2026-10-27", "2026-10-28", "2026-10-29"]
    assert options[0]["detail"].endswith("after Jordan's deadlines")


BEN = Friend(4, "Ben Ortiz", "Brooklyn, NY", "America/New_York")
NOWHERE = Friend(5, "Riley Fox", "", "America/New_York")


def recording_stdb(messages=()):
    """A StdbClient whose SQL returns no rows (except chat messages) and that records reducer calls."""
    calls = []

    def handler(request: httpx.Request):
        if request.url.path.endswith("/sql"):
            if "FROM feed_item" in request.content.decode():
                return httpx.Response(200, json=[{
                    "schema": {"elements": [
                        {"name": {"some": "id"}, "algebraic_type": {"U64": []}},
                        {"name": {"some": "friend_id"}, "algebraic_type": {"U64": []}},
                        {"name": {"some": "text"}, "algebraic_type": {"String": []}},
                    ]},
                    "rows": [list(m) for m in messages],
                }])
            return httpx.Response(200, json=[{"schema": {"elements": []}, "rows": []}])
        calls.append(json.loads(request.content))
        return httpx.Response(200)

    return StdbClient("http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(handler))), calls


def test_distance():
    assert miles_between(CITIES["new york"], CITIES["brooklyn, ny"]) < 20
    assert 2500 < miles_between(CITIES["new york"], CITIES["san francisco"]) < 2600
    assert 15 < miles_between(CITIES["austin, tx"], CITIES["round rock, tx"]) < 20


async def test_nearby_groups_near_far_and_unknown():
    nearby = await locate_friends([MAYA, JORDAN, BEN, NOWHERE])
    assert [[f.name for f in g] for g in nearby.groups] == [["Maya", "Ben Ortiz"]]
    assert nearby.unknown == [NOWHERE]
    assert not nearby.everyone
    # Unknown cities (not just empty ones) also count as unknown.
    lost = Friend(6, "Kai", "Atlantis", "UTC")
    assert (await locate_friends([MAYA, lost])).unknown == [lost]
    assert (await locate_friends([MAYA, BEN])).everyone


def test_nearby_requires_everyone_in_a_group_to_be_close():
    a, b, c = (Friend(i, n, "", "UTC") for i, n in [(1, "A"), (2, "B"), (3, "C")])
    # B is 15 miles from A and from C, but A and C are 30 miles apart.
    where = {1: (40.0, -74.0), 2: (40.0, -73.716), 3: (40.0, -73.432)}
    nearby = group_nearby([a, b, c], where)
    assert [[f.name for f in g] for g in nearby.groups] == [["A", "B"]]
    assert not nearby.everyone


async def test_geocoder_caches_and_tolerates_failures(monkeypatch):
    monkeypatch.undo()  # use the real lookup, against fake OpenStreetMap and Open-Meteo
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        if request.url.host == "geocoding-api.open-meteo.com":
            return httpx.Response(200, json={})  # nothing found there either
        q = request.url.params["q"]
        if q == "austin, tx":
            return httpx.Response(200, json=[{"lat": "30.2672", "lon": "-97.7431"}])
        if q == "nowhere":
            return httpx.Response(200, json=[])
        return httpx.Response(503)

    geo = Geocoder(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert await geo.locate("Austin,  TX") == (30.2672, -97.7431)
    assert await geo.locate("austin, tx") == (30.2672, -97.7431)
    assert await geo.locate("nowhere") is None
    assert await geo.locate("Down, Server") is None
    assert await geo.locate("down, server") is None
    assert await geo.locate("  ") is None
    osm = [r.url.params["q"] for r in seen if r.url.host == "nominatim.openstreetmap.org"]
    assert osm == ["austin, tx", "nowhere", "down, server"]  # each city looked up once
    assert seen[0].headers["User-Agent"].startswith("Waggle/")


async def test_geocoder_falls_back_to_open_meteo_and_picks_the_right_state(monkeypatch):
    monkeypatch.undo()

    def handler(request: httpx.Request):
        if request.url.host == "nominatim.openstreetmap.org":
            return httpx.Response(403)  # blocked, as it often is for cloud hosts
        assert request.url.params["name"] == "berkeley"
        return httpx.Response(200, json={"results": [
            {"name": "Berkeley Springs", "admin1": "West Virginia", "country_code": "US", "latitude": 39.6, "longitude": -78.2},
            {"name": "Berkeley", "admin1": "California", "country_code": "US", "latitude": 37.87, "longitude": -122.27},
        ]})

    geo = Geocoder(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert await geo.locate("Berkeley, CA") == (37.87, -122.27)


async def test_fallback_meets_in_person_when_everyone_is_close():
    stdb, calls = recording_stdb()
    blocks = [(at(d, 23), at(d + 1, 2)) for d in range(2)]
    austin = Friend(1, "Maya Chen", "Austin, TX", "America/Chicago")
    round_rock = Friend(2, "Sam Lee", "Round Rock, TX", "America/Chicago")
    await propose(stdb, 7, [FriendUpdate(austin, free_blocks=blocks), FriendUpdate(round_rock, free_blocks=blocks)])
    body, = calls
    assert body["title"] == "Meetup 📍"
    labels = [o["label"] for o in json.loads(body["options"])]
    assert labels == ["☕ Coffee meetup in Austin · Sat Oct 24, 6:00 PM CDT", "🍜 Dinner in Austin · Sun Oct 25, 6:00 PM CDT"]


async def test_fallback_mixes_a_nearby_meetup_with_virtual_options():
    stdb, calls = recording_stdb()
    blocks = [(at(d, 23), at(d + 1, 2)) for d in range(3)]
    await propose(stdb, 7, [FriendUpdate(f, free_blocks=blocks) for f in (MAYA, BEN, JORDAN)])
    body, = calls
    assert body["title"] == "Hangout plans 🎉"
    options = json.loads(body["options"])
    # The meetup shows only the nearby friends' time zone.
    assert options[0]["label"] == "📍 Meet up in New York · Sat Oct 24, 7:00 PM EDT"
    assert options[0]["detail"].startswith("Maya and Ben live close")
    assert [o["label"].split(" · ")[0] for o in options[1:]] == ["🎬 Watch party", "🎮 Game night"]
    assert [o["startsAt"][:10] for o in options] == ["2026-10-24", "2026-10-25", "2026-10-26"]


class IdeasLlm:
    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    async def search_json(self, system, prompt):
        self.prompts.append(prompt)
        return self.reply


async def test_claude_ideas_become_the_options():
    reply = {"title": "Movie night + Brooklyn brunch 🎬", "options": [
        {"slot": 2, "label": "🥯 Brunch at a Brooklyn spot", "detail": "Maya and Ben, celebrate the 10K.",
         "in_person": ["Maya", "Ben"]},
        {"slot": 1, "label": "🎬 Watch party: a new release", "detail": "Everyone streams it together.", "in_person": []},
        # Dropped: Jordan isn't close to Maya, and slot 9 doesn't exist.
        {"slot": 3, "label": "🍕 Pizza", "detail": "", "in_person": ["Maya", "Jordan"]},
        {"slot": 9, "label": "🎮 Games", "detail": "", "in_person": []},
    ]}
    llm = IdeasLlm(reply)
    stdb, calls = recording_stdb(messages=[(2, 3, "anyone seen the new season?"), (1, 1, "we should catch up")])
    blocks = [(at(d, 23), at(d + 1, 2)) for d in range(3)]
    updates = [FriendUpdate(MAYA, highlights=["ran a 10K"], free_blocks=blocks),
               FriendUpdate(BEN, free_blocks=blocks), FriendUpdate(JORDAN, free_blocks=blocks)]
    text = await propose(stdb, 7, updates, llm=llm)

    prompt, = llm.prompts
    assert "Near each other (within 20 miles): Maya and Ben (New York)" in prompt
    assert "- Maya: ran a 10K" in prompt
    # Sorted by id, not by the order SQL returned them.
    assert prompt.index("Maya: we should catch up") < prompt.index("Jordan: anyone seen the new season?")
    assert "1. Sat Oct 24, 7:00 PM EDT / 4:00 PM PDT" in prompt
    body, = calls
    assert body["title"] == "Movie night + Brooklyn brunch 🎬"
    options = json.loads(body["options"])
    assert options == [
        {"label": "🥯 Brunch at a Brooklyn spot · Sun Oct 25, 7:00 PM EDT",
         "detail": "Maya and Ben, celebrate the 10K. · Everyone's free for 3h+",
         "startsAt": "2026-10-25T23:00:00+00:00"},
        {"label": "🎬 Watch party: a new release · Sat Oct 24, 7:00 PM EDT / 4:00 PM PDT",
         "detail": "Everyone streams it together. · Everyone's free for 3h+",
         "startsAt": "2026-10-24T23:00:00+00:00"},
    ]
    assert "1. 🥯 Brunch" in text


@pytest.mark.parametrize("reply", [None, {}, {"options": [{"slot": 0, "label": "nope"}]}, {"options": "junk"}])
async def test_unusable_claude_ideas_fall_back(reply):
    stdb, calls = recording_stdb()
    block = [(at(0, 23), at(1, 2))]
    await propose(stdb, 7, [FriendUpdate(MAYA, free_blocks=block), FriendUpdate(JORDAN, free_blocks=block)],
                  llm=IdeasLlm(reply))
    body, = calls
    assert json.loads(body["options"])[0]["label"].startswith("🎬 Watch party · ")
    assert body["title"] == "Virtual hangout 🎬"
