import base64
import json
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from agent_service import canvas
from agent_service.auth import hash_token
from agent_service.canvas import CanvasLogin, CanvasStore, clean_base_url
from agent_service.stdb import StdbClient

TOKEN = "maya-ingest-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 100).decode()


class FakeDb:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.reject: str | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sql"):
            q = request.content.decode()
            if "FROM ingest_token" in q:
                rows = [[1]] if hash_token(TOKEN) in q else []
                return self.result([("friend_id", {"U64": []})], rows)
            if "FROM friend" in q:
                return self.result([("name", {"String": []})], [["Maya Chen"]])
            return httpx.Response(400, text=q)
        if self.reject:
            return httpx.Response(530, text=self.reject)
        self.calls.append((request.url.path.rsplit("/", 1)[-1], json.loads(request.content)))
        return httpx.Response(200)

    @staticmethod
    def result(columns, rows):
        return httpx.Response(200, json=[{
            "schema": {"elements": [{"name": {"some": c}, "algebraic_type": t} for c, t in columns]},
            "rows": rows,
        }])

    def stats(self):
        return [(a["type"], json.loads(a["value"]), a["source"]) for r, a in self.calls if r == "add_stat"]


class FakeLlm:
    available = True

    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    async def write_json(self, system, prompt, schema, *, model=None, image=None):
        self.calls.append({"prompt": prompt, "model": model, "image": image})
        return self.reply


class FakeWeb:
    """OpenStreetMap and Canvas."""

    def __init__(self):
        self.canvas_status = 200
        self.planner = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "nominatim.openstreetmap.org":
            return httpx.Response(200, json={"name": "Lazy Llama Farm", "address": {"town": "Snohomish", "state": "Washington"}})
        if request.url.path == "/api/v1/planner/items":
            return httpx.Response(self.canvas_status, json=self.planner)
        return httpx.Response(404)


@pytest.fixture
def api(tmp_path):
    from agent_service.main import app

    db, web = FakeDb(), FakeWeb()
    app.state.stdb = StdbClient("http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(db.handler)))
    app.state.google = httpx.AsyncClient(transport=httpx.MockTransport(web.handler))
    app.state.canvas = CanvasStore(tmp_path / "canvas.json")
    app.state.llm = FakeLlm(None)
    with TestClient(app) as client:
        yield client, db, web, app
    for attr in ("stdb", "google", "canvas", "llm"):
        delattr(app.state, attr)


# --- Health Shortcut ---

def test_health_stores_steps_sleep_and_workouts(api):
    client, db, _, _ = api
    r = client.post("/ingest/health", headers=AUTH, json={
        "date": "2026-10-24",
        "steps": [4000, 6500.4],
        "sleep": [
            {"start": "2026-10-23T23:30:00-07:00", "end": "2026-10-24T03:00:00-07:00"},
            {"start": "2026-10-24T03:20:00-07:00", "end": "2026-10-24T07:00:00-07:00"},
        ],
        "workouts": [{"kind": "Run", "minutes": 31.4, "distance_km": 5.234}],
    })
    assert r.status_code == 200 and r.json() == {"stored": ["steps", "sleep", "workout"]}
    steps, sleep, workout = db.stats()
    assert steps == ("steps", {"count": 10500, "date": "2026-10-24"}, "shortcut")
    assert sleep[1]["hours"] == 7.17 and sleep[1]["start"].startswith("2026-10-23T23:30")
    assert workout == ("workout", {"kind": "run", "minutes": 31, "distance_km": 5.23}, "shortcut")


def test_health_consent_off_is_403(api):
    client, db, _, _ = api
    db.reject = "health is off for this friend"
    r = client.post("/ingest/health", headers=AUTH, json={"steps": 5000})
    assert r.status_code == 403 and "health is off" in r.json()["detail"]


def test_health_needs_ingest_token(api):
    client, *_ = api
    assert client.post("/ingest/health", json={"steps": 5}).status_code == 401


def test_health_rejects_silly_steps(api):
    client, db, _, _ = api
    assert client.post("/ingest/health", headers=AUTH, json={"steps": 10_000_000}).status_code == 422
    assert db.calls == []


# --- Screen Time ---

def test_screen_time_is_read_validated_and_stored(api):
    client, db, _, app = api
    app.state.llm = FakeLlm({
        "is_screen_time": True, "period": "week", "daily_avg_hours": 6.4,
        "top_apps": [{"name": f"App {i}", "hours": 1.0} for i in range(7)], "pickups": 142,
    })
    r = client.post("/ingest/screen-time", headers=AUTH, json={"media_type": "image/png", "data": PNG})
    assert r.status_code == 200
    (kind, value, source), = db.stats()
    assert (kind, source) == ("screen_time", "upload")
    assert value == {"daily_avg_hours": 6.4, "top_apps": [f"App {i}" for i in range(5)], "pickups": 142, "period": "week"}
    assert app.state.llm.calls[0]["model"] == "claude-haiku-5-5"
    assert app.state.llm.calls[0]["image"] == ("image/png", PNG)


@pytest.mark.parametrize("reply, status", [
    ({"is_screen_time": False, "period": "unknown", "daily_avg_hours": None, "top_apps": [], "pickups": None}, 422),
    ({"is_screen_time": True, "period": "day", "daily_avg_hours": 31, "top_apps": [], "pickups": None}, 422),
    (None, 502),
])
def test_screen_time_bad_reads_store_nothing(api, reply, status):
    client, db, _, app = api
    app.state.llm = FakeLlm(reply)
    r = client.post("/ingest/screen-time", headers=AUTH, json={"media_type": "image/png", "data": PNG})
    assert r.status_code == status and db.calls == []


def test_screen_time_rejects_non_images(api):
    client, *_ = api
    r = client.post("/ingest/screen-time", headers=AUTH, json={"media_type": "application/pdf", "data": PNG})
    assert r.status_code == 415


# --- Photos ---

def test_photo_with_gps_is_named_rated_and_stored(api):
    client, db, _, app = api
    app.state.llm = FakeLlm({"obscurity_score": 1.4, "caption": "Maya made a llama friend 🦙"})
    r = client.post("/ingest/photo", headers=AUTH, json={"lat": 47.91, "lng": -122.09, "taken_at": "2026-10-24T14:00:00-07:00"})
    assert r.status_code == 200
    assert r.json() == {"place_name": "Lazy Llama Farm, Snohomish, Washington", "obscurity_score": 1.0, "caption": "Maya made a llama friend 🦙"}
    (reducer, args), = db.calls
    assert reducer == "add_photo" and (args["lat"], args["lng"]) == (47.91, -122.09)
    assert app.state.llm.calls[0]["prompt"] == "Maya took a photo at: Lazy Llama Farm, Snohomish, Washington"


def test_photo_without_gps_needs_a_place(api):
    client, db, _, _ = api
    assert client.post("/ingest/photo", headers=AUTH, json={}).status_code == 422
    r = client.post("/ingest/photo", headers=AUTH, json={"place_name": "Corn maze in Snohomish"})
    assert r.status_code == 200 and r.json()["caption"] == "Maya at Corn maze in Snohomish"
    assert db.calls[0][1]["placeName"] == "Corn maze in Snohomish"


def test_photo_consent_off_is_403(api):
    client, db, _, _ = api
    db.reject = "photo sharing is not on for this friend"
    assert client.post("/ingest/photo", headers=AUTH, json={"place_name": "x"}).status_code == 403


# --- Canvas ---

@pytest.mark.parametrize("url, ok", [
    ("https://canvas.stanford.edu", "https://canvas.stanford.edu"),
    ("https://school.instructure.com/courses/1", "https://school.instructure.com"),
    ("http://canvas.school.edu", None),
    ("https://127.0.0.1", None),
    ("https://localhost", None),
    ("https://intranet", None),
])
def test_canvas_url_must_be_a_public_https_host(url, ok):
    if ok:
        assert clean_base_url(url) == ok
    else:
        with pytest.raises(ValueError):
            clean_base_url(url)


def planner_item(title, due, kind="assignment", submitted=False):
    return {"plannable_type": kind, "plannable_date": due, "plannable": {"title": title},
            "submissions": {"submitted": submitted}}


def test_canvas_token_stores_deadlines_and_busy_flag(api):
    client, db, web, app = api
    web.planner = [
        planner_item("Contracts memo", "2026-10-26T06:59:00Z"),
        planner_item("Evidence reading", "2026-10-27T06:59:00Z", kind="quiz"),
        planner_item("Already done", "2026-10-27T06:59:00Z", submitted=True),
        planner_item("Office hours", "2026-10-27T06:59:00Z", kind="calendar_event"),
        planner_item("Moot court brief", "2026-10-29T06:59:00Z"),
    ]
    r = client.post("/canvas/token", headers=AUTH, json={"base_url": "https://canvas.school.edu/", "token": "1234~abcdefghij"})
    assert r.status_code == 200 and r.json() == {"status": "synced"}
    (kind, value, source), = db.stats()
    assert (kind, source) == ("canvas_deadlines", "canvas")
    assert value == {"count": 3, "items": ["Contracts memo", "Evidence reading", "Moot court brief"], "busy": True, "through": "2026-10-29"}
    assert app.state.canvas.logins[1].base_url == "https://canvas.school.edu"


def test_canvas_bad_token_is_dropped(api):
    client, _, web, app = api
    web.canvas_status = 401
    r = client.post("/canvas/token", headers=AUTH, json={"base_url": "https://canvas.school.edu", "token": "1234~abcdefghij"})
    assert r.status_code == 400 and 1 not in app.state.canvas.logins


def test_canvas_consent_off_is_403(api):
    client, db, _, _ = api
    db.reject = "canvas is off for this friend"
    r = client.post("/canvas/token", headers=AUTH, json={"base_url": "https://canvas.school.edu", "token": "1234~abcdefghij"})
    assert r.status_code == 403


async def test_canvas_refresh_only_when_stale(tmp_path):
    store = CanvasStore(tmp_path / "c.json")
    store.put(1, CanvasLogin("https://canvas.school.edu", "t", synced_at=datetime.now(UTC).isoformat()))
    assert await canvas.refresh_due(None, None, store) == {}
