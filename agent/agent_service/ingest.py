"""Real data in: the iOS Health Shortcut, Screen Time screenshots and photos.

Every endpoint is called as a friend (their ingest token) and writes through
the agent-only reducers, which refuse anything the friend's consent doesn't
allow. A refusal comes back as 403 with the module's reason. What gets shared
with the group is decided later, by the watcher.
"""

import base64
import json
import logging
from datetime import UTC, date, datetime
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .auth import current_friend
from .llm import VISION_MODEL, Llm
from .stdb import ReducerRejected, StdbClient

log = logging.getLogger(__name__)
router = APIRouter()
Friend = Annotated[int, Depends(current_friend)]

MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"


def stdb(request: Request) -> StdbClient:
    return request.app.state.stdb


def llm(request: Request) -> Llm:
    return request.app.state.llm


async def add_stat(db: StdbClient, friend_id: int, type_: str, value: dict, at: datetime, source: str) -> None:
    await db.call(
        "add_stat",
        friend_id=friend_id,
        type=type_,
        value=json.dumps(value),
        recorded_at=at.astimezone(UTC).isoformat(),
        source=source,
    )


def rejected(e: ReducerRejected) -> HTTPException:
    return HTTPException(403, str(e))


# ---------- Health (iOS Shortcut) ----------


class Interval(BaseModel):
    start: datetime
    end: datetime


class Workout(BaseModel):
    kind: str = Field(default="workout", max_length=40)
    minutes: float = Field(ge=0, le=24 * 60)
    distance_km: float | None = Field(default=None, ge=0, le=500)
    start: datetime | None = None


class HealthIn(BaseModel):
    """What the Shortcut sends. Every field is optional; send what you have.

    `steps` may be one number or a list (Shortcuts often returns samples).
    `sleep` is the night's sleep samples; they're merged into one night.
    """

    day: date | None = Field(default=None, alias="date")
    steps: float | list[float] | None = None
    sleep: list[Interval] = Field(default_factory=list, max_length=200)
    workouts: list[Workout] = Field(default_factory=list, max_length=50)


@router.post("/ingest/health")
async def ingest_health(body: HealthIn, friend_id: Friend, request: Request):
    db = stdb(request)
    now = datetime.now(UTC)
    stored = []
    try:
        if body.steps is not None:
            count = sum(body.steps) if isinstance(body.steps, list) else body.steps
            if not 0 <= count <= 200_000:
                raise HTTPException(422, "steps out of range")
            await add_stat(db, friend_id, "steps", {"count": round(count), "date": (body.day or now.date()).isoformat()}, now, "shortcut")
            stored.append("steps")
        if body.sleep:
            start = min(s.start for s in body.sleep)
            end = max(s.end for s in body.sleep)
            hours = sum((s.end - s.start).total_seconds() for s in body.sleep if s.end > s.start) / 3600
            if 0 < hours <= 24:
                await add_stat(db, friend_id, "sleep", {"start": start.isoformat(), "end": end.isoformat(), "hours": round(hours, 2)}, end, "shortcut")
                stored.append("sleep")
        for w in body.workouts:
            value: dict[str, Any] = {"kind": w.kind.lower(), "minutes": round(w.minutes)}
            if w.distance_km is not None:
                value["distance_km"] = round(w.distance_km, 2)
            await add_stat(db, friend_id, "workout", value, w.start or now, "shortcut")
            stored.append("workout")
    except ReducerRejected as e:
        raise rejected(e) from e
    return {"stored": stored}


# ---------- Screen Time screenshot ----------

SCREEN_TIME_SYSTEM = """You read iPhone or Android Screen Time / Digital Wellbeing screenshots. \
Extract only what is visibly on screen. If the image isn't a screen-time summary, set is_screen_time to false. \
Hours are decimal (2h 30m = 2.5). Use null for anything not shown."""

SCREEN_TIME_SCHEMA = {
    "type": "object",
    "properties": {
        "is_screen_time": {"type": "boolean"},
        "period": {"type": "string", "enum": ["day", "week", "unknown"]},
        "daily_avg_hours": {"type": ["number", "null"]},
        "top_apps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "hours": {"type": ["number", "null"]}},
                "required": ["name", "hours"],
                "additionalProperties": False,
            },
        },
        "pickups": {"type": ["integer", "null"]},
    },
    "required": ["is_screen_time", "period", "daily_avg_hours", "top_apps", "pickups"],
    "additionalProperties": False,
}


class ImageIn(BaseModel):
    media_type: str
    data: str = Field(description="base64, no data: prefix")


def check_image(img: ImageIn) -> tuple[str, str]:
    if img.media_type not in IMAGE_TYPES:
        raise HTTPException(415, f"use one of: {', '.join(sorted(IMAGE_TYPES))}")
    try:
        raw = base64.b64decode(img.data, validate=True)
    except ValueError as e:
        raise HTTPException(422, "data isn't valid base64") from e
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "image is over 5 MB")
    return img.media_type, img.data


def clean_screen_time(parsed: dict) -> dict:
    """Validate what Claude read: plausible numbers only, at most 5 apps."""
    hours = parsed.get("daily_avg_hours")
    if not isinstance(hours, (int, float)) or not 0 <= hours <= 24:
        raise HTTPException(422, "couldn't read a daily screen time from that screenshot")
    pickups = parsed.get("pickups")
    if not isinstance(pickups, int) or not 0 <= pickups <= 2000:
        pickups = None
    apps = [a["name"].strip()[:40] for a in parsed.get("top_apps", []) if a.get("name", "").strip()][:5]
    return {"daily_avg_hours": round(hours, 2), "top_apps": apps, "pickups": pickups, "period": parsed.get("period")}


@router.post("/ingest/screen-time")
async def ingest_screen_time(body: ImageIn, friend_id: Friend, request: Request):
    image = check_image(body)
    model = llm(request)
    if not model.available:
        raise HTTPException(503, "screenshot reading needs ANTHROPIC_API_KEY on the agent service")
    parsed = await model.write_json(
        SCREEN_TIME_SYSTEM, "Read this screenshot.", SCREEN_TIME_SCHEMA, model=VISION_MODEL, image=image
    )
    if parsed is None:
        raise HTTPException(502, "couldn't read the screenshot, try again")
    if not parsed["is_screen_time"]:
        raise HTTPException(422, "that doesn't look like a Screen Time screenshot")
    value = clean_screen_time(parsed)
    try:
        await add_stat(stdb(request), friend_id, "screen_time", value, datetime.now(UTC), "upload")
    except ReducerRejected as e:
        raise rejected(e) from e
    return {"stored": value}


# ---------- Photos ----------

PHOTO_SYSTEM = """You help a friend group share fun places. Given a place where a friend took a photo, \
rate how unusual it is as a place to spend time (0 = home, office, chain store or a usual commute spot; \
1 = something like a llama farm, an abandoned lighthouse or a tiny-town festival) and write a one-line \
caption for the group chat in third person, playful, one emoji at most. Don't mention exact addresses."""

PHOTO_SCHEMA = {
    "type": "object",
    "properties": {
        "obscurity_score": {"type": "number"},
        "caption": {"type": "string"},
    },
    "required": ["obscurity_score", "caption"],
    "additionalProperties": False,
}


class PhotoIn(BaseModel):
    taken_at: datetime | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    # Used when the photo had no GPS (or to correct the looked-up name).
    place_name: str | None = Field(default=None, max_length=120)


async def reverse_geocode(http: httpx.AsyncClient, lat: float, lng: float) -> str | None:
    """A short place name from OpenStreetMap, e.g. 'Llama farm, Snohomish, WA'."""
    try:
        r = await http.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 16},
            headers={"User-Agent": "Orbit/0.1 (Cal Hacks 13.0 demo)"},
        )
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        log.warning("Reverse geocoding failed")
        return None
    addr = data.get("address", {})
    name = data.get("name") or addr.get("tourism") or addr.get("leisure") or addr.get("amenity")
    town = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("hamlet") or addr.get("county")
    region = addr.get("state")
    parts = [p for p in (name, town, region) if p]
    return ", ".join(dict.fromkeys(parts)) or data.get("display_name")


@router.post("/ingest/photo")
async def ingest_photo(body: PhotoIn, friend_id: Friend, request: Request):
    place = (body.place_name or "").strip()
    if not place and body.lat is not None and body.lng is not None:
        place = await reverse_geocode(request.app.state.http, body.lat, body.lng) or ""
    if not place:
        raise HTTPException(422, "no location in that photo; type the place instead")
    rows = await stdb(request).sql(f"SELECT name FROM friend WHERE id = {friend_id}")
    first = rows[0]["name"].split()[0] if rows else "Someone"
    rated = await llm(request).write_json(
        PHOTO_SYSTEM, f"{first} took a photo at: {place}", PHOTO_SCHEMA, model=VISION_MODEL
    )
    score = min(max(float(rated["obscurity_score"]), 0.0), 1.0) if rated else 0.5
    caption = (rated["caption"].strip() if rated else "") or f"{first} at {place}"
    try:
        await stdb(request).call(
            "add_photo",
            friend_id=friend_id,
            place_name=place,
            taken_at=(body.taken_at or datetime.now(UTC)).astimezone(UTC).isoformat(),
            obscurity_score=score,
            caption=caption[:300],
            # Exact GPS goes to the private photo_location table only.
            lat=body.lat if body.lat is not None else 0.0,
            lng=body.lng if body.lng is not None else 0.0,
        )
    except ReducerRejected as e:
        raise rejected(e) from e
    return {"place_name": place, "obscurity_score": score, "caption": caption}

