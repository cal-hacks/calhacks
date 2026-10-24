import json
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from agent_service.auth import hash_token
from agent_service.stdb import ReducerRejected, StdbClient, camel

# Shapes copied from a local SpacetimeDB 2.13 server.
U64 = {"U64": []}
STRING = {"String": []}
TIMESTAMP = {"Product": {"elements": [
    {"name": {"some": "__timestamp_micros_since_unix_epoch__"}, "algebraic_type": {"I64": []}}
]}}
IDENTITY = {"Product": {"elements": [
    {"name": {"some": "__identity__"}, "algebraic_type": {"U256": []}}
]}}


def option(inner):
    return {"Sum": {"variants": [
        {"name": {"some": "some"}, "algebraic_type": inner},
        {"name": {"some": "none"}, "algebraic_type": {"Product": {"elements": []}}},
    ]}}


def result(columns, rows):
    return {
        "schema": {"elements": [
            {"name": {"some": name}, "algebraic_type": ty} for name, ty in columns
        ]},
        "rows": rows,
    }


def client_with(handler) -> StdbClient:
    return StdbClient(
        "http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )


def test_camel():
    assert camel("group_id") == "groupId"
    assert camel("reply_to_id") == "replyToId"
    assert camel("text") == "text"


async def test_call_sends_camel_case_args_and_token():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200)

    await client_with(handler).call("send_message", group_id=1, text="hi", reply_to_id=0)
    assert seen == {
        "url": "http://db/v1/database/calhacks/call/send_message",
        "auth": "Bearer owner",
        "body": {"groupId": 1, "text": "hi", "replyToId": 0},
    }


async def test_call_raises_reducer_rejected_on_530():
    stdb = client_with(lambda r: httpx.Response(530, text="already posted about this friend today"))
    with pytest.raises(ReducerRejected, match="already posted"):
        await stdb.call("post_feed_item", group_id=1)


async def test_call_raises_on_bad_args():
    stdb = client_with(lambda r: httpx.Response(400, text="unknown reducer argument"))
    with pytest.raises(httpx.HTTPStatusError):
        await stdb.call("post_feed_item", group_id=1)


async def test_sql_decodes_rows():
    body = [result(
        [("id", U64), ("identity", option(IDENTITY)), ("name", STRING),
         ("created_at", TIMESTAMP), ("trusted", {"Array": U64})],
        [
            [6, [1, []], "Jordan", [1792805400000000], []],
            [5, [0, ["0xc200"]], "Sam", [0], [4, 6]],
        ],
    )]
    stdb = client_with(lambda r: httpx.Response(200, json=body))
    rows = await stdb.sql("SELECT ...")
    assert rows == [
        {"id": 6, "identity": None, "name": "Jordan",
         "created_at": datetime(2026, 10, 24, 1, 30, tzinfo=UTC), "trusted": []},
        {"id": 5, "identity": "0xc200", "name": "Sam",
         "created_at": datetime(1970, 1, 1, tzinfo=UTC), "trusted": [4, 6]},
    ]


# --- /me with an ingest token ---

MAYA_TOKEN = "maya-secret-token"


def fake_db(request: httpx.Request):
    query = request.content.decode()
    if "FROM ingest_token" in query:
        rows = [[1]] if hash_token(MAYA_TOKEN) in query else []
        return httpx.Response(200, json=[result([("friend_id", U64)], rows)])
    if "FROM friend" in query:
        return httpx.Response(200, json=[result([("id", U64), ("name", STRING)], [[1, "Maya Chen"]])])
    return httpx.Response(400, text="unexpected query")


@pytest.fixture
def api():
    from agent_service.main import app

    app.state.stdb = client_with(fake_db)
    with TestClient(app) as client:
        yield client
    del app.state.stdb


def test_me_with_valid_token(api):
    r = api.get("/me", headers={"Authorization": f"Bearer {MAYA_TOKEN}"})
    assert r.status_code == 200
    assert r.json() == {"friend_id": 1, "name": "Maya Chen"}


@pytest.mark.parametrize("header", ["", "Bearer", "Basic abc", "Bearer wrong-token"])
def test_me_rejects_bad_tokens(api, header):
    r = api.get("/me", headers={"Authorization": header} if header else {})
    assert r.status_code == 401


def test_health(api):
    assert api.get("/health").json() == {"ok": True}
