// Reducers and views. Callers are either the agent service (one identity,
// stored in agent_identity) or a friend's browser (an identity bound to a
// friend row). Every reducer checks which one it's talking to.
//
// Reducers that act "for a friend" take a friendId: the agent must pass one,
// a browser passes 0 and acts as itself.

import { SenderError, t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import spacetimedb, {
  CONSENT_SOURCES,
  consent,
  createDefaults,
  friend,
  friendSettings,
  nudge,
  type Ctx,
} from './schema';
import { resetAll, seedDemo as runSeed } from './seed';

export default spacetimedb;
const SHARE_LEVELS = ['highlights', 'planning_only', 'off'];
const STAT_SOURCES = ['shortcut', 'upload', 'calendar', 'canvas', 'manual', 'seed'];
const FEED_KINDS = [
  'message',
  'highlight',
  'goal_hit',
  'obscure_place',
  'roast',
  'plan_proposal',
];
// Agent posts about a friend that count toward the one-per-day limit.
const DAILY_LIMITED_KINDS = ['highlight', 'goal_hit', 'obscure_place', 'roast'];
const MAX_TRUSTED_FRIENDS = 2;
const MAX_TEXT = 500;

// Which consent source governs each stat type. Unknown types need health.
const STAT_TYPE_SOURCE: Record<string, (typeof CONSENT_SOURCES)[number]> = {
  steps: 'health',
  sleep: 'health',
  workout: 'health',
  screen_time: 'screen_time',
  busy_week: 'calendar',
  canvas_deadlines: 'canvas',
};

// --- Helpers ---

function fail(message: string): never {
  throw new SenderError(message);
}

function oneOf(value: string, allowed: readonly string[], field: string) {
  if (!allowed.includes(value)) {
    fail(`${field} must be one of: ${allowed.join(', ')}`);
  }
}

function cleanText(text: string, field = 'text'): string {
  const trimmed = text.trim();
  if (!trimmed) fail(`${field} is empty`);
  if (trimmed.length > MAX_TEXT) fail(`${field} is over ${MAX_TEXT} characters`);
  return trimmed;
}

function parseIso(value: string, field: string): Timestamp {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${field} is not an ISO date-time`);
  return Timestamp.fromDate(date);
}

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    fail(`${field} is not valid JSON`);
  }
}

function isAgent(ctx: Ctx): boolean {
  return ctx.db.agentIdentity.identity.find(ctx.sender) != null;
}

function requireAgent(ctx: Ctx) {
  if (!isAgent(ctx)) fail('only the agent service can do this');
}

function friendForIdentity(ctx: Ctx) {
  for (const row of ctx.db.friend.iter()) {
    if (row.identity && row.identity.isEqual(ctx.sender)) return row;
  }
  return undefined;
}

function requireFriendRow(ctx: Ctx, friendId: bigint) {
  const row = ctx.db.friend.id.find(friendId);
  if (!row) fail(`no friend with id ${friendId}`);
  return row;
}

// The agent acts for `friendId`; a browser acts as itself.
function actingFriend(ctx: Ctx, friendId: bigint) {
  if (isAgent(ctx)) {
    if (friendId === 0n) fail('the agent must pass a friendId');
    return requireFriendRow(ctx, friendId);
  }
  const self = friendForIdentity(ctx);
  if (!self) fail('join the group first');
  if (friendId !== 0n && friendId !== self.id) {
    fail('you can only change your own data');
  }
  return self;
}

// Friend-only: the caller's own friend row.
function callerFriend(ctx: Ctx) {
  if (isAgent(ctx)) fail('this is for friends, not the agent');
  const self = friendForIdentity(ctx);
  if (!self) fail('join the group first');
  return self;
}

function isMember(ctx: Ctx, groupId: bigint, friendId: bigint): boolean {
  for (const m of ctx.db.membership.friendId.filter(friendId)) {
    if (m.groupId === groupId) return true;
  }
  return false;
}

function groupMemberIds(ctx: Ctx, groupId: bigint): bigint[] {
  return [...ctx.db.membership.groupId.filter(groupId)].map(m => m.friendId);
}

function consentLevel(ctx: Ctx, friendId: bigint, source: string): string {
  for (const row of ctx.db.consent.friendId.filter(friendId)) {
    if (row.source === source) return row.shareLevel;
  }
  return 'off';
}

function settingsFor(ctx: Ctx, friendId: bigint) {
  return (
    ctx.db.friendSettings.friendId.find(friendId) ?? {
      friendId,
      roastOk: false,
      checkOnMe: false,
      trustedFriendIds: [],
      nudgePreview: true,
    }
  );
}

// Local dates span UTC-12..UTC+14, so a valid one is within a day of UTC.
function checkLocalDate(ctx: Ctx, localDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    fail('localDate must be YYYY-MM-DD');
  }
  const now = ctx.timestamp.toDate().getTime();
  const day = Date.parse(`${localDate}T12:00:00Z`);
  if (Number.isNaN(day) || Math.abs(day - now) > 36 * 3600 * 1000) {
    fail('localDate is not today in any time zone');
  }
}

function insertFeedItem(
  ctx: Ctx,
  item: {
    groupId: bigint;
    friendId: bigint;
    kind: string;
    text: string;
    createdBy: string;
    replyToId: bigint;
    localDate: string;
  }
) {
  return ctx.db.feedItem.insert({
    id: 0n,
    createdAt: ctx.timestamp,
    ...item,
  });
}

// --- Lifecycle and admin ---

// The publisher becomes the agent. If the host runs init as the module
// itself, use claim_agent right after publishing instead.
export const init = spacetimedb.init(ctx => {
  if (!ctx.sender.isEqual(ctx.identity)) {
    ctx.db.agentIdentity.insert({ identity: ctx.sender });
  }
});

// Works only while no agent is set.
export const claimAgent = spacetimedb.reducer(ctx => {
  if (ctx.db.agentIdentity.count() > 0n) fail('an agent is already set');
  ctx.db.agentIdentity.insert({ identity: ctx.sender });
});

export const seedDemo = spacetimedb.reducer(ctx => {
  requireAgent(ctx);
  if (ctx.db.friendGroup.count() > 0n) {
    fail('data already exists; call reset_demo first');
  }
  runSeed(ctx);
});

// Clears everything except the agent identity.
export const resetDemo = spacetimedb.reducer(ctx => {
  requireAgent(ctx);
  resetAll(ctx);
});

// --- Joining ---

export const joinGroup = spacetimedb.reducer(
  {
    inviteCode: t.string(),
    name: t.string(),
    city: t.string(),
    timezone: t.string(),
    avatar: t.string(),
  },
  (ctx, { inviteCode, name, city, timezone, avatar }) => {
    if (isAgent(ctx)) fail('the agent cannot join as a friend');
    if (friendForIdentity(ctx)) fail('you already joined');
    const code = ctx.db.invite.code.find(inviteCode.trim());
    if (!code || code.kind !== 'group') fail('unknown invite code');
    const row = ctx.db.friend.insert({
      id: 0n,
      identity: ctx.sender,
      name: cleanText(name, 'name'),
      city: city.trim(),
      timezone: timezone.trim(),
      avatar: avatar.trim(),
    });
    ctx.db.membership.insert({ id: 0n, groupId: code.targetId, friendId: row.id });
    createDefaults(ctx, row.id);
  }
);

// Claim a seeded friend row (demo phones use this).
export const claimFriend = spacetimedb.reducer(
  { claimCode: t.string() },
  (ctx, { claimCode }) => {
    if (isAgent(ctx)) fail('the agent cannot claim a friend');
    if (friendForIdentity(ctx)) fail('you already joined');
    const code = ctx.db.invite.code.find(claimCode.trim());
    if (!code || code.kind !== 'friend') fail('unknown claim code');
    const row = requireFriendRow(ctx, code.targetId);
    if (row.identity) fail('this friend was already claimed');
    ctx.db.friend.id.update({ ...row, identity: ctx.sender });
  }
);

export const updateProfile = spacetimedb.reducer(
  { name: t.string(), city: t.string(), timezone: t.string(), avatar: t.string() },
  (ctx, { name, city, timezone, avatar }) => {
    const self = callerFriend(ctx);
    ctx.db.friend.id.update({
      ...self,
      name: cleanText(name, 'name'),
      city: city.trim(),
      timezone: timezone.trim(),
      avatar: avatar.trim(),
    });
  }
);

// --- Ingest token (friend-only) ---

// Replaces the caller's token. The browser sends the SHA-256 hash and keeps
// the token itself for the Shortcut and uploads.
export const setIngestToken = spacetimedb.reducer(
  { tokenHash: t.string() },
  (ctx, { tokenHash }) => {
    const self = callerFriend(ctx);
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
      fail('tokenHash must be 64 lowercase hex characters (SHA-256)');
    }
    const row = { friendId: self.id, tokenHash, createdAt: ctx.timestamp };
    if (ctx.db.ingestToken.friendId.find(self.id)) {
      ctx.db.ingestToken.friendId.update(row);
    } else {
      ctx.db.ingestToken.insert(row);
    }
  }
);

export const clearIngestToken = spacetimedb.reducer(ctx => {
  const self = callerFriend(ctx);
  const row = ctx.db.ingestToken.friendId.find(self.id);
  if (row) ctx.db.ingestToken.delete(row);
});

// --- Consent (friend-only) ---

export const setConsent = spacetimedb.reducer(
  { source: t.string(), shareLevel: t.string() },
  (ctx, { source, shareLevel }) => {
    const self = callerFriend(ctx);
    oneOf(source, CONSENT_SOURCES, 'source');
    oneOf(shareLevel, SHARE_LEVELS, 'shareLevel');
    for (const row of ctx.db.consent.friendId.filter(self.id)) {
      if (row.source === source) {
        ctx.db.consent.id.update({ ...row, shareLevel });
        return;
      }
    }
    ctx.db.consent.insert({ id: 0n, friendId: self.id, source, shareLevel });
  }
);

export const setFriendSettings = spacetimedb.reducer(
  {
    roastOk: t.bool(),
    checkOnMe: t.bool(),
    trustedFriendIds: t.array(t.u64()),
    nudgePreview: t.bool(),
  },
  (ctx, { roastOk, checkOnMe, trustedFriendIds, nudgePreview }) => {
    const self = callerFriend(ctx);
    const trusted = [...new Set(trustedFriendIds)];
    if (trusted.length > MAX_TRUSTED_FRIENDS) {
      fail(`pick at most ${MAX_TRUSTED_FRIENDS} trusted friends`);
    }
    const myGroups = [...ctx.db.membership.friendId.filter(self.id)].map(m => m.groupId);
    for (const id of trusted) {
      if (id === self.id) fail('you cannot be your own trusted friend');
      if (!myGroups.some(g => isMember(ctx, g, id))) {
        fail(`friend ${id} is not in any of your groups`);
      }
    }
    const row = { friendId: self.id, roastOk, checkOnMe, trustedFriendIds: trusted, nudgePreview };
    if (ctx.db.friendSettings.friendId.find(self.id)) {
      ctx.db.friendSettings.friendId.update(row);
    } else {
      ctx.db.friendSettings.insert(row);
    }
  }
);

// --- Data in (agent-only) ---

export const addStat = spacetimedb.reducer(
  {
    friendId: t.u64(),
    type: t.string(),
    value: t.string(),
    recordedAt: t.string(),
    source: t.string(),
  },
  (ctx, { friendId, type, value, recordedAt, source }) => {
    requireAgent(ctx);
    requireFriendRow(ctx, friendId);
    oneOf(source, STAT_SOURCES, 'source');
    parseJson(value, 'value');
    const consentSource = STAT_TYPE_SOURCE[type] ?? 'health';
    if (consentLevel(ctx, friendId, consentSource) === 'off') {
      fail(`${consentSource} is off for this friend`);
    }
    ctx.db.stat.insert({
      id: 0n,
      friendId,
      type,
      value,
      recordedAt: parseIso(recordedAt, 'recordedAt'),
      source,
    });
  }
);

export const addPhoto = spacetimedb.reducer(
  {
    friendId: t.u64(),
    placeName: t.string(),
    takenAt: t.string(),
    obscurityScore: t.f64(),
    caption: t.string(),
    lat: t.f64(),
    lng: t.f64(),
  },
  (ctx, args) => {
    requireAgent(ctx);
    requireFriendRow(ctx, args.friendId);
    if (consentLevel(ctx, args.friendId, 'photos') !== 'highlights') {
      fail('photo sharing is not on for this friend');
    }
    if (args.obscurityScore < 0 || args.obscurityScore > 1) {
      fail('obscurityScore must be between 0 and 1');
    }
    const row = ctx.db.photo.insert({
      id: 0n,
      friendId: args.friendId,
      placeName: cleanText(args.placeName, 'placeName'),
      takenAt: parseIso(args.takenAt, 'takenAt'),
      obscurityScore: args.obscurityScore,
      caption: args.caption.trim(),
    });
    ctx.db.photoLocation.insert({ photoId: row.id, lat: args.lat, lng: args.lng });
  }
);

// Replaces a friend's free blocks with `blocks`: JSON [{start, end}] (ISO).
export const setFreeBlocks = spacetimedb.reducer(
  { friendId: t.u64(), blocks: t.string() },
  (ctx, { friendId, blocks }) => {
    requireAgent(ctx);
    requireFriendRow(ctx, friendId);
    if (consentLevel(ctx, friendId, 'calendar') === 'off') {
      fail('calendar is off for this friend');
    }
    const parsed = parseJson(blocks, 'blocks');
    if (!Array.isArray(parsed)) fail('blocks must be a JSON array');
    const rows = parsed.map((b, i) => {
      const start = parseIso(String(b?.start), `blocks[${i}].start`);
      const end = parseIso(String(b?.end), `blocks[${i}].end`);
      if (end.microsSinceUnixEpoch <= start.microsSinceUnixEpoch) {
        fail(`blocks[${i}] ends before it starts`);
      }
      return { start, end };
    });
    for (const old of [...ctx.db.freeBlock.friendId.filter(friendId)]) {
      ctx.db.freeBlock.delete(old);
    }
    for (const r of rows) ctx.db.freeBlock.insert({ id: 0n, friendId, ...r });
  }
);

// --- Friend content ---

export const addCheckin = spacetimedb.reducer(
  { friendId: t.u64(), text: t.string() },
  (ctx, { friendId, text }) => {
    const who = actingFriend(ctx, friendId);
    ctx.db.checkin.insert({
      id: 0n,
      friendId: who.id,
      text: cleanText(text),
      createdAt: ctx.timestamp,
      // The agent relays check-ins made in an ASI:One conversation.
      source: isAgent(ctx) ? 'asi_one' : 'app',
    });
  }
);

export const setGoal = spacetimedb.reducer(
  { description: t.string(), target: t.f64() },
  (ctx, { description, target }) => {
    const self = callerFriend(ctx);
    if (!(target > 0)) fail('target must be positive');
    ctx.db.goal.insert({
      id: 0n,
      friendId: self.id,
      description: cleanText(description, 'description'),
      target,
      progress: 0,
      status: 'active',
    });
  }
);

// Owner or agent. Marks the goal done when progress reaches the target.
export const updateGoalProgress = spacetimedb.reducer(
  { goalId: t.u64(), progress: t.f64() },
  (ctx, { goalId, progress }) => {
    const row = ctx.db.goal.id.find(goalId);
    if (!row) fail('no such goal');
    if (!isAgent(ctx) && callerFriend(ctx).id !== row.friendId) {
      fail('you can only update your own goals');
    }
    if (progress < 0) fail('progress cannot be negative');
    ctx.db.goal.id.update({
      ...row,
      progress,
      status: progress >= row.target ? 'done' : 'active',
    });
  }
);

export const deleteGoal = spacetimedb.reducer(
  { goalId: t.u64() },
  (ctx, { goalId }) => {
    const self = callerFriend(ctx);
    const row = ctx.db.goal.id.find(goalId);
    if (!row || row.friendId !== self.id) fail('no such goal');
    ctx.db.goal.delete(row);
  }
);

// --- Group chat ---

function checkReplyTo(ctx: Ctx, groupId: bigint, replyToId: bigint) {
  if (replyToId === 0n) return;
  const parent = ctx.db.feedItem.id.find(replyToId);
  if (!parent || parent.groupId !== groupId) fail('reply target is not in this group');
}

// Friend-only: a chat message, optionally replying to another item.
export const sendMessage = spacetimedb.reducer(
  { groupId: t.u64(), text: t.string(), replyToId: t.u64() },
  (ctx, { groupId, text, replyToId }) => {
    const self = callerFriend(ctx);
    if (!isMember(ctx, groupId, self.id)) fail('you are not in this group');
    checkReplyTo(ctx, groupId, replyToId);
    insertFeedItem(ctx, {
      groupId,
      friendId: self.id,
      kind: 'message',
      text: cleanText(text),
      createdBy: 'friend',
      replyToId,
      localDate: '',
    });
  }
);

// Friend-only: adds the emoji, or removes it if already there.
export const toggleReaction = spacetimedb.reducer(
  { feedItemId: t.u64(), emoji: t.string() },
  (ctx, { feedItemId, emoji }) => {
    const self = callerFriend(ctx);
    const item = ctx.db.feedItem.id.find(feedItemId);
    if (!item || !isMember(ctx, item.groupId, self.id)) fail('no such item');
    const e = emoji.trim();
    if (!e || e.length > 16) fail('emoji must be 1–16 characters');
    for (const r of ctx.db.reaction.feedItemId.filter(feedItemId)) {
      if (r.friendId === self.id && r.emoji === e) {
        ctx.db.reaction.delete(r);
        return;
      }
    }
    ctx.db.reaction.insert({ id: 0n, feedItemId, friendId: self.id, emoji: e });
  }
);

// Agent-only: any non-message kind, as a reply to `replyToId` or 0.
// Enforces the one-per-day limit and roast consent.
export const postFeedItem = spacetimedb.reducer(
  {
    groupId: t.u64(),
    friendId: t.u64(),
    kind: t.string(),
    text: t.string(),
    replyToId: t.u64(),
    localDate: t.string(),
  },
  (ctx, { groupId, friendId, kind, text, replyToId, localDate }) => {
    requireAgent(ctx);
    oneOf(kind, FEED_KINDS, 'kind');
    if (kind === 'message') fail('agents post highlights, not messages');
    if (!ctx.db.friendGroup.id.find(groupId)) fail('no such group');
    checkReplyTo(ctx, groupId, replyToId);
    const body = cleanText(text);

    if (friendId !== 0n) {
      requireFriendRow(ctx, friendId);
      if (!isMember(ctx, groupId, friendId)) fail('friend is not in this group');
    }
    if (kind === 'roast' && (friendId === 0n || !settingsFor(ctx, friendId).roastOk)) {
      fail('this friend has not allowed roasts');
    }
    if (DAILY_LIMITED_KINDS.includes(kind)) {
      if (friendId === 0n) fail(`${kind} posts must be about a friend`);
      checkLocalDate(ctx, localDate);
      for (const item of ctx.db.feedItem.friendId.filter(friendId)) {
        if (
          item.createdBy === 'agent' &&
          item.localDate === localDate &&
          DAILY_LIMITED_KINDS.includes(item.kind)
        ) {
          fail('already posted about this friend today');
        }
      }
    }
    insertFeedItem(ctx, {
      groupId,
      friendId,
      kind,
      text: body,
      createdBy: 'agent',
      replyToId,
      localDate: DAILY_LIMITED_KINDS.includes(kind) ? localDate : '',
    });
  }
);

// --- Check-on-me nudges ---

export const postNudge = spacetimedb.reducer(
  { aboutFriendId: t.u64(), toFriendId: t.u64(), text: t.string() },
  (ctx, { aboutFriendId, toFriendId, text }) => {
    requireAgent(ctx);
    requireFriendRow(ctx, aboutFriendId);
    requireFriendRow(ctx, toFriendId);
    const settings = settingsFor(ctx, aboutFriendId);
    if (!settings.checkOnMe) fail('this friend has not turned on check-on-me');
    if (!settings.trustedFriendIds.includes(toFriendId)) {
      fail('recipient is not one of their trusted friends');
    }
    const body = cleanText(text);
    // Nudges never state numbers (hours slept, steps, etc.).
    if (/\d/.test(body)) fail('nudges cannot contain numbers');
    ctx.db.nudge.insert({
      id: 0n,
      aboutFriendId,
      toFriendId,
      text: body,
      status: settings.nudgePreview ? 'pending_preview' : 'delivered',
      createdAt: ctx.timestamp,
    });
  }
);

// The friend a nudge is about approves or vetoes it.
export const reviewNudge = spacetimedb.reducer(
  { nudgeId: t.u64(), approve: t.bool() },
  (ctx, { nudgeId, approve }) => {
    const self = callerFriend(ctx);
    const row = ctx.db.nudge.id.find(nudgeId);
    if (!row || row.aboutFriendId !== self.id) fail('no such nudge');
    if (row.status !== 'pending_preview') fail('this nudge was already reviewed');
    ctx.db.nudge.id.update({ ...row, status: approve ? 'delivered' : 'vetoed' });
  }
);

// --- Plans ---

// `options`: JSON [{label, detail?, startsAt?}], 1–3 entries. Also posts a
// plan_proposal feed item.
export const proposePlan = spacetimedb.reducer(
  { groupId: t.u64(), title: t.string(), options: t.string() },
  (ctx, { groupId, title, options }) => {
    requireAgent(ctx);
    if (!ctx.db.friendGroup.id.find(groupId)) fail('no such group');
    const parsed = parseJson(options, 'options');
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 3) {
      fail('options must be a JSON array of 1–3 entries');
    }
    const row = ctx.db.plan.insert({
      id: 0n,
      groupId,
      title: cleanText(title, 'title'),
      status: 'open',
      confirmedOptionId: 0n,
      createdAt: ctx.timestamp,
    });
    parsed.forEach((o, i) => {
      ctx.db.planOption.insert({
        id: 0n,
        planId: row.id,
        label: cleanText(String(o?.label ?? ''), `options[${i}].label`),
        detail: String(o?.detail ?? '').trim(),
        startsAt: o?.startsAt ? parseIso(String(o.startsAt), `options[${i}].startsAt`) : undefined,
      });
    });
    insertFeedItem(ctx, {
      groupId,
      friendId: 0n,
      kind: 'plan_proposal',
      text: row.title,
      createdBy: 'agent',
      replyToId: 0n,
      localDate: '',
    });
  }
);

function confirm(ctx: Ctx, planId: bigint, optionId: bigint) {
  const row = ctx.db.plan.id.find(planId)!;
  ctx.db.plan.id.update({ ...row, status: 'confirmed', confirmedOptionId: optionId });
}

// Friend votes for themself; the agent relays ASI:One votes with friendId.
// Changing a vote replaces it. A strict majority of the group confirms.
export const votePlan = spacetimedb.reducer(
  { planId: t.u64(), optionId: t.u64(), friendId: t.u64() },
  (ctx, { planId, optionId, friendId }) => {
    const who = actingFriend(ctx, friendId);
    const row = ctx.db.plan.id.find(planId);
    if (!row) fail('no such plan');
    if (row.status !== 'open') fail(`plan is ${row.status}`);
    if (!isMember(ctx, row.groupId, who.id)) fail('not in this plan’s group');
    const option = ctx.db.planOption.id.find(optionId);
    if (!option || option.planId !== planId) fail('no such option');

    const votes = [...ctx.db.planVote.planId.filter(planId)];
    const mine = votes.find(v => v.friendId === who.id);
    if (mine) {
      ctx.db.planVote.id.update({ ...mine, optionId });
    } else {
      ctx.db.planVote.insert({ id: 0n, planId, friendId: who.id, optionId });
    }

    const members = groupMemberIds(ctx, row.groupId).length;
    const count = [...ctx.db.planVote.planId.filter(planId)].filter(
      v => v.optionId === optionId
    ).length;
    if (count * 2 > members) confirm(ctx, planId, optionId);
  }
);

export const confirmPlan = spacetimedb.reducer(
  { planId: t.u64(), optionId: t.u64() },
  (ctx, { planId, optionId }) => {
    requireAgent(ctx);
    const row = ctx.db.plan.id.find(planId);
    if (!row) fail('no such plan');
    if (row.status !== 'open') fail(`plan is ${row.status}`);
    const option = ctx.db.planOption.id.find(optionId);
    if (!option || option.planId !== planId) fail('no such option');
    confirm(ctx, planId, optionId);
  }
);

export const cancelPlan = spacetimedb.reducer(
  { planId: t.u64() },
  (ctx, { planId }) => {
    requireAgent(ctx);
    const row = ctx.db.plan.id.find(planId);
    if (!row) fail('no such plan');
    ctx.db.plan.id.update({ ...row, status: 'cancelled' });
  }
);

// --- Per-caller views: a browser's own private rows ---

function viewerFriendId(ctx: { sender: any; db: any }): bigint | undefined {
  for (const row of ctx.db.friend.iter()) {
    if (row.identity && row.identity.isEqual(ctx.sender)) return row.id;
  }
  return undefined;
}

export const myFriend = spacetimedb.view(
  { public: true },
  t.option(friend.rowType),
  ctx => {
    const id = viewerFriendId(ctx);
    return id === undefined ? undefined : ctx.db.friend.id.find(id) ?? undefined;
  }
);

export const myConsent = spacetimedb.view(
  { public: true },
  t.array(consent.rowType),
  ctx => {
    const id = viewerFriendId(ctx);
    return id === undefined ? [] : [...ctx.db.consent.friendId.filter(id)];
  }
);

export const mySettings = spacetimedb.view(
  { public: true },
  t.option(friendSettings.rowType),
  ctx => {
    const id = viewerFriendId(ctx);
    return id === undefined ? undefined : ctx.db.friendSettings.friendId.find(id) ?? undefined;
  }
);

// Nudges about the viewer that wait for their approval.
export const myNudgePreviews = spacetimedb.view(
  { public: true },
  t.array(nudge.rowType),
  ctx => {
    const id = viewerFriendId(ctx);
    if (id === undefined) return [];
    return [...ctx.db.nudge.aboutFriendId.filter(id)].filter(
      n => n.status === 'pending_preview'
    );
  }
);

// The viewer's private inbox: delivered nudges addressed to them.
export const myNudgeInbox = spacetimedb.view(
  { public: true },
  t.array(nudge.rowType),
  ctx => {
    const id = viewerFriendId(ctx);
    if (id === undefined) return [];
    return [...ctx.db.nudge.iter()].filter(
      n => n.toFriendId === id && n.status === 'delivered'
    );
  }
);
