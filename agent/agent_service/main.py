"""The agent service's web server: real data in (Health Shortcut, Screen Time
screenshots, photos, Google Calendar free/busy, Canvas deadlines) and the
goal-coach chat (`POST /agent/chat`, from app/main.py).

Run from agent/:  uv run uvicorn agent_service.main:app --host 0.0.0.0 --port 8000
"""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.main import router as coach_router

from . import canvas
from .auth import current_friend
from .config import load_settings
from .google_calendar import GoogleToken, TokenStore, refresh_due, sync_device_busy, sync_friend
from .ingest import router as ingest_router
from .llm import Llm
from .stdb import StdbClient

log = logging.getLogger(__name__)
settings = load_settings()

CALENDAR_POLL_SECONDS = 60


async def refresh_calendars(app: FastAPI) -> None:
    while True:
        await asyncio.sleep(CALENDAR_POLL_SECONDS)
        try:
            await refresh_due(app.state.stdb, app.state.google, app.state.tokens)
            await canvas.refresh_due(app.state.stdb, app.state.google, app.state.canvas)
        except Exception:
            log.exception("Calendar refresh failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tests replace app.state.stdb, .google and .tokens before the first request.
    if not hasattr(app.state, "stdb"):
        app.state.stdb = StdbClient(settings.stdb_uri, settings.stdb_db, settings.stdb_token)
    if not hasattr(app.state, "google"):
        app.state.google = httpx.AsyncClient(timeout=10)
    if not hasattr(app.state, "tokens"):
        app.state.tokens = TokenStore(settings.google_token_file)
    if not hasattr(app.state, "canvas"):
        app.state.canvas = canvas.CanvasStore(settings.google_token_file.with_name(".canvas_tokens.json"))
    if not hasattr(app.state, "llm"):
        app.state.llm = Llm(settings.anthropic_api_key)
    # Shared outbound client (Google, Canvas, OpenStreetMap).
    app.state.http = app.state.google
    refresher = asyncio.create_task(refresh_calendars(app))
    yield
    refresher.cancel()
    with suppress(asyncio.CancelledError):
        await refresher
    await app.state.google.aclose()
    await app.state.stdb.aclose()


app = FastAPI(title="Agent service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.web_origins,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

Friend = Annotated[int, Depends(current_friend)]


@app.get("/health")
async def health():
    return {"ok": True}


app.include_router(coach_router)
app.include_router(ingest_router)


# Lets the web app and the Shortcut check that an ingest token works.
@app.get("/me")
async def me(friend_id: Friend):
    rows = await app.state.stdb.sql(f"SELECT id, name FROM friend WHERE id = {friend_id}")
    if not rows:
        raise HTTPException(404, "friend not found")
    return {"friend_id": friend_id, "name": rows[0]["name"]}


class GoogleTokenIn(BaseModel):
    access_token: str = Field(min_length=1, max_length=4096)
    # Seconds, as Google's token response gives it.
    expires_in: int = Field(default=3600, gt=0, le=86400)


# The web app's Google Calendar connect flow hands us its access token. We
# keep it (never in SpacetimeDB), store real free blocks now, and refresh
# them while the token lasts.
@app.post("/calendar/google/token")
async def google_calendar_token(body: GoogleTokenIn, friend_id: Friend):
    now = datetime.now(UTC)
    app.state.tokens.put(
        friend_id, GoogleToken(body.access_token, now + timedelta(seconds=body.expires_in))
    )
    status = await sync_friend(app.state.stdb, app.state.google, app.state.tokens, friend_id, now=now)
    if status == "expired":
        raise HTTPException(400, "Google didn't accept that token")
    return {"status": status}


class BusyIn(BaseModel):
    start: datetime
    end: datetime


class DeviceBusyIn(BaseModel):
    # Busy times only: the phone never sends event titles or attendees.
    busy: list[BusyIn] = Field(max_length=500)


# The phone app reads the calendars on the device (one iOS permission covers
# iCloud, Outlook and Google accounts) and sends just the busy times for the
# next week. We turn them into free blocks, like the Google flow.
@app.post("/calendar/device/busy")
async def device_calendar_busy(body: DeviceBusyIn, friend_id: Friend):
    busy = []
    for b in body.busy:
        if b.start.tzinfo is None or b.end.tzinfo is None:
            raise HTTPException(422, "busy times need a time zone offset")
        if b.end > b.start:
            busy.append((b.start.astimezone(UTC), b.end.astimezone(UTC)))
    status = await sync_device_busy(app.state.stdb, friend_id, busy)
    if status == "unknown_friend":
        raise HTTPException(404, "friend not found")
    return {"status": status}


class CanvasIn(BaseModel):
    base_url: str = Field(min_length=8, max_length=200)
    token: str = Field(min_length=10, max_length=200)


# The web app's Canvas card: we keep the token (never in SpacetimeDB) and
# store the friend's deadlines for the coming week, refreshed hourly.
@app.post("/canvas/token")
async def canvas_token(body: CanvasIn, friend_id: Friend):
    try:
        base = canvas.clean_base_url(body.base_url)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    app.state.canvas.put(friend_id, canvas.CanvasLogin(base, body.token.strip()))
    try:
        status = await canvas.sync_friend(app.state.stdb, app.state.google, app.state.canvas, friend_id)
    except httpx.HTTPError as e:
        app.state.canvas.drop(friend_id)
        raise HTTPException(502, "couldn't reach that Canvas") from e
    if status == "expired":
        raise HTTPException(400, "Canvas didn't accept that token")
    if status == "skipped":
        raise HTTPException(403, "Canvas sharing is off. Turn it on first.")
    return {"status": status}
