import { useSyncExternalStore } from "react";
import { DbConnection } from "../module_bindings";
import type {
  Checkin,
  Consent,
  FeedItem,
  Friend,
  FriendGroup,
  FriendSettings,
  Goal as LiveGoal,
  Membership,
  Photo,
  Plan,
  PlanOption,
  PlanVote,
  Reaction,
} from "../module_bindings/types";
import type { Goal, GoalLog, Permissions, SharingPrefs, User } from "./types";
import { currentProgress } from "./goals";
import { randomSalt, sha256 } from "./hash";

// The shared, live side of Waggle: the group chat, agent posts, plans and
// whatever each friend chose to share. It runs on the SpacetimeDB module in
// server/. Accounts, the friend list and goal history stay in db.ts; the
// sync* functions push the parts other people (and their agents) should see.

// Default: SpacetimeDB on the machine serving this page, so phones opening
// the Mac's LAN URL reach the Mac rather than themselves.
const URI = import.meta.env.VITE_SPACETIMEDB_URI || `ws://${location.hostname}:3000`;
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB || "calhacks";
const GROUP_INVITE = "CATCHUP";
const INVITE_KEY = "waggle.invite";

/** Remember the code from an invite link (/j/:code) until the account joins. */
export function rememberInvite(code: string) {
  try {
    sessionStorage.setItem(INVITE_KEY, code.trim().toUpperCase());
  } catch {
    // Storage blocked: the default hive invite still works.
  }
}

function pendingInvite(): string {
  try {
    return sessionStorage.getItem(INVITE_KEY) || GROUP_INVITE;
  } catch {
    return GROUP_INVITE;
  }
}

/** The link friends open to land in this hive. */
export function inviteLink(): string {
  return `${location.origin}/j/${pendingInvite()}`;
}

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
  group?: FriendGroup;
  friends: Friend[];
  members: Membership[];
  feed: FeedItem[];
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
  friends: [],
  members: [],
  feed: [],
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
    const members = [...db.membership.iter()];
    const myGroupId = me ? members.find((m) => m.friendId === me.id)?.groupId : undefined;
    set({
      me,
      group: [...db.friendGroup.iter()].find((g) => g.id === myGroupId),
      friends: [...db.friend.iter()],
      members,
      feed: [...db.feedItem.iter()].filter((f) => f.groupId === myGroupId).sort(byCreated),
      reactions: [...db.reaction.iter()],
      plans: [...db.plan.iter()].filter((p) => p.groupId === myGroupId).sort(byCreated),
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
        c.db.friend, c.db.friendGroup, c.db.membership, c.db.feedItem, c.db.reaction, c.db.plan,
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
          queueRefresh();
          void ensureMember(c, user);
        })
        .onError(() => set({ status: "error", error: "Couldn't load the group." }))
        .subscribe([
          "SELECT * FROM friend", "SELECT * FROM friend_group", "SELECT * FROM membership",
          "SELECT * FROM feed_item", "SELECT * FROM reaction", "SELECT * FROM plan",
          "SELECT * FROM plan_option", "SELECT * FROM plan_vote", "SELECT * FROM goal",
          "SELECT * FROM checkin", "SELECT * FROM photo", "SELECT * FROM my_friend", "SELECT * FROM my_consent",
          "SELECT * FROM my_settings",
        ]);
    })
    .onConnectError((_ctx, e) => set({ status: "error", error: `Can't reach the group server (${message(e)}).` }))
    .onDisconnect(() => {
      if (conn) set({ status: "error", error: "Lost connection to the group server." });
    })
    .build();
}

export function disconnect() {
  const old = conn;
  conn = null;
  connectedUserId = null;
  old?.disconnect();
  set(EMPTY);
}

/** Seeded people claim their group member; everyone else joins as a new one. */
async function ensureMember(c: DbConnection, user: User) {
  if ([...c.db.myFriend.iter()].length > 0) {
    set({ status: "ready" });
    return;
  }
  set({ status: "joining" });
  try {
    const code = CLAIM_CODES[user.id];
    if (code) {
      await c.reducers.claimFriend({ claimCode: code });
    } else {
      await c.reducers.joinGroup({
        inviteCode: pendingInvite(),
        name: user.displayName,
        city: user.city,
        timezone: user.timezone,
        avatar: user.avatar.emoji,
      });
    }
    set({ status: "ready" });
  } catch (e) {
    set({ status: "error", error: `Couldn't join the group: ${message(e)}` });
  }
}

function live(): DbConnection | null {
  return conn && state.status === "ready" ? conn : null;
}

// ---------- actions (the group page calls these directly) ----------

export async function sendMessage(text: string, replyToId = 0n) {
  if (!state.group) throw new Error("Not in a group yet.");
  await live()?.reducers.sendMessage({ groupId: state.group.id, text, replyToId });
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
  const shared = goals.filter((g) => g.userId === userId && g.shareWithFriends && !g.archived);
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

/** Roasts are allowed if the person allowed them for any friend. */
export function syncRoastOk(userId: string, sharing: SharingPrefs[]) {
  const c = live();
  const s = state.mySettings;
  if (!c || !s) return;
  const roastOk = sharing.some((p) => p.ownerId === userId && p.roastOk);
  if (roastOk === s.roastOk) return;
  c.reducers
    .setFriendSettings({ roastOk, checkOnMe: s.checkOnMe, trustedFriendIds: s.trustedFriendIds, nudgePreview: s.nudgePreview })
    .catch(warn("settings"));
}

export function syncProfile(user: User) {
  live()
    ?.reducers.updateProfile({ name: user.displayName, city: user.city, timezone: user.timezone, avatar: user.avatar.emoji })
    .catch(warn("profile"));
}

// ---------- selectors ----------

/** Friends in my hive, me included, in join order. */
export function hiveMembers(s: LiveState): Friend[] {
  const ids = s.members.filter((m) => m.groupId === s.group?.id).map((m) => m.friendId);
  return ids.map((id) => s.friends.find((f) => f.id === id)).filter((f): f is Friend => !!f);
}

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
