import { getDB, mutate, newId } from "./db";
import { hashPassword, randomSalt } from "./hash";
import { defaultPermissions, defaultSharing, sampleGoalsFor } from "./seed";
import { today } from "./dates";
import type {
  CalendarProvider,
  Connection,
  DB,
  Goal,
  GoalLog,
  Id,
  Permissions,
  SharingPrefs,
  User,
} from "./types";

// Actions are named after the SpacetimeDB reducers in the plan (join_group,
// set_consent, set_goal, ...). Each one is the only way the UI changes state.

export class ApiError extends Error {}

const AVATAR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e87ba4", "#008300", "#e34948", "#eda100"];
const AVATAR_EMOJI = ["🙂", "🌻", "🚀", "🎧", "🌊", "🍜", "🎨", "🪴", "⚡", "🐢"];

function pick<T>(arr: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return arr[Math.abs(h) % arr.length];
}

function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  } catch {
    return "America/Los_Angeles";
  }
}

function newUser(p: Pick<User, "username" | "displayName" | "authProvider"> & Partial<User>): User {
  return {
    id: newId("u"),
    bio: "",
    city: "",
    timezone: guessTimezone(),
    avatar: { emoji: pick(AVATAR_EMOJI, p.username), color: pick(AVATAR_COLORS, p.username) },
    profileVisibility: { city: true, bio: true, goals: true },
    onboarded: false,
    createdAt: Date.now(),
    ...p,
  };
}

/** New accounts get a couple of friend requests so the Friends page isn't empty. */
function welcomeRequests(userId: Id): Connection[] {
  return ["u_jordan", "u_maya"].map((fromId) => ({
    id: newId("c"),
    fromId,
    toId: userId,
    status: "pending",
    createdAt: Date.now(),
  }));
}

const USERNAME_RE = /^[a-z0-9._]{3,24}$/;

// ---------- auth ----------

export function signUp(input: { username: string; password: string; displayName: string }): User {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new ApiError("Usernames are 3–24 characters: letters, numbers, dots, underscores.");
  if (input.password.length < 8) throw new ApiError("Use at least 8 characters for your password.");
  if (getDB().users.some((u) => u.username === username)) throw new ApiError("That username is taken.");

  const salt = randomSalt();
  const user = newUser({
    username,
    displayName: input.displayName.trim() || username,
    authProvider: "password",
    salt,
    passwordHash: hashPassword(input.password, salt),
  });
  mutate((db) => ({
    ...db,
    users: [...db.users, user],
    permissions: [...db.permissions, defaultPermissions(user.id)],
    connections: [...db.connections, ...welcomeRequests(user.id)],
    session: { userId: user.id },
  }));
  return user;
}

export function logIn(usernameRaw: string, password: string): User {
  const username = usernameRaw.trim().toLowerCase();
  const user = getDB().users.find((u) => u.username === username && !u.isSeed);
  if (!user || !user.salt || user.passwordHash !== hashPassword(password, user.salt)) {
    throw new ApiError(user?.authProvider === "google" ? "This account uses Google sign-in." : "Wrong username or password.");
  }
  mutate((db) => ({ ...db, session: { userId: user.id } }));
  return user;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export function signInWithGoogle(profile: GoogleProfile): { user: User; isNew: boolean } {
  const db = getDB();
  const existing = db.users.find((u) => u.googleSub === profile.sub || (u.email === profile.email && !u.isSeed));
  if (existing) {
    mutate((d) => ({ ...d, session: { userId: existing.id } }));
    return { user: existing, isNew: false };
  }
  let username = profile.email.split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 20) || "friend";
  while (db.users.some((u) => u.username === username)) username += Math.floor(Math.random() * 10);

  const user = newUser({
    username,
    displayName: profile.name,
    email: profile.email,
    googleSub: profile.sub,
    authProvider: "google",
  });
  if (profile.picture) user.avatar.imageDataUrl = profile.picture;
  const perms = defaultPermissions(user.id);
  mutate((d) => ({
    ...d,
    users: [...d.users, user],
    permissions: [...d.permissions, perms],
    connections: [...d.connections, ...welcomeRequests(user.id)],
    session: { userId: user.id },
  }));
  return { user, isNew: true };
}

export function logOut() {
  mutate((db) => ({ ...db, session: { userId: null } }));
}

function requireUser(): User {
  const db = getDB();
  const user = db.users.find((u) => u.id === db.session.userId);
  if (!user) throw new ApiError("You're signed out.");
  return user;
}

function patchUser(id: Id, patch: Partial<User>) {
  mutate((db) => ({ ...db, users: db.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
}

export function completeOnboarding() {
  patchUser(requireUser().id, { onboarded: true });
}

export function updateProfile(patch: Partial<Pick<User, "displayName" | "bio" | "city" | "timezone" | "avatar" | "profileVisibility" | "email" | "phone">>) {
  patchUser(requireUser().id, patch);
}

export function changePassword(current: string, next: string) {
  const user = requireUser();
  if (user.authProvider === "password" && (!user.salt || user.passwordHash !== hashPassword(current, user.salt))) {
    throw new ApiError("Current password is incorrect.");
  }
  if (next.length < 8) throw new ApiError("Use at least 8 characters for your new password.");
  const salt = randomSalt();
  patchUser(user.id, { salt, passwordHash: hashPassword(next, salt) });
}

export function deleteAccount() {
  const id = requireUser().id;
  mutate((db) => ({
    ...db,
    users: db.users.filter((u) => u.id !== id),
    permissions: db.permissions.filter((p) => p.userId !== id),
    connections: db.connections.filter((c) => c.fromId !== id && c.toId !== id),
    sharing: db.sharing.filter((s) => s.ownerId !== id && s.friendId !== id),
    goals: db.goals.filter((g) => g.userId !== id),
    logs: db.logs.filter((l) => l.userId !== id),
    session: { userId: null },
  }));
}

// ---------- permissions (set_consent) ----------

export function setPermissions(patch: Partial<Omit<Permissions, "userId" | "calendars">>) {
  const id = requireUser().id;
  mutate((db) => ({
    ...db,
    permissions: db.permissions.map((p) => (p.userId === id ? { ...p, ...patch } : p)),
  }));
}

export function setCalendar(provider: CalendarProvider, connected: boolean, account?: string) {
  const id = requireUser().id;
  mutate((db) => ({
    ...db,
    permissions: db.permissions.map((p) =>
      p.userId === id
        ? {
            ...p,
            calendars: {
              ...p.calendars,
              [provider]: connected ? { connected, account, connectedAt: Date.now() } : { connected: false },
            },
          }
        : p,
    ),
  }));
}

// ---------- connections ----------

export function sendFriendRequest(toId: Id) {
  const me = requireUser();
  const db = getDB();
  if (toId === me.id) return;
  const existing = db.connections.find(
    (c) => (c.fromId === me.id && c.toId === toId) || (c.fromId === toId && c.toId === me.id),
  );
  if (existing) {
    // They already asked us: sending back is the same as accepting.
    if (existing.status === "pending" && existing.toId === me.id) acceptFriendRequest(existing.id);
    return;
  }
  const conn: Connection = { id: newId("c"), fromId: me.id, toId, status: "pending", createdAt: Date.now() };
  mutate((d) => ({ ...d, connections: [...d.connections, conn] }));

  // Demo: seeded people accept after a moment, like a friend tapping "accept".
  if (db.users.find((u) => u.id === toId)?.isSeed) {
    setTimeout(() => {
      mutate((d) => ({
        ...d,
        connections: d.connections.map((c) => (c.id === conn.id ? { ...c, status: "accepted" } : c)),
      }));
    }, 2500);
  }
}

export function acceptFriendRequest(connectionId: Id) {
  mutate((db) => ({
    ...db,
    connections: db.connections.map((c) => (c.id === connectionId ? { ...c, status: "accepted" } : c)),
  }));
}

export function removeConnection(friendId: Id) {
  const me = requireUser().id;
  mutate((db) => ({
    ...db,
    connections: db.connections.filter(
      (c) => !((c.fromId === me && c.toId === friendId) || (c.fromId === friendId && c.toId === me)),
    ),
    sharing: db.sharing.filter(
      (s) => !((s.ownerId === me && s.friendId === friendId) || (s.ownerId === friendId && s.friendId === me)),
    ),
  }));
}

export function setSharing(friendId: Id, patch: Partial<Omit<SharingPrefs, "ownerId" | "friendId">>) {
  const me = requireUser().id;
  mutate((db) => {
    const current = db.sharing.find((s) => s.ownerId === me && s.friendId === friendId) ?? defaultSharing(me, friendId);
    const next = { ...current, ...patch };
    return {
      ...db,
      sharing: [...db.sharing.filter((s) => !(s.ownerId === me && s.friendId === friendId)), next],
    };
  });
}

/** Apply the same prefs to every friend (the "apply to all" shortcut). */
export function setSharingForAll(prefs: Pick<SharingPrefs, "frequency" | "categories">) {
  const me = requireUser().id;
  for (const f of friendsOf(getDB(), me)) setSharing(f.id, prefs);
}

export interface ContactEntry {
  name?: string;
  email?: string;
  phone?: string;
}

function normPhone(p?: string) {
  const digits = (p ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/** Match imported contacts against people on the platform. */
export function matchContacts(contacts: ContactEntry[]): { contact: ContactEntry; user?: User }[] {
  const me = requireUser();
  const others = getDB().users.filter((u) => u.id !== me.id);
  return contacts.map((contact) => {
    const email = contact.email?.trim().toLowerCase();
    const phone = normPhone(contact.phone);
    const user = others.find(
      (u) => (email && u.email?.toLowerCase() === email) || (phone && normPhone(u.phone) === phone),
    );
    return { contact, user };
  });
}

export function searchUsers(query: string): User[] {
  const me = requireUser();
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (q.length < 2) return [];
  return getDB()
    .users.filter((u) => u.id !== me.id)
    .filter((u) => u.username.includes(q) || u.displayName.toLowerCase().includes(q) || u.email?.toLowerCase() === q)
    .slice(0, 8);
}

// ---------- goals (set_goal) ----------

export function createGoal(input: Omit<Goal, "id" | "userId" | "archived" | "createdAt">): Goal {
  const me = requireUser().id;
  if (!input.title.trim()) throw new ApiError("Give your goal a name.");
  if (!(input.target > 0)) throw new ApiError("Target must be more than zero.");
  const goal: Goal = { ...input, id: newId("g"), userId: me, archived: false, createdAt: Date.now() };
  mutate((db) => ({ ...db, goals: [...db.goals, goal] }));
  return goal;
}

export function updateGoal(id: Id, patch: Partial<Goal>) {
  mutate((db) => ({ ...db, goals: db.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
}

export function deleteGoal(id: Id) {
  mutate((db) => ({
    ...db,
    goals: db.goals.filter((g) => g.id !== id),
    logs: db.logs.filter((l) => l.goalId !== id),
  }));
}

export function logProgress(goalId: Id, amount: number, date = today(), note?: string) {
  const me = requireUser().id;
  const goal = getDB().goals.find((g) => g.id === goalId);
  if (!goal) throw new ApiError("Goal not found.");
  if (!(amount > 0)) throw new ApiError("Enter an amount above zero.");
  const entry: GoalLog = { id: newId("l"), goalId, userId: me, amount, date, source: "manual", note, createdAt: Date.now() };
  mutate((db) => ({ ...db, logs: [...db.logs, entry] }));
}

export function loadSampleData() {
  const me = requireUser().id;
  const { goals, logs } = sampleGoalsFor(me, me.length * 7919);
  mutate((db) => ({
    ...db,
    goals: [...db.goals.filter((g) => !goals.some((s) => s.id === g.id)), ...goals],
    logs: [...db.logs.filter((l) => !logs.some((s) => s.id === l.id)), ...logs],
  }));
}

// ---------- selectors ----------

export function currentUser(db: DB): User | undefined {
  return db.users.find((u) => u.id === db.session.userId);
}

export function permissionsOf(db: DB, userId: Id): Permissions {
  return db.permissions.find((p) => p.userId === userId) ?? defaultPermissions(userId);
}

export function friendsOf(db: DB, userId: Id): User[] {
  const ids = db.connections
    .filter((c) => c.status === "accepted" && (c.fromId === userId || c.toId === userId))
    .map((c) => (c.fromId === userId ? c.toId : c.fromId));
  return db.users.filter((u) => ids.includes(u.id));
}

export function relationship(db: DB, me: Id, other: Id): "friends" | "outgoing" | "incoming" | "none" {
  const c = db.connections.find((x) => (x.fromId === me && x.toId === other) || (x.fromId === other && x.toId === me));
  if (!c) return "none";
  if (c.status === "accepted") return "friends";
  return c.fromId === me ? "outgoing" : "incoming";
}

export function sharingWith(db: DB, me: Id, friendId: Id): SharingPrefs {
  return db.sharing.find((s) => s.ownerId === me && s.friendId === friendId) ?? defaultSharing(me, friendId);
}
