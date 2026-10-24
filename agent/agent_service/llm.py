"""Claude calls. Everything here returns None on failure so callers can fall
back to plain text instead of breaking the chat."""

import json
import logging
from typing import Any

import anthropic

MODEL = "claude-opus-5-5"
# Screenshot reading and photo captions (the plan's choice: fast and cheap).
VISION_MODEL = "claude-haiku-5-5"
log = logging.getLogger(__name__)


class Llm:
    def __init__(self, api_key: str):
        self._client = anthropic.AsyncAnthropic(api_key=api_key) if api_key else None

    @property
    def available(self) -> bool:
        return self._client is not None

    async def write(self, system: str, prompt: str, *, effort: str = "low") -> str | None:
        return await self._create(system, prompt, {"effort": effort})

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
