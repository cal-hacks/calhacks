"""Claude calls. Everything here returns None on failure so callers can fall
back to plain text instead of breaking the chat."""

import asyncio
import json
import logging
import re
from typing import Any

import anthropic

MODEL = "claude-opus-5-5"
# Screenshot reading, photo captions and the demo cast's chatter: fast and cheap.
VISION_MODEL = "claude-haiku-5-5"
log = logging.getLogger(__name__)
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search"}
# A long search turn can stop with pause_turn; resend to let the server resume.
MAX_CONTINUATIONS = 3
# A plan someone's waiting on in the chat: past this, use the plain ideas.
SEARCH_TIMEOUT_S = 30.0
FALLBACK = dict(betas=["server-side-fallback-2026-07-01"], fallbacks="default")


class Llm:
    def __init__(self, api_key: str):
        self._client = anthropic.AsyncAnthropic(api_key=api_key) if api_key else None
        # The web searches Claude ran in the last search_json call, for the Agent Network screen.
        self.last_queries: list[str] = []

    @property
    def available(self) -> bool:
        return self._client is not None

    async def write(self, system: str, prompt: str, *, effort: str = "low", model: str = MODEL) -> str | None:
        return await self._create(system, prompt, {"effort": effort}, model=model)

    async def write_json(
        self,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        *,
        model: str = MODEL,
        image: tuple[str, str] | None = None,
    ) -> dict | None:
        """A JSON object matching `schema` (structured outputs), or None.

        `image` is (media_type, base64 data), sent before the prompt.
        """
        text = await self._create(
            system,
            prompt,
            {"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            model=model,
            image=image,
        )
        if text is None:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            log.warning("Claude returned invalid JSON; skipping")
            return None

    async def search_json(
        self,
        system: str,
        prompt: str,
        *,
        max_searches: int = 3,
        effort: str = "low",
        timeout: float = SEARCH_TIMEOUT_S,
    ) -> dict | None:
        """A JSON object from a turn that may search the web, or None (also
        when it takes longer than `timeout` seconds, searches included).

        Structured outputs can't be combined with web search (search results
        come back with citations, which structured outputs reject), so the
        prompt asks for JSON and the final text is parsed leniently.
        """
        self.last_queries = []
        if self._client is None:
            return None
        try:
            return await asyncio.wait_for(self._search(system, prompt, max_searches, effort), timeout)
        except TimeoutError:
            log.warning("Claude web search took over %gs; skipping", timeout)
            return None

    async def _search(self, system: str, prompt: str, max_searches: int, effort: str) -> dict | None:
        assert self._client is not None
        tools = [{**WEB_SEARCH, "max_uses": max_searches}]
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
        try:
            for _ in range(MAX_CONTINUATIONS + 1):
                response = await self._client.beta.messages.create(
                    model=MODEL,
                    max_tokens=16000,
                    # Low fits the 30s limit (medium often runs past it); the
                    # prompt asks for searches first, so ideas stay specific.
                    output_config={"effort": effort},
                    system=system,
                    tools=tools,
                    messages=messages,
                    **FALLBACK,
                )
                for b in response.content:
                    query = str(b.input.get("query", "")).strip() if b.type == "server_tool_use" and isinstance(getattr(b, "input", None), dict) else ""
                    if query and query not in self.last_queries:
                        self.last_queries.append(query)
                if response.stop_reason != "pause_turn":
                    break
                # Resend the paused turn as is; the server picks up where it stopped.
                messages = [messages[0], {"role": "assistant", "content": response.content}]
            else:
                log.warning("Claude web search kept pausing; skipping")
                return None
        except anthropic.APIStatusError as e:
            log.warning("Claude error %s: %s", e.status_code, e.message)
            return None
        except anthropic.APIConnectionError:
            log.warning("Can't reach Claude; using plain text")
            return None
        if response.stop_reason == "refusal":
            return None
        log.info("Claude replied after %d server tool calls", sum(b.type == "server_tool_use" for b in response.content))
        return parse_json_text(final_text(response.content))

    async def _create(
        self,
        system: str,
        prompt: str,
        output_config: dict[str, Any],
        *,
        model: str = MODEL,
        image: tuple[str, str] | None = None,
    ) -> str | None:
        if self._client is None:
            return None
        content: list[dict[str, Any]] = []
        if image:
            media_type, data = image
            content.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
        content.append({"type": "text", "text": prompt})
        request: dict[str, Any] = dict(
            model=model,
            max_tokens=16000,
            output_config=output_config,
            system=system,
            messages=[{"role": "user", "content": content}],
        )
        try:
            if model == VISION_MODEL:
                # Haiku has no server-side fallback; a refusal just returns None.
                response = await self._client.messages.create(**request)
            else:
                # On a policy decline the API retries on a fallback model.
                response = await self._client.beta.messages.create(
                    **request, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
                )
        except anthropic.RateLimitError:
            log.warning("Claude rate limited; using plain text")
            return None
        except anthropic.APIStatusError as e:
            log.warning("Claude error %s: %s", e.status_code, e.message)
            return None
        except anthropic.APIConnectionError:
            log.warning("Can't reach Claude; using plain text")
            return None
        if response.stop_reason == "refusal":
            return None
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        return text or None


def final_text(content: list[Any]) -> str:
    """Text after the last tool block: the answer, not the "let me search" preamble."""
    last_tool = max((i for i, b in enumerate(content) if b.type != "text"), default=-1)
    tail = "".join(b.text for b in content[last_tool + 1:] if b.type == "text")
    return tail.strip() or "".join(b.text for b in content if b.type == "text").strip()


def parse_json_text(text: str) -> dict | None:
    """The JSON object in a reply, tolerating code fences or a sentence around it."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        log.warning("Claude reply had no JSON object; skipping")
        return None
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        log.warning("Claude returned invalid JSON; skipping")
        return None
    return value if isinstance(value, dict) else None
