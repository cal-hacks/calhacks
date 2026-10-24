"""Claude calls. Everything here returns None on failure so callers can fall
back to plain text instead of breaking the chat."""

import logging

import anthropic

MODEL = "claude-opus-5-5"
log = logging.getLogger(__name__)


class Llm:
    def __init__(self, api_key: str):
        self._client = anthropic.AsyncAnthropic(api_key=api_key) if api_key else None

    async def write(self, system: str, prompt: str, *, effort: str = "low") -> str | None:
        if self._client is None:
            return None
        try:
            response = await self._client.beta.messages.create(
                model=MODEL,
                max_tokens=16000,
                # On a policy decline the API retries on a fallback model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": effort},
                system=system,
                messages=[{"role": "user", "content": prompt}],
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
