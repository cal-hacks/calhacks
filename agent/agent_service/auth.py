"""Which friend is calling: the iOS Shortcut and browser uploads send
`Authorization: Bearer <ingest token>`.

The browser makes the token, stores its SHA-256 hash with the
set_ingest_token reducer, and keeps the token itself. We hash what we're sent
and look it up in the private ingest_token table.
"""

import hashlib

from fastapi import Header, HTTPException, Request

from .stdb import StdbClient

MAX_TOKEN_LENGTH = 256


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def friend_for_token(stdb: StdbClient, token: str) -> int | None:
    # The hash is hex, so it's safe to put in the query.
    rows = await stdb.sql(
        f"SELECT friend_id FROM ingest_token WHERE token_hash = '{hash_token(token)}'"
    )
    return rows[0]["friend_id"] if rows else None


async def current_friend(request: Request, authorization: str = Header(default="")) -> int:
    """FastAPI dependency: the calling friend's id, or 401."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > MAX_TOKEN_LENGTH:
        raise HTTPException(401, "send Authorization: Bearer <ingest token>")
    friend_id = await friend_for_token(request.app.state.stdb, token)
    if friend_id is None:
        raise HTTPException(401, "unknown ingest token")
    return friend_id
