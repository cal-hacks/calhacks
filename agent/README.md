# Orbit agent service

One Python project with three parts:

- **Web server** (`agent_service/main.py`, FastAPI): the goal-coach chat (`POST /agent/chat`, from `app/`) and the ingest endpoints.
- **Fetch.ai agents** (`agent_service/fetch_agents.py`): one friend agent per friend plus the group coordinator, reachable from ASI:One.
- **Chat watcher** (runs inside the agents process): turns check-ins and finished goals into group-chat highlights, and "we should catch up" into a plan.

```bash
cd agent
uv sync
uv run pytest
uv run uvicorn agent_service.main:app --host 0.0.0.0 --port 8000   # web server
uv run python -m agent_service.fetch_agents                        # agents + watcher
```

Settings come from `.env` at the repo root (copy `.env.example`). `agent/.env` still works for the goal-coach chat.

The iOS Simulator reaches the web server at `http://localhost:8000` (the app's dev default). For a physical phone, set `EXPO_PUBLIC_AGENT_API_URL` in `mobile/.env` to your Mac's LAN IP or a tunnel URL.

## Goal-coach chat (`app/`)

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

## Talking to SpacetimeDB

`agent_service/stdb.py` wraps the HTTP API:

```python
stdb = StdbClient(uri, db, token)
await stdb.call("post_feed_item", group_id=1, friend_id=2, kind="highlight",
                text="...", reply_to_id=0, local_date="2026-10-24")
rows = await stdb.sql("SELECT id, name FROM friend")   # list of dicts
```

- Pass snake_case keyword arguments; `call` converts them to the camelCase names SpacetimeDB expects.
- `ReducerRejected` means a rule said no (consent off, daily limit, roast not allowed). Skip it; don't retry.
- `sql` decodes options (`None` or the value), timestamps (UTC `datetime`) and identities (hex string).

## Which friend is calling: ingest tokens

The iOS Shortcut and browser uploads send `Authorization: Bearer <ingest token>`. The service hashes it and looks it up in the private `ingest_token` table.

The web app sets the token up once per friend, after `join_group` or `claim_friend`:

```ts
const bytes = crypto.getRandomValues(new Uint8Array(32));
const token = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]!);
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
const tokenHash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
await conn.reducers.setIngestToken({ tokenHash });
localStorage.setItem('ingestToken', token); // show it on the Shortcut setup screen
```

Only the hash goes into SpacetimeDB. Calling `set_ingest_token` again replaces the old token, so a lost token is fixed by making a new one.

## Endpoints

All but `/health` are called as a friend: `Authorization: Bearer <ingest token>`. Writes go through agent-only reducers, so a source the friend has turned off is refused with 403 and the module's reason.

| Endpoint | Body | What it does |
|---|---|---|
| `GET /health` | | `{"ok": true}` |
| `GET /me` | | `{"friend_id", "name"}`; checks a token works |
| `POST /ingest/health` | `{"date"?, "steps"?, "sleep"?: [{start, end}], "workouts"?: [{kind, minutes, distance_km?, start?}]}` | The iOS Shortcut. `steps` may be a number or a list of samples; sleep samples merge into one night |
| `POST /ingest/screen-time` | `{"media_type", "data"}` (base64 screenshot, max 5 MB) | Claude Haiku reads daily average, top apps and pickups; numbers are validated before storing |
| `POST /ingest/photo` | `{"lat"?, "lng"?, "taken_at"?, "place_name"?}` | Only location and time, never the image. Reverse-geocodes with OpenStreetMap (or uses `place_name`), Claude Haiku rates how unusual it is and writes a caption; GPS goes to the private `photo_location` table |
| `POST /calendar/google/token` | `{"access_token", "expires_in"}` | Google free/busy for the next week becomes free blocks (evenings and weekends in the friend's time zone); refreshed every 15 min while the token lasts |
| `POST /canvas/token` | `{"base_url", "token"}` | Canvas planner deadlines for the next week (3+ = heavy week); refreshed hourly. Only `https` public hostnames |
| `POST /agent/chat` | | Goal-coach chat (above) |

Google and Canvas tokens are kept on disk next to this README (`.google_tokens.json`, `.canvas_tokens.json`, mode 600, gitignored), never in SpacetimeDB. Allowed browser origins come from `WEB_ORIGINS` (default `*`: requests carry bearer tokens, not cookies).

## What the watcher posts

It runs every 3 s inside the agents process. Seed data is never posted, and the module still enforces one agent post per friend per day.

| Source | Posted when | Kind |
|---|---|---|
| Check-in | Claude thinks it's worth sharing | `highlight` |
| Goal reaches its target | always (Claude writes it) | `goal_hit` |
| Workout, 10k+ steps | health is shared as highlights | `highlight` |
| Screen Time | lowest in the group (praise); highest only if the friend allowed roasts | `highlight` / `roast` |
| Photo | unusual enough (score ≥ 0.6); photos must be shared as highlights | `obscure_place` |
| Sleep, Canvas deadlines | never: planning and check-on-me only | |
| "we should catch up" in the chat | coordinator finds shared free time, preferring times after anyone's heavy week | `plan_proposal` |

## Fetch.ai agents (Agentverse + ASI:One)

`agent_service/fetch_agents.py` runs one **friend agent** per friend in the group plus the **coordinator**, all in one process (a uAgents Bureau). The coordinator speaks the Agent Chat Protocol, so ASI:One can find it and chat with it. When it gets a message, it asks every friend agent for an update over uAgents messages, then replies with a digest. If the message asks for a plan ("plan", "call", "meet", "catch up"), it also finds the earliest times everyone is free and calls `propose_plan`, so the options appear in the in-app group chat. If a plan is already open, it points to that one instead of posting another.

```bash
uv run python -m agent_service.fetch_agents
```

Needs `FETCH_AGENT_SEED` in `.env`. The seed fixes each agent's address, so keep it stable and secret. Friend agents are created for the group's friends at startup, so restart after someone new joins. Without `ANTHROPIC_API_KEY`, the digest falls back to a plain list.

**Connecting to Agentverse (once per agent):** the startup log prints a `connect:` link under each agent's address. Open it while signed in to Agentverse, click **Connect**, and choose **Mailbox**. Do this for the coordinator and each friend agent. After that the agents receive messages through Agentverse without a public URL. Copy the addresses from the startup log into `AGENTS.md`, which is also the coordinator's README on Agentverse.

**If the inspector says it can't find the agent on localhost:** use the browser on this Mac, and in Chrome allow agentverse.ai to access devices on your local network when asked. Or skip the inspector: put an Agentverse API key (Agentverse → profile → API Keys) in `.env` as `AGENTVERSE_API_KEY`, then, with the agents running, run `uv run python -m agent_service.connect_agentverse`. It connects every agent's mailbox and prints one line per agent.

**Testing in ASI:One:** open asi1.ai, signed in with the same Fetch account, and ask "Catch me up on my friends and plan something for this week". You can also search Agentverse for `catchup-coordinator` and chat with it from its page.
