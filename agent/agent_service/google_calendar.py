"""Real free time from Google Calendar.

The web app connects Google with the browser token flow and posts the access
token to `POST /calendar/google/token`. We keep it here (on disk, never in
SpacetimeDB), ask Google's freeBusy API for the next week, turn busy times
into free blocks inside sensible hangout hours, and store those with the
agent-only set_free_blocks reducer.

Browser tokens have no refresh token and last about an hour, so a friend's
blocks are refreshed while the token works and kept as they are after that.
"""

import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from .stdb import ReducerRejected, StdbClient

log = logging.getLogger(__name__)

FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"
DAYS_AHEAD = 7
MIN_BLOCK = timedelta(minutes=30)
REFRESH_EVERY = timedelta(minutes=15)

# Local hours a friend could plausibly hop on a call: evenings on weekdays,
# most of the day on weekends.
WEEKDAY_HOURS = (time(18), time(23))
WEEKEND_HOURS = (time(10), time(23))

Block = tuple[datetime, datetime]


TOKEN_URL = "https://oauth2.googleapis.com/token"


@dataclass
class GoogleToken:
    access_token: str
    expires_at: datetime
    # When we last tried to sync; None means try on the next refresh.
    synced_at: datetime | None = None
    # From the server-side sign-in flow (google_oauth.py). With it, an expired
    # access token is renewed instead of dropped.
    refresh_token: str | None = None


@dataclass(frozen=True)
class OAuthClient:
    client_id: str
    client_secret: str


async def refresh_access_token(http: httpx.AsyncClient, oauth: OAuthClient, token: GoogleToken, now: datetime) -> bool:
    """Swap the refresh token for a new access token. False if Google refused it."""
    r = await http.post(
        TOKEN_URL,
        data={
            "client_id": oauth.client_id,
            "client_secret": oauth.client_secret,
            "refresh_token": token.refresh_token,
            "grant_type": "refresh_token",
        },
    )
    if r.status_code in (400, 401):
        return False
    r.raise_for_status()
    body = r.json()
    token.access_token = body["access_token"]
    token.expires_at = now + timedelta(seconds=int(body.get("expires_in", 3600)))
    return True


class TokenStore:
    """Google tokens by friend id, in a JSON file only this user can read."""

    def __init__(self, path: Path):
        self.path = path
        self.tokens: dict[int, GoogleToken] = {}
        if path.exists():
            for fid, t in json.loads(path.read_text()).items():
                self.tokens[int(fid)] = GoogleToken(
                    t["access_token"],
                    datetime.fromisoformat(t["expires_at"]),
                    datetime.fromisoformat(t["synced_at"]) if t.get("synced_at") else None,
                    t.get("refresh_token"),
                )

    def put(self, friend_id: int, token: GoogleToken) -> None:
        self.tokens[friend_id] = token
        self.save()

    def drop(self, friend_id: int) -> None:
        if self.tokens.pop(friend_id, None):
            self.save()

    def save(self) -> None:
        data = {
            str(fid): {
                **asdict(t),
                "expires_at": t.expires_at.isoformat(),
                "synced_at": t.synced_at.isoformat() if t.synced_at else None,
            }
            for fid, t in self.tokens.items()
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)


class GoogleAuthError(Exception):
    """Google refused the token (expired or revoked)."""


async def fetch_busy(http: httpx.AsyncClient, access_token: str, start: datetime, end: datetime) -> list[Block]:
    r = await http.post(
        FREEBUSY_URL,
        json={"timeMin": start.isoformat(), "timeMax": end.isoformat(), "timeZone": "UTC", "items": [{"id": "primary"}]},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if r.status_code in (401, 403):
        raise GoogleAuthError(r.text)
    r.raise_for_status()
    primary = r.json()["calendars"]["primary"]
    if primary.get("errors"):
        raise GoogleAuthError(str(primary["errors"]))
    return [
        (datetime.fromisoformat(b["start"]).astimezone(UTC), datetime.fromisoformat(b["end"]).astimezone(UTC))
        for b in primary.get("busy", [])
    ]


def candidate_windows(timezone: str, start: datetime, days: int = DAYS_AHEAD) -> list[Block]:
    """Hangout hours in the friend's zone for `days` days, from `start` on."""
    try:
        zone = ZoneInfo(timezone)
    except Exception:  # unknown zone name from a profile
        zone = ZoneInfo("UTC")
    first: date = start.astimezone(zone).date()
    end = start + timedelta(days=days)
    windows = []
    for d in range(days + 1):
        day = first + timedelta(days=d)
        lo, hi = WEEKEND_HOURS if day.weekday() >= 5 else WEEKDAY_HOURS
        w0 = max(datetime.combine(day, lo, zone).astimezone(UTC), start)
        w1 = min(datetime.combine(day, hi, zone).astimezone(UTC), end)
        if w0 < w1:
            windows.append((w0, w1))
    return windows


def free_blocks(windows: list[Block], busy: list[Block], min_length: timedelta = MIN_BLOCK) -> list[Block]:
    """`windows` with every busy interval cut out, keeping pieces >= min_length."""
    busy = sorted(busy)
    out = []
    for w0, w1 in windows:
        cursor = w0
        for b0, b1 in busy:
            if b1 <= cursor or b0 >= w1:
                continue
            if b0 - cursor >= min_length:
                out.append((cursor, b0))
            cursor = max(cursor, b1)
        if w1 - cursor >= min_length:
            out.append((cursor, w1))
    return out


async def sync_friend(
    stdb: StdbClient,
    http: httpx.AsyncClient,
    store: TokenStore,
    friend_id: int,
    *,
    now: datetime | None = None,
    oauth: OAuthClient | None = None,
) -> str:
    """Refreshes one friend's free blocks. Returns what happened, for logs and the API."""
    now = now or datetime.now(UTC)
    token = store.tokens.get(friend_id)
    if token is None:
        return "no_token"
    # Renew a minute early so a sync never runs on a token about to expire.
    if token.expires_at <= now + timedelta(minutes=1):
        if not (token.refresh_token and oauth and await refresh_access_token(http, oauth, token, now)):
            store.drop(friend_id)
            return "expired"
        store.save()
    rows = await stdb.sql(f"SELECT timezone FROM friend WHERE id = {friend_id}")
    if not rows:
        store.drop(friend_id)
        return "unknown_friend"
    try:
        busy = await fetch_busy(http, token.access_token, now, now + timedelta(days=DAYS_AHEAD))
    except GoogleAuthError as e:
        log.info("Google refused the token for friend %s: %s", friend_id, e)
        # Access revoked or scopes changed: the refresh token won't help either.
        store.drop(friend_id)
        return "expired"
    if not await store_free_blocks(stdb, friend_id, rows[0]["timezone"], busy, now):
        # Calendar consent is off (or not synced from the app yet): try again
        # on the next refresh.
        token.synced_at = None
        store.save()
        return "skipped"
    token.synced_at = now
    store.save()
    return "synced"


async def store_free_blocks(stdb: StdbClient, friend_id: int, timezone: str, busy: list[Block], now: datetime) -> bool:
    """Turns busy times into free blocks for the next week and stores them. False if consent refused it."""
    blocks = free_blocks(candidate_windows(timezone, now), busy)
    try:
        await stdb.call(
            "set_free_blocks",
            friend_id=friend_id,
            blocks=json.dumps([{"start": s.isoformat(), "end": e.isoformat()} for s, e in blocks]),
        )
    except ReducerRejected as e:
        log.info("Skipped free blocks for friend %s: %s", friend_id, e)
        return False
    log.info("Stored %d free blocks for friend %s", len(blocks), friend_id)
    return True


async def sync_device_busy(stdb: StdbClient, friend_id: int, busy: list[Block], *, now: datetime | None = None) -> str:
    """Free blocks from busy times the phone read from its own calendars (iCloud, Outlook, Google...)."""
    now = now or datetime.now(UTC)
    rows = await stdb.sql(f"SELECT timezone FROM friend WHERE id = {friend_id}")
    if not rows:
        return "unknown_friend"
    return "synced" if await store_free_blocks(stdb, friend_id, rows[0]["timezone"], busy, now) else "skipped"


async def refresh_due(
    stdb: StdbClient,
    http: httpx.AsyncClient,
    store: TokenStore,
    *,
    now: datetime | None = None,
    oauth: OAuthClient | None = None,
) -> dict[int, str]:
    """Syncs every friend whose blocks are stale or whose last try was skipped."""
    now = now or datetime.now(UTC)
    results = {}
    for friend_id, token in list(store.tokens.items()):
        if token.synced_at is None or now - token.synced_at >= REFRESH_EVERY:
            try:
                results[friend_id] = await sync_friend(stdb, http, store, friend_id, now=now, oauth=oauth)
            except Exception:
                # One friend's bad response shouldn't stop the others.
                log.exception("Calendar refresh failed for friend %s", friend_id)
                results[friend_id] = "error"
    return results
