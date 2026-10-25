import json
import stat
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from agent_service.auth import hash_token
from agent_service.google_calendar import (
    FREEBUSY_URL,
    GoogleToken,
    TokenStore,
    candidate_windows,
    free_blocks,
    refresh_due,
    sync_friend,
)
from agent_service.stdb import StdbClient

# Friday Oct 23 2026, 4 PM in New York (EDT, UTC-4).
NOW = datetime(2026, 10, 23, 20, tzinfo=UTC)
MAYA_TOKEN = "maya-secret-token"


def utc(day: int, hour: float) -> datetime:
    return datetime(2026, 10, 23, tzinfo=UTC) + timedelta(days=day, hours=hour)


def rows(columns, values):
    return [{
        "schema": {"elements": [{"name": {"some": c}, "algebraic_type": {"String": []}} for c in columns]},
        "rows": values,
    }]


class FakeDb:
    """Answers the few queries the calendar code makes and records reducer calls."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.reject: str | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sql"):
            query = request.content.decode()
            if "FROM ingest_token" in query:
                found = [[1]] if hash_token(MAYA_TOKEN) in query else []
                return httpx.Response(200, json=[{
                    "schema": {"elements": [{"name": {"some": "friend_id"}, "algebraic_type": {"U64": []}}]},
                    "rows": found,
                }])
            if query in ("SELECT timezone FROM friend WHERE id = 1", "SELECT timezone FROM friend WHERE id = 2"):
                return httpx.Response(200, json=rows(["timezone"], [["America/New_York"]]))
            if query.startswith("SELECT timezone FROM friend"):
                return httpx.Response(200, json=rows(["timezone"], []))
            return httpx.Response(400, text=f"unexpected query {query}")
        if self.reject:
            return httpx.Response(530, text=self.reject)
        self.calls.append((request.url.path.rsplit("/", 1)[-1], json.loads(request.content)))
        return httpx.Response(200)

    def client(self) -> StdbClient:
        return StdbClient("http://db", "calhacks", "owner", http=httpx.AsyncClient(transport=httpx.MockTransport(self.handler)))

    def blocks(self) -> list[tuple[datetime, datetime]]:
        (reducer, body), = self.calls
        assert reducer == "set_free_blocks"
        assert body["friendId"] == 1
        return [(datetime.fromisoformat(b["start"]), datetime.fromisoformat(b["end"])) for b in json.loads(body["blocks"])]


class FakeGoogle:
    """Google's freeBusy endpoint with a fixed busy list."""

    def __init__(self, busy=(), status=200):
        self.busy = busy
        self.status = status
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert str(request.url) == FREEBUSY_URL
        if self.status != 200:
            return httpx.Response(self.status, json={"error": {"message": "Invalid Credentials"}})
        return httpx.Response(200, json={
            "kind": "calendar#freeBusy",
            "calendars": {"primary": {"busy": [
                {"start": s.isoformat().replace("+00:00", "Z"), "end": e.isoformat().replace("+00:00", "Z")}
                for s, e in self.busy
            ]}},
        })

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


@pytest.fixture
def store(tmp_path):
    s = TokenStore(tmp_path / "tokens.json")
    s.put(1, GoogleToken("ya29.maya", NOW + timedelta(hours=1)))
    return s


# --- turning busy into free ---

def test_candidate_windows_are_evenings_and_weekend_days_in_local_time():
    windows = candidate_windows("America/New_York", NOW, days=2)
    assert windows == [
        (utc(0, 22), utc(1, 3)),   # Fri 6-11 PM EDT
        (utc(1, 14), utc(2, 3)),   # Sat 10 AM-11 PM EDT
        (utc(2, 14), utc(2, 20)),  # Sun from 10 AM until two days from now
    ]


def test_candidate_windows_start_from_now():
    later = utc(0, 23.5)  # Fri 7:30 PM EDT
    assert candidate_windows("America/New_York", later, days=1)[0] == (later, utc(1, 3))


def test_unknown_timezone_falls_back_to_utc():
    assert candidate_windows("Mars/Olympus", NOW, days=1)[0] == (utc(0, 20), utc(0, 23))


def test_free_blocks_cut_out_busy_and_drop_short_gaps():
    windows = [(utc(0, 22), utc(1, 3))]
    busy = [
        (utc(0, 21), utc(0, 22.5)),     # overlaps the start
        (utc(0, 23.25), utc(1, 0)),     # leaves a 45 min gap before it
        (utc(1, 0.25), utc(1, 1)),      # 15 min gap: too short to keep
    ]
    assert free_blocks(windows, busy) == [
        (utc(0, 22.5), utc(0, 23.25)),
        (utc(1, 1), utc(1, 3)),
    ]


def test_free_blocks_with_no_busy_time_is_the_windows():
    windows = [(utc(0, 22), utc(1, 3)), (utc(1, 14), utc(2, 3))]
    assert free_blocks(windows, []) == windows


def test_free_blocks_handles_overlapping_busy():
    windows = [(utc(0, 22), utc(1, 3))]
    busy = [(utc(0, 23), utc(1, 1)), (utc(0, 23.5), utc(1, 0))]
    assert free_blocks(windows, busy) == [(utc(0, 22), utc(0, 23)), (utc(1, 1), utc(1, 3))]


# --- syncing a friend ---

async def test_sync_stores_free_blocks_from_google(store):
    db, google = FakeDb(), FakeGoogle(busy=[(utc(0, 23), utc(1, 1))])
    assert await sync_friend(db.client(), google.client(), store, 1, now=NOW) == "synced"

    request = google.requests[0]
    assert request.headers["authorization"] == "Bearer ya29.maya"
    asked = json.loads(request.content)
    assert asked["items"] == [{"id": "primary"}]
    assert datetime.fromisoformat(asked["timeMin"]) == NOW
    assert datetime.fromisoformat(asked["timeMax"]) == NOW + timedelta(days=7)

    blocks = db.blocks()
    assert blocks[:3] == [(utc(0, 22), utc(0, 23)), (utc(1, 1), utc(1, 3)), (utc(1, 14), utc(2, 3))]
    assert all(e <= NOW + timedelta(days=7) for _, e in blocks)
    assert store.tokens[1].synced_at == NOW


async def test_consent_off_is_skipped_and_retried_later(store):
    db, google = FakeDb(), FakeGoogle()
    db.reject = "calendar is off for this friend"
    assert await sync_friend(db.client(), google.client(), store, 1, now=NOW) == "skipped"
    assert 1 in store.tokens and store.tokens[1].synced_at is None

    db.reject = None
    assert await refresh_due(db.client(), google.client(), store, now=NOW + timedelta(minutes=1)) == {1: "synced"}
    assert db.blocks()


@pytest.mark.parametrize("status", [401, 403])
async def test_refused_token_is_dropped(store, status):
    db = FakeDb()
    assert await sync_friend(db.client(), FakeGoogle(status=status).client(), store, 1, now=NOW) == "expired"
    assert store.tokens == {} and db.calls == []


async def test_expired_token_is_dropped_without_asking_google(store):
    google = FakeGoogle()
    result = await sync_friend(FakeDb().client(), google.client(), store, 1, now=NOW + timedelta(hours=2))
    assert result == "expired"
    assert store.tokens == {} and google.requests == []


async def test_unknown_friend_is_dropped(tmp_path):
    store = TokenStore(tmp_path / "tokens.json")
    store.put(9, GoogleToken("ya29.x", NOW + timedelta(hours=1)))
    assert await sync_friend(FakeDb().client(), FakeGoogle().client(), store, 9, now=NOW) == "unknown_friend"
    assert store.tokens == {}


async def test_refresh_only_syncs_stale_friends(store):
    db, google = FakeDb(), FakeGoogle()
    store.tokens[1].synced_at = NOW
    assert await refresh_due(db.client(), google.client(), store, now=NOW + timedelta(minutes=5)) == {}
    assert await refresh_due(db.client(), google.client(), store, now=NOW + timedelta(minutes=16)) == {1: "synced"}


async def test_refresh_keeps_going_after_an_error(store):
    store.put(2, GoogleToken("ya29.sam", NOW + timedelta(hours=1)))
    db, google = FakeDb(), FakeGoogle(status=500)
    assert await refresh_due(db.client(), google.client(), store, now=NOW) == {1: "error", 2: "error"}


def test_token_store_round_trips_and_is_private(store):
    store.tokens[1].synced_at = NOW
    store.save()
    assert stat.S_IMODE(store.path.stat().st_mode) == 0o600
    again = TokenStore(store.path)
    assert again.tokens == store.tokens


# --- POST /calendar/google/token ---

@pytest.fixture
def api(tmp_path):
    from agent_service.main import app

    db, google = FakeDb(), FakeGoogle(busy=[(utc(0, 23), utc(1, 1))])
    app.state.stdb = db.client()
    app.state.google = google.client()
    app.state.tokens = TokenStore(tmp_path / "tokens.json")
    with TestClient(app) as client:
        yield client, db, app.state.tokens
    del app.state.stdb, app.state.google, app.state.tokens


def test_token_endpoint_stores_token_and_free_blocks(api):
    client, db, tokens = api
    r = client.post(
        "/calendar/google/token",
        json={"access_token": "ya29.maya", "expires_in": 3599},
        headers={"Authorization": f"Bearer {MAYA_TOKEN}"},
    )
    assert r.status_code == 200 and r.json() == {"status": "synced"}
    assert tokens.tokens[1].access_token == "ya29.maya"
    assert db.blocks()


def test_token_endpoint_reports_skip_when_consent_off(api):
    client, db, tokens = api
    db.reject = "calendar is off for this friend"
    r = client.post("/calendar/google/token", json={"access_token": "ya29.maya"},
                    headers={"Authorization": f"Bearer {MAYA_TOKEN}"})
    assert r.json() == {"status": "skipped"}
    assert 1 in tokens.tokens


@pytest.mark.parametrize("header", [None, "Bearer wrong-token"])
def test_token_endpoint_needs_ingest_token(api, header):
    client, db, tokens = api
    r = client.post("/calendar/google/token", json={"access_token": "ya29.maya"},
                    headers={"Authorization": header} if header else {})
    assert r.status_code == 401
    assert tokens.tokens == {} and db.calls == []


# --- POST /calendar/device/busy (the phone's own calendars) ---


def test_device_busy_stores_free_blocks_around_busy_times(api):
    client, db, tokens = api
    # Busy for all of tomorrow and the day after: no free time may land there.
    busy = (datetime.now(UTC) + timedelta(days=1), datetime.now(UTC) + timedelta(days=3))
    r = client.post(
        "/calendar/device/busy",
        json={"busy": [{"start": busy[0].isoformat(), "end": busy[1].isoformat()}]},
        headers={"Authorization": f"Bearer {MAYA_TOKEN}"},
    )
    assert r.status_code == 200 and r.json() == {"status": "synced"}
    blocks = db.blocks()
    assert blocks  # the rest of the week still has free evenings
    assert all(e <= busy[0] or s >= busy[1] for s, e in blocks)
    assert tokens.tokens == {}  # nothing about the device calendar is kept


def test_device_busy_reports_skip_when_consent_off(api):
    client, db, tokens = api
    db.reject = "calendar is off for this friend"
    r = client.post("/calendar/device/busy", json={"busy": []}, headers={"Authorization": f"Bearer {MAYA_TOKEN}"})
    assert r.json() == {"status": "skipped"}


def test_device_busy_needs_time_zones_and_a_token(api):
    client, db, tokens = api
    naive = {"busy": [{"start": "2030-01-01T23:00:00", "end": "2030-01-02T01:00:00"}]}
    assert client.post("/calendar/device/busy", json=naive, headers={"Authorization": f"Bearer {MAYA_TOKEN}"}).status_code == 422
    assert client.post("/calendar/device/busy", json={"busy": []}).status_code == 401
    assert db.calls == []
