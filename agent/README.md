# Agent service

Python service for the friend agents and the coordinator. It receives data that has to come through a server (iOS Shortcut, Screen Time and photo uploads, Google sign-in), calls Claude, and reads and writes SpacetimeDB over its HTTP API.

```bash
uv sync
uv run pytest
uv run uvicorn agent_service.main:app --reload --port 8000
```

Settings come from `.env` at the repo root (copy `.env.example`). `SPACETIMEDB_TOKEN` must be the **owner** token (`spacetime login show --token`), because only the owner can read private tables.

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

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /health` | none | `{"ok": true}` |
| `GET /me` | ingest token | `{"friend_id", "name"}`; use it to check a token works |

Allowed browser origins come from `WEB_ORIGINS` (default `http://localhost:5173`).

## Fetch.ai agents (Agentverse + ASI:One)

`agent_service/fetch_agents.py` runs one **friend agent** per friend in the group plus the **coordinator**, all in one process (a uAgents Bureau). The coordinator speaks the Agent Chat Protocol, so ASI:One can find it and chat with it. When it gets a message, it asks every friend agent for an update over uAgents messages, then replies with a digest. If the message asks for a plan ("plan", "call", "meet", "catch up"), it also finds the earliest times everyone is free and calls `propose_plan`, so the options appear in the in-app group chat. If a plan is already open, it points to that one instead of posting another.

```bash
uv run python -m agent_service.fetch_agents
```

Needs `FETCH_AGENT_SEED` in `.env`. The seed fixes each agent's address, so keep it stable and secret. Friend agents are created for the group's friends at startup, so restart after someone new joins. Without `ANTHROPIC_API_KEY`, the digest falls back to a plain list.

**Connecting to Agentverse (once per agent):** the startup log prints a `connect:` link under each agent's address. Open it while signed in to Agentverse, click **Connect**, and choose **Mailbox**. Do this for the coordinator and each friend agent. After that the agents receive messages through Agentverse without a public URL. Copy the addresses from the startup log into `AGENTS.md`, which is also the coordinator's README on Agentverse.

**If the inspector says it can't find the agent on localhost:** use the browser on this Mac, and in Chrome allow agentverse.ai to access devices on your local network when asked. Or skip the inspector: put an Agentverse API key (Agentverse → profile → API Keys) in `.env` as `AGENTVERSE_API_KEY`, then, with the agents running, run `uv run python -m agent_service.connect_agentverse`. It connects every agent's mailbox and prints one line per agent.

**Testing in ASI:One:** open asi1.ai, signed in with the same Fetch account, and ask "Catch me up on my friends and plan something for this week". You can also search Agentverse for `catchup-coordinator` and chat with it from its page.
