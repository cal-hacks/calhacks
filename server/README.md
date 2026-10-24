# SpacetimeDB module

The shared world state for friends and agents: tables, reducers and per-caller views. TypeScript, SpacetimeDB 2.13.

```bash
npm install
npm run typecheck
npm test          # runs every reducer in SpacetimeDB's in-memory test harness
```

## Publish and seed

```bash
spacetime start                                        # local server, in its own terminal
spacetime login --server-issued-login local            # once: a local-only identity
spacetime publish -s local -p server calhacks          # from the repo root
spacetime call -s local calhacks seed_demo
spacetime sql -s local calhacks "SELECT * FROM feed_item"
```

The publisher becomes the agent: `init` stores the publishing identity in `agent_identity` (confirmed on a local server). `claim_agent` is only a fallback for when that table is empty. The agent service must use **the same token** as the CLI. That identity is the database owner, the only one that can read private tables over HTTP SQL. Get it with `spacetime login show --token`, put it in `.env`, and never commit it.

To start over, run `spacetime call -s local calhacks reset_demo` and then `seed_demo` again. Running `publish` again keeps data. Add `-c` to wipe it, and since `init` then runs again, the publisher becomes the agent again.

## Demo codes (from `seed_demo`)

| Code | Effect |
|---|---|
| `CATCHUP` | `join_group`: join as a new friend (every source starts **off**) |
| `MAYA-1`, `SAM-1`, `JORDAN-1` | `claim_friend`: sign this browser in as that seeded friend |

Seeded friends: Maya (New York, runner, check-on-me on with Sam as trusted friend), Sam (Austin, roasts allowed, llama farm photo), Jordan (San Francisco, health `planning_only`, busy deadline week). The seed includes a week of stats, goals, chat history and free blocks for the next 7 days, all relative to when you run it.

## Conventions

- Reducer, table and column names are snake_case on the wire: the TS export `postFeedItem` is the reducer `post_feed_item`, and `feedItem` is the table `feed_item` with columns like `friend_id`.
- **Reducer argument names stay camelCase** (`{"groupId": 1, "replyToId": 0}`). The reducer table below lists them in snake_case for readability, but send them in camelCase.
- Enum-like fields are strings, validated in reducers.
- Times passed to reducers are ISO strings. JSON payloads (`value`, `blocks`, `options`) are JSON strings.
- `friendId = 0` means "none" or "myself": browsers pass 0 to act as themselves, and the agent always passes a real id.

## Tables

**Public** (any client can subscribe): `friend`, `friend_group`, `membership`, `photo`, `goal`, `checkin`, `feed_item` (the group chat), `reaction`, `plan`, `plan_option`, `plan_vote`.

**Private** (owner/agent only): `invite`, `consent`, `friend_settings`, `nudge`, `stat`, `photo_location`, `free_block`, `ingest_token`, `agent_identity`.

**Views** (each browser sees only its own rows): `my_friend`, `my_consent`, `my_settings`, `my_nudge_previews` (nudges about me, waiting for my approval), `my_nudge_inbox` (nudges for me).

## Reducers

| Reducer | Who | Notes |
|---|---|---|
| `join_group(invite_code, name, city, timezone, avatar)` | friend | creates the friend, all consent off |
| `claim_friend(claim_code)` | friend | binds a seeded friend to this browser |
| `update_profile(name, city, timezone, avatar)` | friend | |
| `set_ingest_token(token_hash)`, `clear_ingest_token()` | friend | SHA-256 hex of a token the browser makes with Web Crypto; the Shortcut and uploads send the token to the agent service |
| `set_consent(source, share_level)` | friend | source: calendar, canvas, health, screen_time, photos; level: highlights, planning_only, off |
| `set_friend_settings(roast_ok, check_on_me, trusted_friend_ids, nudge_preview)` | friend | at most 2 trusted friends, from your groups |
| `send_message(group_id, text, reply_to_id)` | friend | chat message |
| `toggle_reaction(feed_item_id, emoji)` | friend | |
| `add_checkin(friend_id, text)` | friend or agent | |
| `set_goal(description, target)`, `delete_goal(goal_id)` | friend | |
| `update_goal_progress(goal_id, progress)` | owner or agent | becomes `done` at the target |
| `vote_plan(plan_id, option_id, friend_id)` | friend or agent | changing a vote replaces it; a strict majority confirms |
| `review_nudge(nudge_id, approve)` | the friend it's about | `pending_preview` → `delivered` / `vetoed` |
| `add_stat(friend_id, type, value, recorded_at, source)` | agent | rejected if the stat's source consent is `off` |
| `add_photo(friend_id, place_name, taken_at, obscurity_score, caption, lat, lng)` | agent | needs photos = `highlights`; GPS goes to the private table |
| `set_free_blocks(friend_id, blocks)` | agent | replaces that friend's blocks; needs calendar on |
| `post_feed_item(group_id, friend_id, kind, text, reply_to_id, local_date)` | agent | one highlight-type post per friend per `local_date`; `roast` needs `roast_ok` |
| `post_nudge(about_friend_id, to_friend_id, text)` | agent | needs check-on-me, a trusted recipient, and no digits in the text |
| `propose_plan(group_id, title, options)` | agent | 1–3 options; also posts a `plan_proposal` to the chat |
| `confirm_plan`, `cancel_plan` | agent | |
| `claim_agent`, `seed_demo`, `reset_demo` | agent / setup | |

## Calling from Python (HTTP API)

Tested against a local 2.13 server.

```
POST {SPACETIMEDB_URI}/v1/database/{name}/call/{reducer}   body: JSON object (camelCase args) or positional array
POST {SPACETIMEDB_URI}/v1/database/{name}/sql               body: SQL text
header on both: Authorization: Bearer {token}
```

- A reducer call returns 200 with an empty body on success. A rule violation returns **530** with the error message as plain text (e.g. `already posted about this friend today`). Bad argument names or types return 400.
- SQL returns `[{"schema": {...}, "rows": [[...], ...]}]`. Rows are positional, in the order of the selected columns. A non-owner querying a private table gets 400 `no such table`.
- Views can be queried like tables (`SELECT * FROM my_consent`) and return the caller's own rows.
- `POST /v1/identity` mints a new identity and token, which is handy for testing as a "browser".

```python
import httpx
r = httpx.post(f"{URI}/v1/database/{DB}/call/post_feed_item",
               headers={"Authorization": f"Bearer {TOKEN}"},
               json={"groupId": 1, "friendId": 2, "kind": "highlight",
                     "text": "Sam climbed for 90 minutes 🧗", "replyToId": 0,
                     "localDate": "2026-10-24"})
if r.status_code == 530:
    ...  # rule said no (daily limit, consent, roast_ok): skip, don't retry
```
