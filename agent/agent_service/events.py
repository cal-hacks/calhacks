"""What the agents are doing, for the Agent Network screen (web /agents).

Each step (a request to a friend's agent, its reply and what it kept
private, a web search, a post, a vote) becomes one `agent_event` row: a
readable line, never raw data. Logging is off until `EVENTS.use(stdb)` is
called by the running agents, so tests and scripts don't write any; a failed
write never breaks the flow it describes.
"""

import asyncio
import logging

from .stdb import StdbClient

log = logging.getLogger(__name__)

# A beat between steps so the screen can show them one by one.
STAGGER_S = 0.25


class Events:
    def __init__(self) -> None:
        self.stdb: StdbClient | None = None

    def use(self, stdb: StdbClient) -> None:
        self.stdb = stdb

    async def emit(
        self,
        kind: str,
        text: str,
        *,
        actor: int = 0,
        target: int = 0,
        group: int = 0,
        detail: str = "",
        pause: bool = False,
    ) -> None:
        """Log one step. `actor`/`target` are friend ids (0 = the coordinator)."""
        if self.stdb is None:
            return
        try:
            await self.stdb.call(
                "log_agent_event",
                kind=kind,
                actor_friend_id=actor,
                target_friend_id=target,
                group_id=group,
                text=text[:480],
                detail=detail[:480],
            )
        except Exception:
            log.warning("Couldn't log agent event: %s", text, exc_info=True)
        if pause:
            await asyncio.sleep(STAGGER_S)


EVENTS = Events()


def first(name: str) -> str:
    return name.split()[0] if name else "Someone"


async def chat_name(stdb: StdbClient, group_id: int) -> str:
    """'Class of ’25 🎓' for a group, 'Riley & Priya’s chat' for a 1:1."""
    if EVENTS.stdb is None:
        return "the chat"
    groups = await stdb.sql("SELECT id, name, is_direct FROM friend_group")
    group = next((g for g in groups if g["id"] == group_id), None)
    if group is None:
        return "the chat"
    if not group["is_direct"]:
        return group["name"]
    members = {m["friend_id"] for m in await stdb.sql(f"SELECT friend_id FROM membership WHERE group_id = {group_id}")}
    names = [first(f["name"]) for f in await stdb.sql("SELECT id, name FROM friend") if f["id"] in members]
    return f"{' & '.join(sorted(names))}’s chat"
