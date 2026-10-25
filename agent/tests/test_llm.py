import json

import anthropic
import httpx2 as httpx  # the SDK's HTTP client
import pytest

from agent_service.llm import Llm, parse_json_text


@pytest.mark.parametrize(
    "text, expected",
    [
        ('{"title": "x"}', {"title": "x"}),
        ('```json\n{"title": "x"}\n```', {"title": "x"}),
        ('Here you go: {"options": [{"slot": 1}]} Enjoy!', {"options": [{"slot": 1}]}),
        ("no json here", None),
        ('{"title": ', None),
        ("[1, 2]", None),
    ],
)
def test_parse_json_text(text, expected):
    assert parse_json_text(text) == expected


def message(content, stop_reason="end_turn"):
    return {
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
        "content": content, "stop_reason": stop_reason, "stop_sequence": None,
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }


def fake_llm(responses):
    """An Llm whose client talks to a fake API that replays `responses`."""
    requests = []

    def handler(request: httpx.Request):
        requests.append(json.loads(request.content))
        reply = responses[len(requests) - 1]
        return reply if isinstance(reply, httpx.Response) else httpx.Response(200, json=reply)

    llm = Llm("")
    llm._client = anthropic.AsyncAnthropic(
        api_key="test", max_retries=0, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    return llm, requests


SEARCH = {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {"query": "new movies"}}
RESULT = {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_1", "content": [
    {"type": "web_search_result", "url": "https://example.com", "title": "Movies", "encrypted_content": "x", "page_age": None},
]}


async def test_search_json_resumes_a_paused_turn_and_reads_the_final_text():
    llm, requests = fake_llm([
        message([{"type": "text", "text": "Let me look that up."}, SEARCH], stop_reason="pause_turn"),
        message([RESULT, {"type": "text", "text": '{"title": "Movie night 🎬", "options": []}'}]),
    ])
    assert await llm.search_json("system", "plan something") == {"title": "Movie night 🎬", "options": []}
    first, second = requests
    assert first["tools"] == [{"type": "web_search_20260209", "name": "web_search", "max_uses": 4}]
    assert "output_config" in first and "format" not in first["output_config"]
    # The paused turn goes back as is, with no extra "continue" message.
    assert [m["role"] for m in second["messages"]] == ["user", "assistant"]
    assert second["messages"][1]["content"][1]["type"] == "server_tool_use"


async def test_search_json_returns_none_on_failure():
    llm, _ = fake_llm([httpx.Response(500, json={"type": "error", "error": {"type": "api_error", "message": "boom"}})])
    assert await llm.search_json("system", "plan something") is None
    llm, _ = fake_llm([message([{"type": "text", "text": "Sorry, no ideas."}])])
    assert await llm.search_json("system", "plan something") is None
    assert await Llm("").search_json("system", "plan something") is None
