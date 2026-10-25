import { useSyncExternalStore } from "react";
import { DbConnection } from "../module_bindings";
import type {
  Checkin,
  Consent,
  FeedItem,
  Friend,
  FriendGroup,
  FriendSettings,
  Friendship,
  Goal as LiveGoal,
  Membership,
  Photo,
  Plan,
  PlanOption,
  PlanVote,
  Reaction,
} from "../module_bindings/types";
import type { Connection, Goal, GoalLog, Permissions, User } from "./types";
import { mutate } from "./db";
import { currentProgress } from "./goals";
import { celebrate } from "./celebrate";
import { randomSalt, sha256 } from "./hash";

// The shared, live side of Waggle: who's signed up, friendships, chats (1:1
// and groups), agent posts, plans and whatever each friend chose to share. It
// runs on the SpacetimeDB module in server/. Accounts and goal history stay in
// db.ts; the sync* functions push the parts other people (and their agents)
// should see. Other people and friendships are mirrored into db.ts as users
// with a remoteId and connections, so the Friends pages read them as before.

// Default: SpacetimeDB on the machine serving this page, so phones opening
// the Mac's LAN URL reach the Mac rather than themselves.
const URI = import.meta.env.VITE_SPACETIMEDB_URI || `ws://${location.hostname}:3000`;
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB || "calhacks";
/** Seeded people and the claim codes of their seeded group members. */
const CLAIM_CODES: Record<string, string> = {
  u_demo: "RILEY-1",
  u_maya: "MAYA-1",
  u_sam: "SAM-1",
  u_jordan: "JORDAN-1",
};

export type LiveStatus = "offline" | "connecting" | "joining" | "ready" | "error";

export interface LiveState {
  status: LiveStatus;
  error?: string;
  me?: Friend;
  /** Every chat I'm in: 1:1s with friends and groups. */
  groups: FriendGroup[];
  /** The open chat, if any; `feed` and `plans` are this chat's. */
  group?: FriendGroup;
  /** Everyone signed up (public profiles). */
  friends: Friend[];
  friendships: Friendship[];
  /** Memberships of every chat I'm in. */
  members: Membership[];
  feed: FeedItem[];
  /** Items in all my chats, for chat-list previews. */
  allFeed: FeedItem[];

  reactions: Reaction[];
  plans: Plan[];
  options: PlanOption[];
  votes: PlanVote[];
  goals: LiveGoal[];
  checkins: Checkin[];
  photos: Photo[];
  myConsent: Consent[];
  mySettings?: FriendSettings;
}

const EMPTY: LiveState = {
  status: "offline",
  groups: [],
  friends: [],
  friendships: [],
  members: [],
  feed: [],
  allFeed: [],
  reactions: [],
  plans: [],
  options: [],
  votes: [],
  goals: [],
  checkins: [],
  photos: [],
  myConsent: [],
};

let state: LiveState = EMPTY;
let conn: DbConnection | null = null;
let connectedUserId: string | null = null;
let openGroupId: bigint | null = null;
// Newest feed item id seen once the first load finished; null until then, so
// history doesn't set off confetti.
let feedSeen: bigint | null = null;

const maxId = (rows: Iterable<{ id: bigint }>) => {
  let m = 0n;
  for (const r of rows) if (r.id > m) m = r.id;
  return m;
};

/** A friend's goal win that just arrived (not history): confetti, once per batch. */
function celebrateNewWins(feed: FeedItem[], me: Friend | undefined, friends: Friend[]) {
  if (feedSeen === null) return;
  const seen = feedSeen;
  const win = feed.find((f) => f.id > seen && f.kind === "goal_hit" && f.createdBy === "agent" && f.friendId !== me?.id);
  feedSeen = maxId(feed) > seen ? maxId(feed) : seen;
  if (!win) return;
  const who = friends.find((f) => f.id === win.friendId)?.name.split(" ")[0] ?? "A friend";
  celebrate({ title: `${who} reached a goal! 🎉`, detail: win.text });
}
const listeners = new Set<() => void>();

function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const byCreated = <T extends { createdAt: { toDate(): Date } }>(a: T, b: T) =>
  a.createdAt.toDate().getTime() - b.createdAt.toDate().getTime();

// Rebuild the snapshot after a burst of row events, not once per row.
let refreshQueued = false;
function queueRefresh() {
  if (refreshQueued || !conn) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    if (!conn) return;
    const db = conn.db;
    const me = [...db.myFriend.iter()][0];
    const groups = [...db.myGroups.iter()];
    const groupIds = new Set(groups.map((g) => g.id));
    const allFeed = [...db.myFeed.iter()].sort(byCreated);
    const friends = [...db.friend.iter()];
    const friendships = [...db.myFriendships.iter()];
    mirror(me, friends, friendships);
    celebrateNewWins(allFeed, me, friends);
    set({
      me,
      groups,
      group: groups.find((g) => g.id === openGroupId),
      friends,
      friendships,
      members: [...db.myMemberships.iter()],
      feed: allFeed.filter((f) => f.groupId === openGroupId),
      allFeed,
      reactions: [...db.reaction.iter()],
      plans: [...db.plan.iter()].filter((p) => groupIds.has(p.groupId)).sort(byCreated),
      options: [...db.planOption.iter()],
      votes: [...db.planVote.iter()],
      goals: [...db.goal.iter()],
      checkins: [...db.checkin.iter()].sort(byCreated),
      photos: [...db.photo.iter()],
      myConsent: [...db.myConsent.iter()],
      mySettings: [...db.mySettings.iter()][0],
    });
  });
}

const tokenKey = (userId: string) => `orbit.live.token.${userId}`;

function readToken(userId: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(userId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(userId: string, token: string) {
  try {
    localStorage.setItem(tokenKey(userId), token);
  } catch {
    // Private mode: this tab still works, the link is just lost on reload.
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Connect this Waggle account to the shared group. Safe to call on every render. */
export function connectAs(user: User) {
  if (connectedUserId === user.id) return;
  disconnect();
  connectedUserId = user.id;
  set({ ...EMPTY, status: "connecting" });

  conn = DbConnection.builder()
    .withUri(URI)
    .withDatabaseName(DB_NAME)
    .withToken(readToken(user.id))
    .onConnect((c, _identity, token) => {
      saveToken(user.id, token);
      for (const table of [
        c.db.friend, c.db.myFriendships, c.db.myGroups, c.db.myMemberships, c.db.myFeed, c.db.reaction, c.db.plan,
        c.db.planOption, c.db.planVote, c.db.goal, c.db.checkin, c.db.photo, c.db.myFriend, c.db.myConsent, c.db.mySettings,
      ] as { onInsert(cb: () => void): void; onDelete(cb: () => void): void; onUpdate?(cb: () => void): void }[]) {
        table.onInsert(queueRefresh);
        table.onDelete(queueRefresh);
        // Tables with a primary key report changes (a confirmed plan, new
        // goal progress, a consent switch) as updates, not insert + delete.
        table.onUpdate?.(queueRefresh);
      }
      c.subscriptionBuilder()
        .onApplied(() => {
          feedSeen = maxId(c.db.myFeed.iter());
          queueRefresh();
          void ensureMember(c, user);
        })
        .onError(() => set({ status: "error", error: "Couldn't load your chats." }))
        .subscribe([
          "SELECT * FROM friend", "SELECT * FROM my_friendships", "SELECT * FROM my_groups",
          "SELECT * FROM my_memberships", "SELECT * FROM my_feed", "SELECT * FROM reaction", "SELECT * FROM plan",
          "SELECT * FROM plan_option", "SELECT * FROM plan_vote", "SELECT * FROM goal",
          "SELECT * FROM checkin", "SELECT * FROM photo", "SELECT * FROM my_friend", "SELECT * FROM my_consent",
          "SELECT * FROM my_settings",
        ]);
    })
    .onConnectError((_ctx, e) => set({ status: "error", error: `Can't reach the server (${message(e)}).` }))
    .onDisconnect(() => {
      if (conn) set({ status: "error", error: "Lost connection to the server." });
    })
    .build();
}

export function disconnect() {
  const old = conn;
  conn = null;
  connectedUserId = null;
  openGroupId = null;
  feedSeen = null;
  old?.disconnect();
  set(EMPTY);
}

/** Seeded people claim their friend row; everyone else signs up as a new one. */
async function ensureMember(c: DbConnection, user: User) {
  const existing = [...c.db.myFriend.iter()][0];
  if (existing) {
    // Joined before usernames existed: take this account's username so friends can find it.
    if (!existing.username) await c.reducers.setUsername({ username: user.username }).catch(warn("username"));
    set({ status: "ready" });
    return;
  }
  set({ status: "joining" });
  try {
    const code = CLAIM_CODES[user.id];
    if (code) {
      await c.reducers.claimFriend({ claimCode: code });
    } else {
      await c.reducers.register({
        username: user.username,
        name: user.displayName,
        city: user.city,
        timezone: user.timezone,
        avatar: user.avatar.emoji,
      });
    }
    set({ status: "ready" });
  } catch (e) {
    set({ status: "error", error: `Couldn't sign you up: ${message(e)}` });
  }
}

// ---------- people and friendships, mirrored into db.ts ----------

const AVATAR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e87ba4", "#008300", "#e34948", "#eda100"];

export const remoteUserId = (friendId: bigint) => `f_${friendId}`;

/** The live friend id behind a mirrored user id (`f_12`), if it is one. */
export function liveFriendId(userId: string): bigint | undefined {
  return /^f_\d+$/.test(userId) ? BigInt(userId.slice(2)) : undefined;
}

function remoteUser(f: Friend): User {
  let h = 0;
  for (const ch of f.username) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return {
    id: remoteUserId(f.id),
    remoteId: String(f.id),
    username: f.username,
    authProvider: "password",
    displayName: f.name,
    bio: "",
    city: f.city,
    timezone: f.timezone,
    avatar: { emoji: f.avatar || "🙂", color: AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] },
    profileVisibility: { city: true, bio: false, goals: true },
    onboarded: true,
    createdAt: 0,
  };
}

let mirrored = "";

/** Other signed-up people become users, and my friendships become connections. */
function mirror(me: Friend | undefined, friends: Friend[], friendships: Friendship[]) {
  const localId = connectedUserId;
  if (!me || !localId) return;
  const toLocal = (id: bigint) => (id === me.id ? localId : remoteUserId(id));
  const users = friends.filter((f) => f.id !== me.id && f.username).map(remoteUser);
  const connections: Connection[] = friendships.map((f) => ({
    id: `fs_${f.id}`,
    fromId: toLocal(f.fromId),
    toId: toLocal(f.toId),
    status: f.status === "accepted" ? "accepted" : "pending",
    createdAt: f.createdAt.toDate().getTime(),
  }));
  // Skip the write (and the save) when nothing changed.
  const key = JSON.stringify([localId, users, connections]);
  if (key === mirrored) return;
  mirrored = key;
  mutate((db) => ({
    ...db,
    users: [...db.users.filter((u) => !u.remoteId), ...users],
    connections: [...db.connections.filter((c) => c.fromId !== localId && c.toId !== localId), ...connections],
  }));
}

function live(): DbConnection | null {
  return conn && state.status === "ready" ? conn : null;
}

// ---------- actions (the group page calls these directly) ----------

/** Open a chat (or go back to the list with null). */
export function openChat(groupId: bigint | null) {
  openGroupId = groupId;
  queueRefresh();
}

/** The 1:1 chat with a friend, by their live friend id. */
export function directChatWith(friendId: bigint): FriendGroup | undefined {
  const dmIds = new Set(state.groups.filter((g) => g.isDirect).map((g) => g.id));
  const m = state.members.find((x) => x.friendId === friendId && dmIds.has(x.groupId));
  return m && state.groups.find((g) => g.id === m.groupId);
}

/** Members of one of my chats, other than me. */
export function chatMembers(s: LiveState, groupId: bigint): Friend[] {
  const ids = new Set(s.members.filter((m) => m.groupId === groupId).map((m) => m.friendId));
  return s.friends.filter((f) => ids.has(f.id) && f.id !== s.me?.id);
}

/** A 1:1 is named after the friend; a group by its name. */
export function chatTitle(s: LiveState, group: FriendGroup): string {
  if (!group.isDirect) return group.name;
  return chatMembers(s, group.id)[0]?.name ?? "Former friend";
}

/** My accepted friends, as live friend rows. */
export function liveFriends(s: LiveState): Friend[] {
  const me = s.me?.id;
  const ids = new Set(
    s.friendships.filter((f) => f.status === "accepted").map((f) => (f.fromId === me ? f.toId : f.fromId)),
  );
  return s.friends.filter((f) => ids.has(f.id));
}

function requireLive(): DbConnection {
  const c = live();
  if (!c) throw new Error(state.error ?? "Not connected yet. Try again in a moment.");
  return c;
}

export async function sendMessage(text: string, replyToId = 0n) {
  if (!state.group) throw new Error("Open a chat first.");
  await requireLive().reducers.sendMessage({ groupId: state.group.id, text, replyToId });
}

export async function sendFriendRequest(toId: bigint) {
  await requireLive().reducers.sendFriendRequest({ toId });
}

export async function acceptFriendRequest(fromId: bigint) {
  await requireLive().reducers.acceptFriendRequest({ fromId });
}

/** Decline, cancel or unfriend. */
export async function removeFriend(friendId: bigint) {
  await requireLive().reducers.removeFriend({ friendId });
}

/** Make a group chat of friends and open it. */
export async function createGroup(name: string, friendIds: bigint[]) {
  const c = requireLive();
  const before = new Set(state.groups.map((g) => g.id));
  await c.reducers.createGroup({ name, friendIds });
  const made = [...c.db.myGroups.iter()].find((g) => !g.isDirect && !before.has(g.id));
  if (made) openChat(made.id);
}

export async function addGroupMember(groupId: bigint, friendId: bigint) {
  await requireLive().reducers.addGroupMember({ groupId, friendId });
}

export async function leaveGroup(groupId: bigint) {
  await requireLive().reducers.leaveGroup({ groupId });
  openChat(null);
}

export async function addCheckin(text: string) {
  await live()?.reducers.addCheckin({ friendId: 0n, text });
}

export async function toggleReaction(feedItemId: bigint, emoji: string) {
  await live()?.reducers.toggleReaction({ feedItemId, emoji });
}

export async function votePlan(planId: bigint, optionId: bigint) {
  await live()?.reducers.votePlan({ planId, optionId, friendId: 0n });
}

/** What a source may be used for: shared as highlights, planning only, or off. */
export async function setConsent(source: string, shareLevel: "highlights" | "planning_only" | "off") {
  await live()?.reducers.setConsent({ source, shareLevel });
}

/** Roast me, Check on me and who gets nudged. Other settings keep their current values. */
export async function setSettings(patch: { roastOk?: boolean; checkOnMe?: boolean; trustedFriendIds?: bigint[] }) {
  const c = live();
  const s = state.mySettings;
  if (!c) return;
  await c.reducers.setFriendSettings({
    roastOk: patch.roastOk ?? s?.roastOk ?? false,
    checkOnMe: patch.checkOnMe ?? s?.checkOnMe ?? false,
    trustedFriendIds: patch.trustedFriendIds ?? s?.trustedFriendIds ?? [],
    nudgePreview: s?.nudgePreview ?? true,
  });
}

export async function setIngestTokenHash(tokenHash: string) {
  await live()?.reducers.setIngestToken({ tokenHash });
}

const INGEST_TOKEN_KEY = "orbit.ingestToken";

/**
 * This friend's ingest token for calls to the agent service. Made on first
 * need: the module keeps only its SHA-256 hash, the browser keeps the token.
 * Null until the live group is ready, since the hash has to reach the module.
 */
export async function ingestToken(): Promise<string | null> {
  const me = state.me;
  if (!live() || !me) return null;
  const key = `${INGEST_TOKEN_KEY}.${me.id}`;
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const token = randomSalt() + randomSalt();
  await setIngestTokenHash(sha256(token));
  localStorage.setItem(key, token);
  return token;
}

/** Drop a token the agent service no longer knows (e.g. after reset_demo). */
export function forgetIngestToken() {
  if (state.me) localStorage.removeItem(`${INGEST_TOKEN_KEY}.${state.me.id}`);
}

// ---------- sync from the local store (api.ts calls these) ----------

function warn(what: string) {
  return (e: unknown) => console.warn(`Waggle live sync (${what}):`, message(e));
}

/** Shared goals, with this period's progress, so agents can celebrate them. */
export function syncGoals(userId: string, goals: Goal[], logs: GoalLog[]) {
  const c = live();
  const me = state.me;
  if (!c || !me) return;
  // "Stay under" goals (screen time under 3h) aren't won by reaching the
  // number, so only "reach" goals go to the module, which marks them done.
  const shared = goals.filter((g) => g.userId === userId && g.shareWithFriends && !g.archived && g.direction !== "atMost");
  const mine = [...c.db.goal.iter()].filter((g) => g.friendId === me.id);
  const run = async () => {
    for (const goal of shared) {
      const { total } = currentProgress(goal, logs);
      let remote = mine.find((g) => g.description === goal.title);
      if (!remote) {
        await c.reducers.setGoal({ description: goal.title, target: goal.target });
        remote = [...c.db.goal.iter()].find((g) => g.friendId === me.id && g.description === goal.title);
      }
      if (remote && remote.progress !== total) {
        await c.reducers.updateGoalProgress({ goalId: remote.id, progress: total });
      }
    }
    for (const remote of mine) {
      if (!shared.some((g) => g.title === remote.description)) {
        await c.reducers.deleteGoal({ goalId: remote.id });
      }
    }
  };
  run().catch(warn("goals"));
}

/**
 * Device permissions gate each source: revoking one turns it off, and
 * granting one turns it on (as highlights) only if it was off. Finer choices
 * (planning only) are made on the Share page and kept.
 */
export function syncConsent(perms: Permissions) {
  const c = live();
  if (!c) return;
  const granted: Record<string, boolean> = {
    calendar: Object.values(perms.calendars).some((cal) => cal.connected),
    photos: perms.photos === "granted",
    screen_time: perms.screenTime !== "off",
  };
  const current = new Map(state.myConsent.map((r) => [r.source, r.shareLevel]));
  for (const [source, on] of Object.entries(granted)) {
    const level = current.get(source) ?? "off";
    const next = !on ? "off" : level === "off" ? "highlights" : level;
    if (next !== level) c.reducers.setConsent({ source, shareLevel: next }).catch(warn("consent"));
  }
}

export function syncProfile(user: User) {
  live()
    ?.reducers.updateProfile({ name: user.displayName, city: user.city, timezone: user.timezone, avatar: user.avatar.emoji })
    .catch(warn("profile"));
}

// ---------- selectors ----------

export function firstName(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "Someone";
}

// ---------- React ----------

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLive(): LiveState {
  return useSyncExternalStore(subscribe, () => state);
}
