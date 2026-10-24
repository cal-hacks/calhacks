"""Canvas deadlines: a heavy week is planning context for the coordinator.

A friend pastes their Canvas URL and a personal access token in the web app
(`POST /canvas/token`). We keep both here (on disk, never in SpacetimeDB),
read their planner for the next week and store a `canvas_deadlines` stat
(titles and count). Three or more deadlines counts as a busy week.
"""

import ipaddress
import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .stdb import ReducerRejected, StdbClient

log = logging.getLogger(__name__)

DAYS_AHEAD = 7
BUSY_THRESHOLD = 3
REFRESH_EVERY = timedelta(hours=1)
DEADLINE_TYPES = {"assignment", "quiz", "discussion_topic"}


@dataclass
class CanvasLogin:
    base_url: str
    token: str
    synced_at: str | None = None


class CanvasStore:
    """Canvas logins by friend id, in a JSON file only this user can read."""

    def __init__(self, path: Path):
        self.path = path
        self.logins: dict[int, CanvasLogin] = {}
        if path.exists():
            for fid, v in json.loads(path.read_text()).items():
                self.logins[int(fid)] = CanvasLogin(**v)

    def put(self, friend_id: int, login: CanvasLogin) -> None:
        self.logins[friend_id] = login
        self.save()

    def drop(self, friend_id: int) -> None:
        if self.logins.pop(friend_id, None):
            self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({str(k): asdict(v) for k, v in self.logins.items()}))
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)


def clean_base_url(url: str) -> str:
    """https://school.instructure.com style URLs only: no IPs, no localhost, no paths."""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or "." not in host or host.endswith(".local") or host == "localhost":
        raise ValueError("use your school's Canvas address, like https://canvas.school.edu")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("use your school's Canvas address, not an IP address")
    return f"https://{host}" + (f":{parts.port}" if parts.port else "")


class CanvasAuthError(Exception):
    """Canvas refused the token."""


async def fetch_deadlines(
    http: httpx.AsyncClient, login: CanvasLogin, start: datetime, end: datetime
) -> list[tuple[str, datetime]]:
    r = await http.get(
        f"{login.base_url}/api/v1/planner/items",
        params={"start_date": start.isoformat(), "end_date": end.isoformat(), "per_page": 100},
        headers={"Authorization": f"Bearer {login.token}"},
    )
    if r.status_code in (401, 403):
        raise CanvasAuthError(r.text[:200])
    r.raise_for_status()
    out = []
    for item in r.json():
        if item.get("plannable_type") not in DEADLINE_TYPES or not item.get("plannable_date"):
            continue
        if (item.get("submissions") or {}).get("submitted"):
            continue
        title = (item.get("plannable") or {}).get("title") or "Assignment"
        due = datetime.fromisoformat(item["plannable_date"].replace("Z", "+00:00"))
        out.append((title[:80], due))
    return sorted(out, key=lambda d: d[1])


async def sync_friend(
    stdb: StdbClient, http: httpx.AsyncClient, store: CanvasStore, friend_id: int, *, now: datetime | None = None
) -> str:
    now = now or datetime.now(UTC)
    login = store.logins.get(friend_id)
    if login is None:
        return "no_token"
    try:
        deadlines = await fetch_deadlines(http, login, now, now + timedelta(days=DAYS_AHEAD))
    except CanvasAuthError as e:
        log.info("Canvas refused the token for friend %s: %s", friend_id, e)
        store.drop(friend_id)
        return "expired"
    value = {
        "count": len(deadlines),
        "items": [t for t, _ in deadlines[:8]],
        "busy": len(deadlines) >= BUSY_THRESHOLD,
        "through": deadlines[-1][1].date().isoformat() if deadlines else None,
    }
    try:
        await stdb.call(
            "add_stat",
            friend_id=friend_id,
            type="canvas_deadlines",
            value=json.dumps(value),
            recorded_at=now.isoformat(),
            source="canvas",
        )
    except ReducerRejected as e:
        log.info("Skipped Canvas for friend %s: %s", friend_id, e)
        return "skipped"
    login.synced_at = now.isoformat()
    store.save()
    log.info("Stored %d Canvas deadlines for friend %s", len(deadlines), friend_id)
    return "synced"


async def refresh_due(
    stdb: StdbClient, http: httpx.AsyncClient, store: CanvasStore, *, now: datetime | None = None
) -> dict[int, str]:
    now = now or datetime.now(UTC)
    results = {}
    for friend_id, login in list(store.logins.items()):
        last = datetime.fromisoformat(login.synced_at) if login.synced_at else None
        if last is None or now - last >= REFRESH_EVERY:
            try:
                results[friend_id] = await sync_friend(stdb, http, store, friend_id, now=now)
            except Exception:
                log.exception("Canvas refresh failed for friend %s", friend_id)
                results[friend_id] = "error"
    return results
