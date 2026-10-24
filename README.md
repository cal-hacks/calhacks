# Orbit

**Agents that keep long-distance friends in each other's lives, and get them back together.**

For college friends who moved to different cities after graduating. Each friend has an AI agent that notices what's happening in their life (a goal hit, a check-in, a weird place), decides whether it's worth sharing, and posts it to the group chat as a conversation starter. When someone says "we should catch up", a coordinator agent finds a time that fits everyone's calendars across time zones and puts it to a vote.

## What's in the repo

| Folder | What | Stack |
|---|---|---|
| `web/` | The app: group chat, goals, dashboard, friends, consent | React + Vite |
| `mobile/` | Native iOS app with the same screens and Apple Screen Time (not wired to the live group yet) | Expo |
| `server/` | Shared world state: tables, rules and per-person views | SpacetimeDB module (TypeScript) |
| `agent/` | Goal-coach chat, friend agents, coordinator, chat watcher | Python, Claude, Fetch.ai uAgents |

```
web app ──live subscriptions / reducer calls──▶ SpacetimeDB (server/) ◀──HTTP── agent service (agent/)
                                                                                 ├─ watcher: check-ins → highlights, "catch up" → plan
                                                                                 ├─ friend agents + coordinator (Fetch.ai, ASI:One)
                                                                                 └─ goal-coach chat (/agent/chat)
```

## Run it locally

1. **SpacetimeDB** (`server/README.md`):
   ```bash
   spacetime start --listen-addr 0.0.0.0:3000   # 0.0.0.0 so phones on your Wi-Fi can reach it
   spacetime publish -s local -p server calhacks
   spacetime call -s local calhacks seed_demo
   ```
2. **Settings:** copy `.env.example` to `.env` and fill in `SPACETIMEDB_TOKEN` (`spacetime login show --token`), `ANTHROPIC_API_KEY` and `FETCH_AGENT_SEED`.
3. **Agents + watcher** (`agent/README.md`):
   ```bash
   cd agent && uv sync && uv run python -m agent_service.fetch_agents
   ```
4. **Web app:**
   ```bash
   cd web && npm install && npm run dev
   ```
   Log in as `demo` / `demo1234` (Riley). Other phones on the same Wi-Fi open the LAN URL Vite prints and log in as `maya_runs`, `jordanp` or `sam_l` (same password).

To start the demo over: `spacetime call -s local calhacks reset_demo`, then `seed_demo`.

## The demo

1. **Life → conversation:** on the Group page, tap **Check-in** and send "ran my first 10K 🎉". Within a few seconds the friend's agent posts a highlight to everyone's chat.
2. **Momentum → plan:** someone sends "we should catch up this week". The coordinator asks each friend agent for free time and posts three call times, each shown in every friend's time zone. Tap to vote; it's confirmed when most of the group picks the same time.
3. **ASI:One:** "Catch me up on my friends and plan something for this week" → a digest from the friend agents plus the same plan (`agent/AGENTS.md`).

## Trust and failure modes

- **Oversharing:** raw stats, GPS, free time and nudges live in private tables that other people's apps can't read. Agents only post check-ins and goals people chose to share, and Claude is told to skip anything too personal (it can decide not to post).
- **Impersonating an agent:** agent-only actions check the caller's identity in the module.
- **Making someone feel bad:** posts celebrate wins only. "Most screen time"-style posts are allowed only as roasts the person opted into, and the module enforces that.
- **Spam:** at most one agent post per friend per day, enforced in the module.
- **Scheduling across time zones:** overlapping free time is computed in code; Claude never does time-zone math.
