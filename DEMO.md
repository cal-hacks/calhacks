# Waggle demo script (Cal Hacks · social connection track)

**The pitch in one line:** after graduation, friend group chats die. Waggle gives each friend an agent that notices wins worth sharing and coordinates plans, and it only ever shares what you allow.

Everything in the demo happens live. The seed only sets the scene: a group chat that died after graduation.

## Setup (5 minutes before)

| Screen | What | Signed in as |
|---|---|---|
| Laptop, left half | Waggle web app, **Chats** tab, Class of ’25 open | `demo` (Riley, San Francisco) |
| Laptop, right half | **Agent Network**: `<web app URL>/agents` (no login) | nobody |
| Phone | Waggle app, **Goals** tab | `maya_runs` (Maya, Austin) |

The demo password for both logins is in `web/src/lib/seed.ts` (`DEMO_PASSWORD`).

1. **Reset the demo database:**
   ```bash
   cd agent && SPACETIMEDB_URI=https://maincloud.spacetimedb.com SPACETIMEDB_DB_NAME=waggle-calhacks13 \
     SPACETIMEDB_TOKEN="$(~/.local/bin/spacetime login show --token | grep -oE 'eyJ[A-Za-z0-9._-]+' | head -1)" \
     uv run python -m agent_service.demo
   ```
   This wipes every account. Add `--plan` to also post a ready-made plan, as a backup if the network is slow.
2. **Restart the agents on Render** (Manual Deploy → Restart), or wait about 5 seconds for them to notice the reset.
3. **On the phone:** Profile → Reset demo data, then log in as `maya_runs`. Her "Run 4 times this week" goal should read 3/4.
4. **On the laptop:** log in as `demo` and open the Class of ’25 chat. Open `/agents` in the other half of the screen. It should say LIVE.

## The cast

| Person | City | Notes |
|---|---|---|
| Riley | San Francisco | Us, on the laptop |
| Maya | Austin | Us, on the phone; one run from her goal |
| Priya | Berkeley | 9 miles from Riley, so in-person plans |
| Sam | Seattle | Llama farm; opted into roasts |
| Jordan | New York | Heavy Canvas week until Wednesday |
| Alex | Boston | Has asked to be Riley's friend |

Priya, Sam, Jordan and Alex aren't signed in anywhere, so the agent service plays them. They react, reply in character and vote. The database only lets the agent speak for these unclaimed cast members, never for anyone who signed in.

## The demo (about 3 minutes)

### 1. The problem (15 s)
Point at the Class of ’25 chat: *"is it just me or has this chat been dead since graduation 💀"*. Everyone moved to a different city.

### 2. A goal reached, and the agents pass it on (40 s)
- **On the phone:** log Maya's 4th run. Confetti plays.
- **Network screen:** Maya's node lights up. *"Maya reached their goal"* → *"Maya's agent is writing a post"* → the post fans out in pink to her 5 chats.
- **Laptop:** confetti on Riley's screen too. Within seconds the chat comes alive: 🎉 and 👏 reactions, then Jordan and Priya reply in character.
- **Say:** *"Nobody had to remember to text. Maya's agent noticed a win she marked shareable, and wrote the post for her."*

### 3. "Let's catch up": watch the agents negotiate (60 s)
- **On the laptop:** type **"we should all catch up this weekend!"** in the Class of ’25.
- **On the network screen,** step by step:
  1. The coordinator asks each person's agent for their week (blue).
  2. Each agent replies in green with what it's sharing, and a 🔒 box with what it **kept private**: *"Jordan's agent: 4 free times… 🔒 kept private: event titles, 4 Canvas deadline titles"*.
  3. *"Found 3 times everyone's free"* → *"Priya and Riley live 9.3 mi apart → an in-person idea"*.
  4. *"Asking Claude for ideas, with web search"*, followed by the real searches it ran.
- **Laptop,** about 25 s later: a plan with three options. For example: pizza at Cheese Board in Berkeley for Riley and Priya, a party-game night, and a watch party of something new. Every option comes from the chat itself (someone asked for a watch party), from where people live, and from the date.
- **Say:** *"The agents never handed over a calendar, only free/busy. Jordan's deadlines shaped the plan without anyone seeing them."*

### 4. Votes, then locked in (30 s)
- Priya and Jordan vote, one at a time. The cast deliberately leaves the deciding vote to a real person.
- **Laptop:** tap the same option. The coordinator posts *"🎉 It's a plan! …"* and the cast cheers.

### 5. Your turn, judges (open-ended)
- **Sign up** on your phone at the web app URL. The guided setup asks for Google Calendar, photos and Canvas, each with the real prompt.
- **Friends:** search for **Sam**, **Priya** or **Jordan** and add them. They accept right away and say hi.
- **Message them:** they reply in character. Ask Sam about Gerald.
- **Make a group** with a few of them and say *"let's hang out"*. You get the whole flow: the agents negotiate on the network screen, a plan arrives, and they vote.

## Talking points
- **Privacy is enforced agent to agent.** Each source can be set to *Share wins*, *Planning only* or *Off*. "Planning only" data shapes plans and never shows up in chat. The network screen shows exactly what stayed private.
- **Social, not surveillance.** Agents celebrate wins, never compare people. Roasts are opt-in (the **Roast me** switch on the Share tab).
- **Friends only.** You can only message or group people you're friends with. Chats are private to their members.
- **Built on SpacetimeDB** (live sync), **Fetch.ai uAgents** (one agent per friend plus a coordinator, also reachable on ASI:One) and **Claude** (ideas with web search, posts, voices).

## If something goes wrong
- **No plan after 40 s:** the search has a 30 s limit, after which it falls back to simpler ideas. If nothing shows at all, check that the agents are running (Render logs). The backup: reset with `--plan` beforehand.
- **"There's already a plan open here":** each chat holds one open plan. Vote it through, or use the Riley–Priya 1:1, which is set up for an in-person plan.
- **No reactions or replies:** only unclaimed cast members react. If someone signed in as Priya or Sam, reset the demo.
- **The network screen is empty:** it only animates new activity, so reload it before starting.
