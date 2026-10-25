"""Saved logins that survive restarts.

The agent service's host (Render's free plan) wipes its disk on every
restart and redeploy, and it restarts each time it wakes from sleep. Google
refresh tokens and Canvas tokens kept only in a file would vanish, and a
connected calendar would quietly stop syncing. So each store also mirrors
its JSON into the module's private `secret` table (only the database owner,
this service, can read it) and loads from there on startup.
"""

import asyncio
import json
import logging
from typing import Any

from .stdb import StdbClient

log = logging.getLogger(__name__)


class Mirror:
    """One JSON blob in the `secret` table, written in the background.

    Writes are coalesced: only the newest value is sent, and never out of
    order, so a slow write can't overwrite a newer one.
    """

    def __init__(self, stdb: StdbClient, key: str):
        self.stdb = stdb
        self.key = key
        self._pending: str | None = None
        self._task: asyncio.Task | None = None

    async def load(self) -> dict[str, Any]:
        try:
            rows = await self.stdb.sql(f"SELECT value FROM secret WHERE key = '{self.key}'")
        except Exception:
            log.warning("Couldn't load saved %s", self.key, exc_info=True)
            return {}
        return json.loads(rows[0]["value"]) if rows else {}

    def push(self, data: dict[str, Any]) -> None:
        self._pending = json.dumps(data)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # no loop (scripts): nothing to schedule on
            return
        if self._task is None or self._task.done():
            self._task = loop.create_task(self._flush())

    async def flush(self) -> None:
        """Wait for pending writes (tests, shutdown)."""
        if self._task is not None:
            await self._task

    async def _flush(self) -> None:
        while self._pending is not None:
            value, self._pending = self._pending, None
            try:
                await self.stdb.call("put_secret", key=self.key, value=value)
            except Exception:
                log.warning("Couldn't save %s", self.key, exc_info=True)
