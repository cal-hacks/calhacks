"""Orbit agent service.

POST /agent/chat runs one turn of the goal-coach conversation against Claude.
The app owns the loop: it sends the full message history, executes any
tool_use blocks on the device, and calls back with the tool_result blocks.
The Anthropic API key never leaves this server.
"""

import logging
import os
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .tools import TOOLS

# The repo-root .env is shared with agent_service; agent/.env still works.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv()
log = logging.getLogger("orbit.agent")

MODEL = "claude-opus-5-5"
MAX_MESSAGES = 80

SYSTEM_PROMPT = """You are the Orbit agent, a friendly goal coach inside an app that helps college friends who moved to different cities keep up with each other.

In this chat the user sets goals and logs progress by talking to you. Use the tools to read and change their goals; they run on the user's phone and reflect the real state of the app.

How to work:
- When the user describes something they did, find the matching goal with list_goals and log it in that goal's unit (2 hours to a minutes goal is 120). If no goal fits, offer to create one rather than guessing.
- When the user describes something they want to do regularly, create a goal. Ask one short question only if the period or target is genuinely unclear; otherwise pick sensible defaults and say what you chose.
- After a change, confirm it in one or two sentences with the new progress (for example "Logged 2h. You're at 3h of 5h this week.").
- Each user message starts with a line giving today's date and time zone. Use it for "today", "yesterday" and weekday references.

Tone:
- Warm, brief and encouraging. Celebrate wins; never shame missed days or compare the user to anyone.
- Don't interpret health data or offer diagnoses. If someone mentions struggling, be kind and suggest reaching out to a friend, without probing.
- Plain text only: no markdown headings or tables, since replies are shown in a phone chat bubble."""

client = anthropic.Anthropic()

# agent_service.main serves these routes too, next to the ingest endpoints.
router = APIRouter()


class ChatRequest(BaseModel):
    # Content blocks are passed through verbatim (including thinking blocks),
    # which keeps the history append-only as the API requires.
    messages: list[dict[str, Any]] = Field(min_length=1, max_length=MAX_MESSAGES)


class ChatResponse(BaseModel):
    content: list[dict[str, Any]]
    stop_reason: str | None


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/agent/chat", response_model=ChatResponse)
def chat(req: ChatRequest, x_orbit_key: str | None = Header(default=None)) -> ChatResponse:
    secret = os.getenv("ORBIT_SHARED_SECRET")
    if secret and x_orbit_key != secret:
        raise HTTPException(status_code=401, detail="Missing or wrong X-Orbit-Key")

    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            # Stable prefix (tools + system) is cached across turns.
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=TOOLS,
            messages=req.messages,
            # Short conversational turns with simple tool calls.
            output_config={"effort": "low"},
            # Re-run on Anthropic's recommended model if a safety classifier declines.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.BadRequestError as e:
        log.warning("bad request: %s", e.message)
        raise HTTPException(status_code=400, detail=e.message) from e
    except anthropic.AuthenticationError as e:
        raise HTTPException(status_code=500, detail="Agent service has no valid Anthropic credentials") from e
    except anthropic.RateLimitError as e:
        raise HTTPException(status_code=429, detail="The agent is busy. Try again in a moment.") from e
    except anthropic.APIStatusError as e:
        log.error("anthropic %s: %s", e.status_code, e.message)
        raise HTTPException(status_code=502, detail="The agent couldn't reach Claude.") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(status_code=502, detail="The agent couldn't reach Claude.") from e
    except TypeError as e:
        # Raised by the SDK before any request when no API key or profile is set up.
        if "authentication" not in str(e):
            raise
        raise HTTPException(status_code=503, detail="The agent service has no Anthropic API key yet (set ANTHROPIC_API_KEY in agent/.env).") from e

    return ChatResponse(
        content=[block.to_dict() for block in response.content],
        stop_reason=response.stop_reason,
    )


app = FastAPI(title="Orbit agent service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST", "GET"], allow_headers=["*"])
app.include_router(router)
