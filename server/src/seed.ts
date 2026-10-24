// Demo data: three college friends in three time zones. Times are relative
// to when seed_demo runs, so the data always looks like "this week".
//
// UTC offsets are fixed (daylight time, valid until Nov 1, 2026). The agent
// service should use real time-zone math; this is only for seed rows.

import { Timestamp } from 'spacetimedb';
import { createDefaults, type Ctx } from './schema';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const FRIENDS = [
  {
    key: 'maya',
    name: 'Maya Chen',
    city: 'New York',
    timezone: 'America/New_York',
    offset: -4,
    avatar: '🏃‍♀️',
    consent: { health: 'highlights', calendar: 'highlights', canvas: 'planning_only', screen_time: 'off', photos: 'highlights' },
    settings: { roastOk: false, checkOnMe: true, trusted: ['sam'], nudgePreview: true },
  },
  {
    key: 'sam',
    name: 'Sam Okafor',
    city: 'Austin',
    timezone: 'America/Chicago',
    offset: -5,
    avatar: '🦙',
    consent: { health: 'highlights', calendar: 'highlights', canvas: 'off', screen_time: 'highlights', photos: 'highlights' },
    settings: { roastOk: true, checkOnMe: false, trusted: [], nudgePreview: true },
  },
  {
    key: 'jordan',
    name: 'Jordan Rivera',
    city: 'San Francisco',
    timezone: 'America/Los_Angeles',
    offset: -7,
    avatar: '📚',
    consent: { health: 'planning_only', calendar: 'highlights', canvas: 'highlights', screen_time: 'highlights', photos: 'off' },
    settings: { roastOk: false, checkOnMe: false, trusted: [], nudgePreview: true },
  },
] as const;

type Key = (typeof FRIENDS)[number]['key'];

export const DEMO_CODES = {
  group: 'CATCHUP',
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
  const group = ctx.db.friendGroup.insert({ id: 0n, name: 'Class of ’25 🎓' });
  ctx.db.invite.insert({ code: DEMO_CODES.group, kind: 'group', targetId: group.id });

  const ids = {} as Record<Key, bigint>;
  for (const f of FRIENDS) {
    const row = ctx.db.friend.insert({
      id: 0n,
      identity: undefined,
      name: f.name,
      city: f.city,
      timezone: f.timezone,
      avatar: f.avatar,
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

  const offsetOf = (k: Key) => FRIENDS.find(f => f.key === k)!.offset;
  const at = (k: Key, daysFromToday: number, hour: number) =>
    localMidnight(now, offsetOf(k), daysFromToday) + hour * HOUR;
  const addStat = (k: Key, type: string, value: object, ms: number) =>
    ctx.db.stat.insert({
      id: 0n,
      friendId: ids[k],
      type,
      value: JSON.stringify(value),
      recordedAt: ts(ms),
      source: 'seed',
    });

  // --- Last 7 days of stats ---
  const steps: Record<Key, number[]> = {
    maya: [11200, 9800, 14300, 8700, 12100, 15800, 10400],
    sam: [6400, 7100, 5200, 9900, 13400, 8800, 6000],
    jordan: [3900, 4200, 3100, 5600, 2800, 4100, 3500],
  };
  // [bedtime hour (may be past 24), hours slept]
  const sleep: Record<Key, [number, number][]> = {
    maya: [[22.5, 7.5], [23, 7], [22.75, 7.25], [23.25, 7], [22.5, 7.5], [23.5, 8], [22.75, 7.25]],
    sam: [[24.5, 7], [25, 6.5], [24.75, 7.25], [25.5, 6.5], [26, 7.5], [24, 8], [24.25, 7]],
    jordan: [[25.5, 5.5], [26, 5], [25.75, 5.25], [26.5, 5], [25, 6], [24.5, 7], [26, 5]],
  };
  for (const f of FRIENDS) {
    for (let d = -7; d <= -1; d++) {
      const i = d + 7;
      addStat(f.key, 'steps', { count: steps[f.key][i] }, at(f.key, d, 23));
      const [bed, hours] = sleep[f.key][i];
      addStat(f.key, 'sleep', {
        start: new Date(at(f.key, d, bed)).toISOString(),
        end: new Date(at(f.key, d, bed + hours)).toISOString(),
        hours,
      }, at(f.key, d + 1, 9));
    }
  }
  for (const [d, km, min] of [[-6, 5.2, 29], [-4, 6.0, 33], [-2, 8.1, 46]] as const) {
    addStat('maya', 'workout', { kind: 'run', distance_km: km, minutes: min }, at('maya', d, 7));
  }
  addStat('sam', 'workout', { kind: 'climbing', minutes: 90 }, at('sam', -3, 19));
  for (const [k, hours, top] of [
    ['sam', 6.4, ['TikTok', 'Instagram', 'YouTube']],
    ['jordan', 2.1, ['Canvas', 'Slack', 'Safari']],
  ] as const) {
    addStat(k, 'screen_time', { daily_avg_hours: hours, top_apps: top, pickups: k === 'sam' ? 142 : 58 }, at(k, -1, 21));
  }
  addStat('jordan', 'busy_week', { reason: 'deadlines', count: 4, through: localDate(now, -7, 3) }, at('jordan', -1, 12));
  addStat('jordan', 'canvas_deadlines', {
    items: ['Thesis draft', 'Stats problem set', 'Lab report', 'Seminar reading response'],
  }, at('jordan', -1, 12));

  // --- Goals ---
  const goals: [Key, string, number, number][] = [
    ['maya', 'Run 4 times this week', 4, 3],
    ['sam', 'Read 2 books this month', 2, 1],
    ['jordan', 'Finish thesis draft', 1, 0],
  ];
  for (const [k, description, target, progress] of goals) {
    ctx.db.goal.insert({ id: 0n, friendId: ids[k], description, target, progress, status: 'active' });
  }

  // --- Photo ---
  const llama = ctx.db.photo.insert({
    id: 0n,
    friendId: ids.sam,
    placeName: 'Llama farm near Dripping Springs, TX',
    takenAt: ts(at('sam', -2, 14)),
    obscurityScore: 0.92,
    caption: 'Sam made a new friend. He is fluffier than all of us.',
  });
  ctx.db.photoLocation.insert({ photoId: llama.id, lat: 30.19, lng: -98.09 });

  // --- Check-ins ---
  ctx.db.checkin.insert({ id: 0n, friendId: ids.maya, text: 'longest run since college 🏃‍♀️', createdAt: ts(at('maya', -2, 8)), source: 'app' });
  ctx.db.checkin.insert({ id: 0n, friendId: ids.jordan, text: 'surviving thesis week ☕', createdAt: ts(at('jordan', -1, 22)), source: 'app' });

  // --- Group chat history ---
  const post = (
    k: Key | null,
    kind: string,
    text: string,
    createdBy: 'agent' | 'friend',
    ms: number,
    replyToId = 0n,
    daysFromToday?: number
  ) =>
    ctx.db.feedItem.insert({
      id: 0n,
      groupId: group.id,
      friendId: k ? ids[k] : 0n,
      kind,
      text,
      createdBy,
      replyToId,
      createdAt: ts(ms),
      localDate: k && daysFromToday !== undefined ? localDate(now, offsetOf(k), daysFromToday) : '',
    });

  post('jordan', 'message', 'is it just me or has this chat been dead since graduation 💀', 'friend', at('jordan', -5, 21));
  post('maya', 'message', 'it’s not just you lol', 'friend', at('maya', -5, 23));
  const run = post('maya', 'highlight', 'Maya ran 8.1 km this morning, her longest run since college 🏃‍♀️ Anyone want to join her virtual 5K?', 'agent', at('maya', -2, 9), 0n, -2);
  post('sam', 'message', 'MAYA 👏👏', 'friend', at('sam', -2, 9.5), run.id);
  const farm = post('sam', 'obscure_place', 'Weirdest place of the week: Sam at a llama farm outside Austin 🦙', 'agent', at('sam', -2, 16), 0n, -2);
  post('jordan', 'message', 'I need context immediately', 'friend', at('jordan', -2, 15), farm.id);
  post('sam', 'roast', 'Screen Time champion of the week 📱👑 Sam, averaging 6.4 hours. A true dedication to the craft.', 'agent', at('sam', -1, 20), 0n, -1);
  post('sam', 'message', 'I will not be taking questions', 'friend', at('sam', -1, 20.5));

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
  void DAY;
}

const RESETTABLE = [
  'friend',
  'friendGroup',
  'membership',
  'invite',
  'consent',
  'friendSettings',
  'nudge',
  'stat',
  'photoLocation',
  'freeBlock',
  'photo',
  'goal',
  'checkin',
  'feedItem',
  'reaction',
  'plan',
  'planOption',
  'planVote',
] as const;

export function resetAll(ctx: Ctx) {
  for (const name of RESETTABLE) {
    // The union of table types is too wide to call delete() on directly.
    const table = ctx.db[name] as { iter(): Iterable<unknown>; delete(row: unknown): boolean };
    for (const row of [...table.iter()]) table.delete(row);
  }
}
