// Tables for the shared world state. Anything personal (raw stats, GPS,
// consent, nudges, free time) is private: only the database
// owner (the agent service) can read it. Browsers read their own private rows
// through the per-caller views in index.ts.
//
// Enum-like columns are plain strings, validated in reducers, so the Python
// agent service can pass them over the HTTP API without SATS enum encoding.
// A friendId of 0 means "no friend" (ids start at 1).

import { schema, table, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

const id = () => t.u64().primaryKey().autoInc();

// --- People and groups (public) ---

export const friend = table(
  { public: true },
  {
    id: id(),
    // Bound when a browser joins or claims this friend; unset for seeded
    // friends nobody has claimed yet. Uniqueness is enforced in reducers
    // (option columns can't carry a unique constraint).
    identity: t.option(t.identity()),
    name: t.string(),
    city: t.string(),
    timezone: t.string(), // IANA, e.g. "America/New_York"
    avatar: t.string(),
  }
);

// Not `group`: GROUP is a reserved SQL word.
export const friendGroup = table(
  { public: true },
  {
    id: id(),
    name: t.string(),
  }
);

export const membership = table(
  { public: true },
  {
    id: id(),
    groupId: t.u64().index('btree'),
    friendId: t.u64().index('btree'),
  }
);

// --- Private per-friend data ---

// Invite codes: kind "group" joins as a new friend, kind "friend" claims an
// existing (seeded) friend row.
export const invite = table(
  {},
  {
    code: t.string().primaryKey(),
    kind: t.string(),
    targetId: t.u64(),
  }
);

// One row per friend per source.
export const consent = table(
  {},
  {
    id: id(),
    friendId: t.u64().index('btree'),
    source: t.string(), // calendar | canvas | health | screen_time | photos
    shareLevel: t.string(), // highlights | planning_only | off
  }
);

// One row per friend.
export const friendSettings = table(
  {},
  {
    friendId: t.u64().primaryKey(),
    roastOk: t.bool(),
    checkOnMe: t.bool(),
    trustedFriendIds: t.array(t.u64()),
    nudgePreview: t.bool(),
  }
);

export const nudge = table(
  {},
  {
    id: id(),
    aboutFriendId: t.u64().index('btree'),
    toFriendId: t.u64(),
    text: t.string(),
    status: t.string(), // pending_preview | delivered | vetoed
    createdAt: t.timestamp(),
  }
);

export const stat = table(
  {},
  {
    id: id(),
    friendId: t.u64().index('btree'),
    type: t.string(), // steps | sleep | workout | screen_time | busy_week | ...
    value: t.string(), // JSON
    recordedAt: t.timestamp(),
    source: t.string(), // shortcut | upload | calendar | canvas | manual | seed
  }
);

export const photoLocation = table(
  {},
  {
    photoId: t.u64().primaryKey(),
    lat: t.f64(),
    lng: t.f64(),
  }
);

export const freeBlock = table(
  {},
  {
    id: id(),
    friendId: t.u64().index('btree'),
    start: t.timestamp(),
    end: t.timestamp(),
  }
);

// The agent service's identity. It must also be the database owner so it can
// read private tables over HTTP SQL.
export const agentIdentity = table(
  {},
  {
    identity: t.identity().primaryKey(),
  }
);

// --- Shared content (public) ---

export const photo = table(
  { public: true },
  {
    id: id(),
    friendId: t.u64().index('btree'),
    placeName: t.string(),
    takenAt: t.timestamp(),
    obscurityScore: t.f64(), // 0..1
    caption: t.string(),
  }
);

export const goal = table(
  { public: true },
  {
    id: id(),
    friendId: t.u64().index('btree'),
    description: t.string(),
    target: t.f64(),
    progress: t.f64(),
    status: t.string(), // active | done
  }
);

export const checkin = table(
  { public: true },
  {
    id: id(),
    friendId: t.u64().index('btree'),
    text: t.string(),
    createdAt: t.timestamp(),
    source: t.string(), // app | asi_one
  }
);

// The group chat: friends' messages and agent posts in one stream.
export const feedItem = table(
  { public: true },
  {
    id: id(),
    groupId: t.u64().index('btree'),
    friendId: t.u64().index('btree'), // author for messages, subject for agent posts; 0 for group-level
    kind: t.string(), // message | highlight | goal_hit | obscure_place | roast | plan_proposal
    text: t.string(),
    createdBy: t.string(), // agent | friend
    replyToId: t.u64(), // feed item this answers; 0 if none
    createdAt: t.timestamp(),
    localDate: t.string(), // YYYY-MM-DD in the friend's time zone; '' if not limited
  }
);

export const reaction = table(
  { public: true },
  {
    id: id(),
    feedItemId: t.u64().index('btree'),
    friendId: t.u64(),
    emoji: t.string(),
  }
);

export const plan = table(
  { public: true },
  {
    id: id(),
    groupId: t.u64().index('btree'),
    title: t.string(),
    status: t.string(), // open | confirmed | cancelled
    confirmedOptionId: t.u64(), // 0 until confirmed
    createdAt: t.timestamp(),
  }
);

export const planOption = table(
  { public: true },
  {
    id: id(),
    planId: t.u64().index('btree'),
    label: t.string(),
    detail: t.string(),
    startsAt: t.option(t.timestamp()),
  }
);

export const planVote = table(
  { public: true },
  {
    id: id(),
    planId: t.u64().index('btree'),
    friendId: t.u64(),
    optionId: t.u64(),
  }
);

const spacetimedb = schema({
  friend,
  friendGroup,
  membership,
  invite,
  consent,
  friendSettings,
  nudge,
  stat,
  photoLocation,
  freeBlock,
  agentIdentity,
  photo,
  goal,
  checkin,
  feedItem,
  reaction,
  plan,
  planOption,
  planVote,
});

export default spacetimedb;

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

export const CONSENT_SOURCES = [
  'calendar',
  'canvas',
  'health',
  'screen_time',
  'photos',
] as const;

// Everything is opt-in: new friends start with every source off.
export function createDefaults(ctx: Ctx, friendId: bigint) {
  for (const source of CONSENT_SOURCES) {
    ctx.db.consent.insert({ id: 0n, friendId, source, shareLevel: 'off' });
  }
  ctx.db.friendSettings.insert({
    friendId,
    roastOk: false,
    checkOnMe: false,
    trustedFriendIds: [],
    nudgePreview: true,
  });
}
