// Demo data for the social connection story: the Class of '25 group chat that
// died after graduation, brought back live by everyone's agents. The seed only
// sets the scene (a few messages, what agents know, free time, goals); posts,
// replies, plans and votes happen during the demo. Times are relative to when
// seed_demo runs, so the data always looks like "this week".
//
// The cast:
// - Riley (the demo login, San Francisco) and Priya (Berkeley) live ~10 miles
//   apart, so plans suggest meeting in person.
// - Maya (Austin) is one run from her weekly goal: a phone signed in as Maya
//   logs it live for confetti and a goal-win post.
// - Sam (Seattle) found a llama farm and opted into roasts.
// - Jordan (New York) has a heavy Canvas week, so plans land after it.
// - Alex (Boston) isn't connected yet and has asked to be Riley's friend.
// Nobody claims Sam, Jordan, Priya or Alex, so they accept friend requests at
// once and say hi (cast.ts); the agent service's cast director gives them a
// voice in chats, which is what a judge who signs up experiences.
//
// UTC offsets are fixed (daylight time, valid until Nov 1, 2026). The agent
// service uses real time-zone math; this is only for seed rows.

import { Timestamp } from 'spacetimedb';
import { befriend } from './friends';
import { createDefaults, type Ctx } from './schema';

const HOUR = 3600 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Same people as the apps' local seed (web/src/lib/seed.ts,
// mobile/src/lib/seed.ts). Riley is the demo login; Maya is the demo phone.
const FRIENDS = [
  {
    key: 'riley',
    username: 'demo',
    name: 'Riley Demo',
    city: 'San Francisco, CA',
    timezone: 'America/Los_Angeles',
    offset: -7,
    avatar: '📚',
    consent: { health: 'off', calendar: 'highlights', canvas: 'planning_only', screen_time: 'highlights', photos: 'highlights' },
    settings: { roastOk: false, checkOnMe: false, trusted: [], nudgePreview: true },
  },
  {
    key: 'priya',
    username: 'priya.k',
    name: 'Priya Kumar',
    city: 'Berkeley, CA',
    timezone: 'America/Los_Angeles',
    offset: -7,
    avatar: '🩺',
    consent: { health: 'off', calendar: 'highlights', canvas: 'off', screen_time: 'off', photos: 'highlights' },
    settings: { roastOk: false, checkOnMe: false, trusted: [], nudgePreview: true },
  },
  {
    key: 'maya',
    username: 'maya_runs',
    name: 'Maya Chen',
    city: 'Austin, TX',
    timezone: 'America/Chicago',
    offset: -5,
    avatar: '🏃‍♀️',
    consent: { health: 'off', calendar: 'highlights', canvas: 'planning_only', screen_time: 'off', photos: 'highlights' },
    settings: { roastOk: false, checkOnMe: true, trusted: ['sam'], nudgePreview: true },
  },
  {
    key: 'sam',
    username: 'sam_l',
    name: 'Sam Lee',
    city: 'Seattle, WA',
    timezone: 'America/Los_Angeles',
    offset: -7,
    avatar: '🦙',
    consent: { health: 'off', calendar: 'highlights', canvas: 'off', screen_time: 'highlights', photos: 'highlights' },
    settings: { roastOk: true, checkOnMe: false, trusted: [], nudgePreview: true },
  },
  {
    key: 'jordan',
    username: 'jordanp',
    name: 'Jordan Park',
    city: 'New York, NY',
    timezone: 'America/New_York',
    offset: -4,
    avatar: '⚖️',
    consent: { health: 'off', calendar: 'highlights', canvas: 'highlights', screen_time: 'highlights', photos: 'off' },
    settings: { roastOk: false, checkOnMe: false, trusted: [], nudgePreview: true },
  },
] as const;

type Key = (typeof FRIENDS)[number]['key'];

// On the platform but not in the group yet: Alex has asked to be Riley's friend.
const ALEX = { username: 'alexr', name: 'Alex Rivera', city: 'Boston, MA', timezone: 'America/New_York', avatar: '🧗' };

export const DEMO_CODES = {
  riley: 'RILEY-1',
  priya: 'PRIYA-1',
  maya: 'MAYA-1',
  sam: 'SAM-1',
  jordan: 'JORDAN-1',
} as const;

function ts(ms: number): Timestamp {
  return Timestamp.fromDate(new Date(ms));
}

// Midnight local time `daysFromToday` days away, as UTC ms.
function localMidnight(nowMs: number, offset: number, daysFromToday: number): number {
  const local = new Date(nowMs + offset * HOUR);
  const midnightLocalAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + daysFromToday
  );
  return midnightLocalAsUtc - offset * HOUR;
}

function localDate(nowMs: number, offset: number, daysFromToday: number): string {
  return new Date(localMidnight(nowMs, offset, daysFromToday) + offset * HOUR)
    .toISOString()
    .slice(0, 10);
}

export function seedDemo(ctx: Ctx) {
  const now = ctx.timestamp.toDate().getTime();
  const group = ctx.db.friendGroup.insert({ id: 0n, name: 'Class of ’25 🎓', isDirect: false });

  const ids = {} as Record<Key, bigint>;
  for (const f of FRIENDS) {
    const row = ctx.db.friend.insert({
      id: 0n,
      identity: undefined,
      name: f.name,
      city: f.city,
      timezone: f.timezone,
      avatar: f.avatar,
      username: f.username,
    });
    ids[f.key] = row.id;
    ctx.db.membership.insert({ id: 0n, groupId: group.id, friendId: row.id });
    ctx.db.invite.insert({ code: DEMO_CODES[f.key], kind: 'friend', targetId: row.id });
    createDefaults(ctx, row.id);
    for (const c of [...ctx.db.consent.friendId.filter(row.id)]) {
      ctx.db.consent.id.update({ ...c, shareLevel: f.consent[c.source as keyof typeof f.consent] });
    }
  }
  for (const f of FRIENDS) {
    ctx.db.friendSettings.friendId.update({
      friendId: ids[f.key],
      roastOk: f.settings.roastOk,
      checkOnMe: f.settings.checkOnMe,
      trustedFriendIds: f.settings.trusted.map(k => ids[k as Key]),
      nudgePreview: f.settings.nudgePreview,
    });
  }
  // The group are all friends with each other, each pair with a 1:1 chat.
  FRIENDS.forEach((a, i) => FRIENDS.slice(i + 1).forEach(b => befriend(ctx, ids[a.key], ids[b.key])));
  const alex = ctx.db.friend.insert({ id: 0n, identity: undefined, ...ALEX });
  createDefaults(ctx, alex.id);

  const offsetOf = (k: Key) => FRIENDS.find(f => f.key === k)!.offset;
  const at = (k: Key, daysFromToday: number, hour: number) =>
    localMidnight(now, offsetOf(k), daysFromToday) + hour * HOUR;
  const addStat = (k: Key, type: string, value: object, ms: number) =>
    ctx.db.stat.insert({ id: 0n, friendId: ids[k], type, value: JSON.stringify(value), recordedAt: ts(ms), source: 'seed' });

  // Alex asked Riley yesterday: accept it on stage.
  ctx.db.friendship.insert({ id: 0n, fromId: alex.id, toId: ids.riley, status: 'pending', createdAt: ts(at('riley', -1, 18)) });

  // --- What agents know (no Health: it's out for now) ---
  for (const [k, hours, top, pickups] of [
    ['sam', 6.4, ['TikTok', 'Instagram', 'YouTube'], 142],
    ['jordan', 2.1, ['Canvas', 'Slack', 'Safari'], 58],
  ] as const) {
    addStat(k, 'screen_time', { daily_avg_hours: hours, top_apps: top, pickups }, at(k, -1, 21));
  }
  addStat('jordan', 'busy_week', { reason: 'deadlines', count: 4, through: localDate(now, -4, 2) }, at('jordan', -1, 12));
  addStat('jordan', 'canvas_deadlines', {
    items: ['Moot court brief', 'Contracts memo', 'Evidence reading', 'Clinic intake notes'],
  }, at('jordan', -1, 12));

  // --- Goals (Maya's matches the demo phone's local goal: one run to go) ---
  const goals: [Key, string, number, number][] = [
    ['maya', 'Run 4 times this week', 4, 3],
    ['sam', 'Read 2 books this month', 2, 1],
    ['jordan', 'Finish moot court brief', 1, 0],
  ];
  for (const [k, description, target, progress] of goals) {
    ctx.db.goal.insert({ id: 0n, friendId: ids[k], description, target, progress, status: 'active' });
  }

  // --- Photo ---
  const llama = ctx.db.photo.insert({
    id: 0n,
    friendId: ids.sam,
    placeName: 'Llama farm near Snohomish, WA',
    takenAt: ts(at('sam', -3, 14)),
    obscurityScore: 0.92,
    caption: 'Sam made a new friend. He is fluffier than all of us.',
  });
  ctx.db.photoLocation.insert({ photoId: llama.id, lat: 47.91, lng: -122.09 });

  // --- Chats: just enough to set the scene; everything else happens live ---
  const chatWith = (a: Key, b: Key) => {
    for (const m of ctx.db.membership.friendId.filter(ids[a])) {
      const g = ctx.db.friendGroup.id.find(m.groupId);
      if (g?.isDirect && [...ctx.db.membership.groupId.filter(g.id)].some(x => x.friendId === ids[b])) return g.id;
    }
    throw new Error(`no 1:1 for ${a} and ${b}`);
  };
  const say = (chat: bigint, k: Key, text: string, ms: number) =>
    ctx.db.feedItem.insert({
      id: 0n,
      groupId: chat,
      friendId: ids[k],
      kind: 'message',
      text,
      createdBy: 'friend',
      replyToId: 0n,
      createdAt: ts(ms),
      localDate: '',
    });

  // The group chat died after graduation...
  say(group.id, 'jordan', 'is it just me or has this chat been dead since graduation 💀', at('jordan', -10, 21));
  say(group.id, 'maya', 'it’s not just you lol', at('maya', -10, 22));
  say(group.id, 'priya', 'update: I moved to Berkeley for my PhD 🐻 Riley we’re like 20 min apart now', at('priya', -2, 12));
  // ...and Priya and Riley keep meaning to hang out.
  const rp = chatWith('riley', 'priya');
  say(rp, 'priya', 'you’re in SF right?? we NEED to hang now that I’m close', at('priya', -2, 13));
  say(rp, 'riley', 'yes!! I’ll find us something fun', at('riley', -2, 13.5));

  // --- Free time for the next 7 days (Calendar free/busy) ---
  for (const f of FRIENDS) {
    for (let d = 0; d <= 6; d++) {
      const weekday = new Date(localMidnight(now, f.offset, d) + f.offset * HOUR).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      // Jordan has deadlines for the next three days.
      if (f.key === 'jordan' && d <= 2) continue;
      const [startH, endH] = weekend ? [10, 22] : [18, 22];
      const start = at(f.key, d, startH);
      if (start + HOUR < now) continue;
      ctx.db.freeBlock.insert({
        id: 0n,
        friendId: ids[f.key],
        start: ts(Math.max(start, now)),
        end: ts(at(f.key, d, endH)),
      });
    }
  }
}

const RESETTABLE = [
  'friend',
  'friendship',
  'friendGroup',
  'membership',
  'invite',
  'consent',
  'friendSettings',
  'nudge',
  'stat',
  'photoLocation',
  'freeBlock',
  'ingestToken',
  'photo',
  'goal',
  'checkin',
  'feedItem',
  'reaction',
  'plan',
  'planOption',
  'planVote',
  'agentEvent',
  'secret',
] as const;

export function resetAll(ctx: Ctx) {
  for (const name of RESETTABLE) {
    // The union of table types is too wide to call delete() on directly.
    const table = ctx.db[name] as { iter(): Iterable<unknown>; delete(row: unknown): boolean };
    for (const row of [...table.iter()]) table.delete(row);
  }
}
