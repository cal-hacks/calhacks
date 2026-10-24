# Orbit web app

React + TypeScript + Vite. Mobile and laptop layouts.

```bash
cd web
npm install
cp .env.example .env   # optional, see below
npm run dev            # http://localhost:5173 (also on your LAN IP for phones)
```

Demo account: `demo` / `demo1234` (filled-in dashboard, friends, goals).

## Pages

| Route | Page |
|---|---|
| `/auth` | Sign up / log in with username + password, or Google |
| `/welcome` | Permissions (calendars, location, photos, Screen Time). Shown once, right after sign-up |
| `/friends` | Requests, search, link contacts (picker / .vcf / paste), per-friend update frequency and what to share |
| `/settings` | Profile friends see, connected data (add calendars), password, log out, delete |
| `/goals` | Daily / weekly / monthly / yearly goals, how the agent tracks each, share toggle, manual logging |
| `/` | Dashboard: study hours this month, goals met per cadence, streaks, history |

## Data layer

All state lives in `src/lib/db.ts` (a localStorage store) and only changes through
`src/lib/api.ts`, whose functions mirror the SpacetimeDB reducers in the plan.
To move to SpacetimeDB, replace `useDB()` with table subscriptions and the
`api.ts` bodies with reducer calls; pages don't need to change.

Passwords are hashed client-side for the demo only. Real auth belongs on the server.

## Env

- `VITE_GOOGLE_CLIENT_ID`: enables real Google sign-in and Google Calendar
  (free/busy) consent. Without it, Google buttons run a demo flow.
- `VITE_AGENT_API_URL`: agent service base URL. Outlook / Apple calendar
  connect redirects to `${VITE_AGENT_API_URL}/oauth/<provider>/start?user_id=…&return_to=…`
  and expects a redirect back with `?connected=<provider>&account=<email>`.
  Google tokens are POSTed to `/calendar/google/token`.
