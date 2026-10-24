# Orbit web app

React + TypeScript + Vite. Mobile and laptop layouts.

```bash
cd web
npm install
cp .env.example .env   # optional, see below
npm run dev            # http://localhost:5173 (also on your LAN IP for phones)
```

Demo account: `demo` / `demo1234` (Riley: filled-in dashboard, friends, goals).
The demo phones log in as `maya_runs`, `jordanp` or `sam_l`, same password, so
each phone is a different member of the group.

## Pages

| Route | Page |
|---|---|
| `/auth` | Sign up / log in with username + password, or Google |
| `/welcome` | Permissions (calendars, location, photos, Screen Time). Shown once, right after sign-up |
| `/friends` | Requests, search, link contacts (picker / .vcf / paste), per-friend update frequency and what to share |
| `/settings` | Profile friends see, connected data (add calendars), password, log out, delete |
| `/goals` | Daily / weekly / monthly / yearly goals, how the agent tracks each, share toggle, manual logging |
| `/` | Dashboard: study hours this month, goals met per cadence, streaks, history |
| `/group` | The group chat (live): friends' messages, agent highlights, plan votes, check-ins |
| `/share` | Consent per source (share wins / planning only / off), Screen Time and photo uploads, Health Shortcut setup, Canvas |

## Data layer

Two stores:

- **Local** (`src/lib/db.ts`, localStorage): accounts, the friend list, goal
  history. It only changes through `src/lib/api.ts`.
- **Live** (`src/lib/live.ts`, SpacetimeDB, module in `server/`): the group
  chat, agent posts, plans and votes, plus what each person shares (shared goals
  with this period's progress, consent, roast opt-in, profile). Each Orbit
  account gets its own SpacetimeDB identity on first sign-in: seeded people
  claim their group member, new accounts join with the `CATCHUP` invite.
  `api.ts` pushes changes friends should see; the Group page calls reducers
  directly.

`src/module_bindings/` is generated. After changing the module, regenerate it
from the repo root: `spacetime generate --lang typescript --out-dir web/src/module_bindings --module-path server`.

Passwords are hashed client-side for the demo only. Real auth belongs on the server.

## Env

- `VITE_SPACETIMEDB_URI`, `VITE_SPACETIMEDB_DB`: the live group server
  (default: port 3000 on the host that served the page, database `calhacks`).
  For phones on a local server, start it with `spacetime start --listen-addr 0.0.0.0:3000`.
- `VITE_GOOGLE_CLIENT_ID`: enables real Google sign-in and Google Calendar
  (free/busy) consent. Without it, Google buttons run a demo flow.
- `VITE_AGENT_API_URL`: agent service base URL (default: port 8000 on the host
  that served the page). Uploads, the Health Shortcut, Google Calendar tokens
  (`/calendar/google/token`) and Canvas go there with the friend's ingest token.
  Only when it's set explicitly, Outlook / Apple calendar connect redirects to
  `${VITE_AGENT_API_URL}/oauth/<provider>/start?user_id=…&return_to=…` and expects
  a redirect back with `?connected=<provider>&account=<email>`.
