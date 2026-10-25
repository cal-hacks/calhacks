"""Connect Google Calendar for good: Google's authorization-code flow.

The browser-only token flow gives an access token that dies in an hour. Here
the agent service runs the sign-in instead, so it gets a refresh token and
calendar sync keeps working (google_calendar.py renews the access token).

1. The app calls POST /oauth/google/start as the friend (ingest token) with
   where to come back to. We remember the friend under a random one-time
   `state` and answer with Google's consent URL, so nothing about the friend
   goes in the URL.
2. Google sends the browser to GET /oauth/google/callback with a code. We
   swap it for tokens, store them (on disk, never in SpacetimeDB), sync free
   time right away and send the browser back to the app.
"""

import base64
import json
import logging
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from .auth import current_friend
from .google_calendar import TOKEN_URL, GoogleToken, OAuthClient, sync_friend

log = logging.getLogger(__name__)
router = APIRouter()
Friend = Annotated[int, Depends(current_friend)]

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPES = "openid email https://www.googleapis.com/auth/calendar.freebusy"
STATE_TTL_SECONDS = 600
# Where a finished sign-in may send the browser back to: web pages, the
# installed app (orbit://) and Expo Go (exp://) while developing.
APP_SCHEMES = {"orbit", "exp", "exps"}


@dataclass
class Pending:
    friend_id: int
    return_to: str
    created: float


# One-time states waiting for Google's callback. In memory: a restart just
# means connecting again.
PENDING: dict[str, Pending] = {}


def oauth_client(request: Request) -> OAuthClient | None:
    return request.app.state.google_oauth


def redirect_uri(request: Request) -> str:
    base = request.app.state.public_url or str(request.base_url).rstrip("/")
    return f"{base}/oauth/google/callback"


def allowed_return(url: str, web_origins: list[str]) -> bool:
    parts = urlsplit(url)
    if parts.scheme in APP_SCHEMES:
        return True
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return False
    return "*" in web_origins or f"{parts.scheme}://{parts.netloc}" in web_origins


def with_params(url: str, **params: str) -> str:
    return f"{url}{'&' if '?' in url else '?'}{urlencode(params)}"


class StartIn(BaseModel):
    return_to: str = Field(min_length=1, max_length=500)


@router.post("/oauth/google/start")
async def start(body: StartIn, friend_id: Friend, request: Request):
    oauth = oauth_client(request)
    if oauth is None:
        raise HTTPException(503, "Google sign-in isn't set up on the agent service (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).")
    if not allowed_return(body.return_to, request.app.state.web_origins):
        raise HTTPException(422, "return_to must be this app")
    now = time.time()
    for key in [k for k, p in PENDING.items() if now - p.created > STATE_TTL_SECONDS]:
        del PENDING[key]
    state = secrets.token_urlsafe(24)
    PENDING[state] = Pending(friend_id, body.return_to, now)
    url = AUTH_URL + "?" + urlencode({
        "client_id": oauth.client_id,
        "redirect_uri": redirect_uri(request),
        "response_type": "code",
        "scope": SCOPES,
        # offline + consent: Google only hands out a refresh token this way.
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    })
    return {"url": url}


def email_from_id_token(id_token: str | None) -> str | None:
    """The account's email, for showing which account is connected. Google
    just handed us this token over TLS, so it isn't verified further."""
    if not id_token:
        return None
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("email")
    except (IndexError, ValueError):
        return None


@router.get("/oauth/google/callback")
async def callback(request: Request, state: str = "", code: str = "", error: str = ""):
    pending = PENDING.pop(state, None)
    if pending is None or time.time() - pending.created > STATE_TTL_SECONDS:
        raise HTTPException(400, "This sign-in link expired. Connect Google Calendar again from the app.")
    if error or not code:
        return RedirectResponse(with_params(pending.return_to, calendar="cancelled"), status_code=303)
    oauth = oauth_client(request)
    if oauth is None:
        raise HTTPException(503, "Google sign-in isn't set up on the agent service.")

    http = request.app.state.google
    r = await http.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": oauth.client_id,
            "client_secret": oauth.client_secret,
            "redirect_uri": redirect_uri(request),
            "grant_type": "authorization_code",
        },
    )
    if r.status_code != 200:
        log.warning("Google code exchange failed: %s %s", r.status_code, r.text[:200])
        return RedirectResponse(with_params(pending.return_to, calendar="error"), status_code=303)
    tokens = r.json()
    now = datetime.now(UTC)
    store = request.app.state.tokens
    # Google sends a refresh token only on first consent; keep an earlier one.
    earlier = store.tokens.get(pending.friend_id)
    store.put(
        pending.friend_id,
        GoogleToken(
            tokens["access_token"],
            now + timedelta(seconds=int(tokens.get("expires_in", 3600))),
            refresh_token=tokens.get("refresh_token") or (earlier.refresh_token if earlier else None),
        ),
    )
    status = await sync_friend(request.app.state.stdb, http, store, pending.friend_id, now=now, oauth=oauth)
    account = email_from_id_token(tokens.get("id_token")) or "Google account"
    log.info("Google Calendar connected for friend %s (%s)", pending.friend_id, status)
    return RedirectResponse(
        with_params(pending.return_to, connected="google", account=account, calendar=status), status_code=303
    )
