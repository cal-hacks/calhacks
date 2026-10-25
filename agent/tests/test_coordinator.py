import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from agent_service.coordinator import plain_digest, propose, wants_plan
from agent_service.group import Friend, FriendUpdate, common_free_windows, format_time
from agent_service.stdb import StdbClient

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
    assert options == [{
        "label": "Video call · Sat Oct 24, 7:00 PM EDT / 4:00 PM PDT",
        "detail": "Everyone's free for 3h+",
        "startsAt": "2026-10-24T23:00:00+00:00",
    }]
    assert "1. Video call" in text


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
