import json
from datetime import UTC, datetime, timedelta

from agent_service.canvas import CanvasLogin, CanvasStore
from agent_service.google_calendar import GoogleToken, TokenStore
from agent_service.persist import Mirror


class FakeStdb:
    """The secret table and put_secret, in memory."""

    def __init__(self):
        self.secrets: dict[str, str] = {}
        self.writes = 0

    async def sql(self, query: str):
        key = query.split("'")[1]
        return [{"value": self.secrets[key]}] if key in self.secrets else []

    async def call(self, reducer: str, **args):
        assert reducer == "put_secret"
        self.secrets[args["key"]] = args["value"]
        self.writes += 1


NOW = datetime(2026, 10, 25, 18, tzinfo=UTC)


async def test_google_logins_survive_a_wiped_disk(tmp_path):
    db = FakeStdb()
    store = TokenStore(tmp_path / "a" / "tokens.json")
    mirror = Mirror(db, "google_tokens")
    await store.attach(mirror)
    store.put(12, GoogleToken("ya29.x", NOW + timedelta(hours=1), refresh_token="1//r"))
    await mirror.flush()
    # A restart on a fresh disk: the file is gone, the database still has it.
    fresh = TokenStore(tmp_path / "b" / "tokens.json")
    await fresh.attach(Mirror(db, "google_tokens"))
    assert fresh.tokens[12].refresh_token == "1//r"
    assert fresh.tokens[12].expires_at == NOW + timedelta(hours=1)


async def test_canvas_logins_survive_a_wiped_disk(tmp_path):
    db = FakeStdb()
    store = CanvasStore(tmp_path / "a" / "canvas.json")
    mirror = Mirror(db, "canvas_logins")
    await store.attach(mirror)
    store.put(7, CanvasLogin("https://bcourses.berkeley.edu", "tok"))
    await mirror.flush()
    fresh = CanvasStore(tmp_path / "b" / "canvas.json")
    await fresh.attach(Mirror(db, "canvas_logins"))
    assert fresh.logins[7].token == "tok"


async def test_a_burst_of_saves_ends_with_the_newest(tmp_path):
    db = FakeStdb()
    store = TokenStore(tmp_path / "tokens.json")
    mirror = Mirror(db, "google_tokens")
    await store.attach(mirror)
    for i in range(5):
        store.put(i, GoogleToken(f"t{i}", NOW))
    store.drop(0)
    await mirror.flush()
    assert set(json.loads(db.secrets["google_tokens"])) == {"1", "2", "3", "4"}
    assert db.writes < 6  # coalesced, not one write per save


async def test_a_local_file_wins_over_the_database(tmp_path):
    db = FakeStdb()
    db.secrets["google_tokens"] = json.dumps({"99": {"access_token": "old", "expires_at": NOW.isoformat()}})
    path = tmp_path / "tokens.json"
    TokenStore(path).put(5, GoogleToken("local", NOW))
    store = TokenStore(path)
    await store.attach(Mirror(db, "google_tokens"))
    assert set(store.tokens) == {5}
