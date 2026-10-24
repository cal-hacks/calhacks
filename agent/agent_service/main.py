"""The agent service's web server.

Run from agent/:  uv run uvicorn agent_service.main:app --reload --port 8000
"""

from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .auth import current_friend
from .config import load_settings
from .stdb import StdbClient

settings = load_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tests replace app.state.stdb before the first request.
    if not hasattr(app.state, "stdb"):
        app.state.stdb = StdbClient(settings.stdb_uri, settings.stdb_db, settings.stdb_token)
    yield
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


# Lets the web app and the Shortcut check that an ingest token works.
@app.get("/me")
async def me(friend_id: Friend):
    rows = await app.state.stdb.sql(f"SELECT id, name FROM friend WHERE id = {friend_id}")
    if not rows:
        raise HTTPException(404, "friend not found")
    return {"friend_id": friend_id, "name": rows[0]["name"]}
