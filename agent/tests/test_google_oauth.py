import base64
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from agent_service import google_oauth
from agent_service.google_calendar import FREEBUSY_URL, TOKEN_URL, GoogleToken, OAuthClient, TokenStore, sync_friend
from tests.test_google_calendar import MAYA_TOKEN, NOW, FakeDb

AUTH = {"Authorization": f"Bearer {MAYA_TOKEN}"}
OAUTH = OAuthClient("client-123.apps.googleusercontent.com", "secret-xyz")


def id_token(email: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"email": email}).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


class FakeGoogle:
    """Google's token endpoint and freeBusy, with no busy time."""

    def __init__(self, refresh_ok=True):
        self.refresh_ok = refresh_ok
        self.forms: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL:
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            self.forms.append(form)
            if form["grant_type"] == "authorization_code":
                return httpx.Response(200, json={
                    "access_token": "ya29.fresh", "expires_in": 3599, "refresh_token": "1//refresh",
                    "id_token": id_token("maya@gmail.com"),
                })
            if not self.refresh_ok:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "ya29.renewed", "expires_in": 3599})
        assert str(request.url) == FREEBUSY_URL
        return httpx.Response(200, json={"calendars": {"primary": {"busy": []}}})

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


@pytest.fixture
def api(tmp_path):
    from agent_service.main import app

    db, google = FakeDb(), FakeGoogle()
    app.state.stdb = db.client()
    app.state.google = google.client()
    app.state.tokens = TokenStore(tmp_path / "tokens.json")
    app.state.google_oauth = OAUTH
    google_oauth.PENDING.clear()
    with TestClient(app) as client:
        app.state.public_url = "https://agent.example.com"
        app.state.web_origins = ["*"]
        yield client, db, google, app
    for attr in ("stdb", "google", "tokens", "google_oauth"):
        delattr(app.state, attr)


def start(client, return_to="https://waggle.example.com/settings"):
    r = client.post("/oauth/google/start", json={"return_to": return_to}, headers=AUTH)
    return r, parse_qs(urlsplit(r.json().get("url", "")).query) if r.status_code == 200 else {}


def test_start_points_at_google_with_offline_access(api):
    client, *_ = api
    r, q = start(client)
    assert r.status_code == 200
    assert q["client_id"] == [OAUTH.client_id]
    assert q["redirect_uri"] == ["https://agent.example.com/oauth/google/callback"]
    assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"]
    assert "calendar.freebusy" in q["scope"][0]
    state = q["state"][0]
    assert google_oauth.PENDING[state].friend_id == 1
    assert MAYA_TOKEN not in r.json()["url"]  # nothing about the friend in the URL


def test_start_needs_ingest_token_and_config(api):
    client, _, _, app = api
    assert client.post("/oauth/google/start", json={"return_to": "orbit://share"}).status_code == 401
    app.state.google_oauth = None
    assert client.post("/oauth/google/start", json={"return_to": "orbit://share"}, headers=AUTH).status_code == 503


@pytest.mark.parametrize("url, ok", [
    ("orbit://share", True),
    ("exp://192.168.1.5:8081/--/share", True),
    ("https://waggle.vercel.app/settings", True),
    ("javascript:alert(1)", False),
    ("file:///etc/passwd", False),
])
def test_return_to_is_checked(url, ok):
    assert google_oauth.allowed_return(url, ["*"]) is ok


def test_return_to_respects_web_origins():
    assert google_oauth.allowed_return("https://waggle.vercel.app/x", ["https://waggle.vercel.app"])
    assert not google_oauth.allowed_return("https://evil.example/x", ["https://waggle.vercel.app"])


def test_callback_stores_refresh_token_syncs_and_returns(api):
    client, db, google, app = api
    _, q = start(client, "orbit://share")
    r = client.get("/oauth/google/callback", params={"state": q["state"][0], "code": "4/abc"}, follow_redirects=False)
    assert r.status_code == 303
    back = urlsplit(r.headers["location"])
    assert back.scheme == "orbit"
    assert parse_qs(back.query) == {"connected": ["google"], "account": ["maya@gmail.com"], "calendar": ["synced"]}
    token = app.state.tokens.tokens[1]
    assert (token.access_token, token.refresh_token) == ("ya29.fresh", "1//refresh")
    exchange = google.forms[0]
    assert exchange["client_secret"] == OAUTH.client_secret and exchange["code"] == "4/abc"
    assert db.calls and db.calls[0][0] == "set_free_blocks"
    # The state is single-use.
    again = client.get("/oauth/google/callback", params={"state": q["state"][0], "code": "4/abc"}, follow_redirects=False)
    assert again.status_code == 400


def test_callback_when_person_cancels(api):
    client, *_ = api
    _, q = start(client)
    r = client.get("/oauth/google/callback", params={"state": q["state"][0], "error": "access_denied"}, follow_redirects=False)
    assert r.status_code == 303 and "calendar=cancelled" in r.headers["location"]


async def test_expired_access_token_is_renewed_with_refresh_token(tmp_path):
    db, google = FakeDb(), FakeGoogle()
    store = TokenStore(tmp_path / "t.json")
    store.put(1, GoogleToken("ya29.old", NOW - timedelta(minutes=5), refresh_token="1//refresh"))
    status = await sync_friend(db.client(), google.client(), store, 1, now=NOW, oauth=OAUTH)
    assert status == "synced"
    assert store.tokens[1].access_token == "ya29.renewed"
    assert store.tokens[1].expires_at > NOW
    assert google.forms[0]["grant_type"] == "refresh_token"
    # Survives a restart.
    assert TokenStore(tmp_path / "t.json").tokens[1].refresh_token == "1//refresh"


async def test_refused_refresh_drops_the_token(tmp_path):
    db, google = FakeDb(), FakeGoogle(refresh_ok=False)
    store = TokenStore(tmp_path / "t.json")
    store.put(1, GoogleToken("ya29.old", NOW - timedelta(minutes=5), refresh_token="1//revoked"))
    assert await sync_friend(db.client(), google.client(), store, 1, now=NOW, oauth=OAUTH) == "expired"
    assert 1 not in store.tokens
