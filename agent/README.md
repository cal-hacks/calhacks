# Orbit agent service

FastAPI service that runs the in-app goal-coach chat on Claude (`claude-opus-5-5`).

```bash
cd agent
cp .env.example .env        # add ANTHROPIC_API_KEY
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The iOS Simulator reaches it at `http://localhost:8000` (the app's dev default).
For a physical phone, set `EXPO_PUBLIC_AGENT_API_URL` in `mobile/.env` to your
Mac's LAN IP or a tunnel URL.

## How it works

`POST /agent/chat` takes the full message history and runs one Claude turn with
the tools in `app/tools.py` (`list_goals`, `create_goal`, `log_progress`,
`update_goal`, `get_progress_summary`). The tools **execute on the phone**,
because goals live on-device until the SpacetimeDB backend lands. The app
(`mobile/src/lib/agent.ts`) runs each `tool_use` block, sends every
`tool_result` back in one message, and repeats until Claude replies with text.

- The Anthropic key stays on this server; the app never sees it.
- History is append-only and content blocks (including thinking blocks) are
  passed back unchanged, as the API requires.
- Tools use `strict: true`, and the app still validates inputs before running them.
- Refusals fall back server-side (`fallbacks: "default"`); a final refusal is
  shown as a short message in the chat.
- Optional `ORBIT_SHARED_SECRET`: when set, clients must send `X-Orbit-Key`
  (the app sends `EXPO_PUBLIC_AGENT_KEY`). Anything bundled in an app can be
  extracted, so put real per-user auth in front of this before launch.
