import type { DB, Goal, GoalLog, Id, Permissions, SharingPrefs, User } from "./types";
import { addDays, periodStart, toISODate } from "./dates";
import { hashPassword } from "./hash";

export const DEMO_USERNAME = "demo";
export const DEMO_PASSWORD = "demo1234";

export function defaultPermissions(userId: Id): Permissions {
  return {
    userId,
    calendars: {
      google: { connected: false },
    },
    location: "off",
    photos: "off",
    screenTime: "off",
    contacts: "off",
  };
}

/** Conservative defaults: wins and availability only, nothing sensitive. */
export function defaultSharing(ownerId: Id, friendId: Id): SharingPrefs {
  return {
    ownerId,
    friendId,
    frequency: "daily",
    categories: {
      photos: false,
      places: false,
      availability: true,
      fitness: false,
      sleep: false,
      screenTime: false,
      checkins: true,
      goals: true,
    },
    goals: {},
    roastOk: false,
  };
}

function seedUser(p: Partial<User> & Pick<User, "id" | "username" | "displayName">): User {
  return {
    authProvider: "password",
    bio: "",
    city: "",
    timezone: "America/Los_Angeles",
    avatar: { emoji: "🙂", color: "#2a78d6" },
    profileVisibility: { city: true, bio: true, goals: true },
    onboarded: true,
    isSeed: true,
    createdAt: Date.now(),
    ...p,
  };
}

// Deterministic PRNG so seeded history is stable across reloads/resets.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample goal history for a user: ~120 days of logs. Used by the demo account and "Load sample data". */
export function sampleGoalsFor(userId: Id, seed = 42): { goals: Goal[]; logs: GoalLog[] } {
  const rand = mulberry32(seed);
  const created = addDays(new Date(), -120).getTime();
  const g = (id: string, p: Omit<Goal, "id" | "userId" | "archived" | "createdAt">): Goal => ({
    id: `${userId}_${id}`,
    userId,
    archived: false,
    createdAt: created,
    ...p,
  });

  const goals: Goal[] = [
    g("library", { title: "Study at the library", category: "study", period: "daily", target: 90, unit: "minutes", direction: "atLeast", trackBy: "location", place: "Green Library", shareWithFriends: true }),
    g("psets", { title: "Finish problem sets", category: "study", period: "weekly", target: 4, unit: "times", direction: "atLeast", trackBy: "manual", shareWithFriends: false }),
    g("run", { title: "Go for a run", category: "fitness", period: "weekly", target: 3, unit: "times", direction: "atLeast", trackBy: "manual", shareWithFriends: true }),
    g("screen", { title: "Keep screen time under 3h", category: "wellness", period: "daily", target: 180, unit: "minutes", direction: "atMost", trackBy: "screenTime", shareWithFriends: true }),
    g("call", { title: "Call a friend", category: "social", period: "monthly", target: 4, unit: "times", direction: "atLeast", trackBy: "manual", shareWithFriends: true }),
    g("books", { title: "Read 24 books", category: "custom", period: "yearly", target: 24, unit: "books", direction: "atLeast", trackBy: "manual", shareWithFriends: false }),
  ];

  const logs: GoalLog[] = [];
  let n = 0;
  const log = (goalId: string, date: Date, amount: number, source: GoalLog["source"]) =>
    logs.push({ id: `${userId}_seedlog_${n++}`, goalId: `${userId}_${goalId}`, userId, amount, date: toISODate(date), source, createdAt: date.getTime() });

  const now = new Date();
  for (let i = 119; i >= 0; i--) {
    const d = addDays(now, -i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    // Habit gets better over time: later days hit more often.
    const momentum = 0.55 + 0.35 * ((119 - i) / 119);
    if (rand() < (weekend ? momentum * 0.5 : momentum)) log("library", d, Math.round(40 + rand() * 110), "seed");
    if (!weekend && rand() < 0.6) log("psets", d, 1, "seed");
    if (rand() < 0.42) log("run", d, 1, "seed");
    log("screen", d, Math.round(120 + rand() * 120 - momentum * 30), "seed");
    if (rand() < 0.17) log("call", d, 1, "seed");
    if (rand() < 0.07) log("books", d, 1, "seed");
  }
  return { goals, logs };
}

/**
 * The demo phone's goal: three runs so far this week, so logging one more on
 * stage reaches it (confetti, and Maya's agent posts the win). Matches Maya's
 * goal in the server seed. Runs are dated this week even early on a Monday.
 */
function mayaGoal(): { goal: Goal; logs: GoalLog[] } {
  const goal: Goal = {
    id: "g_maya_run",
    userId: "u_maya",
    title: "Run 4 times this week",
    category: "fitness",
    period: "weekly",
    target: 4,
    unit: "times",
    direction: "atLeast",
    trackBy: "manual",
    shareWithFriends: true,
    archived: false,
    createdAt: Date.now(),
  };
  const now = new Date();
  const weekStart = periodStart(now, "weekly");
  const logs = [2, 1, 0].map((back, i): GoalLog => {
    const day = addDays(now, -back);
    return {
      id: `l_maya_run_${i}`,
      goalId: goal.id,
      userId: "u_maya",
      amount: 1,
      date: toISODate(day < weekStart ? weekStart : day),
      source: "manual",
      createdAt: Date.now(),
    };
  });
  return { goal, logs };
}

export function seedDB(version: number): DB {
  const demoSalt = "demo-salt";
  // Maya, Jordan and Sam can log in too (same password) so each demo phone is a different friend.
  const demoLogin = { salt: demoSalt, passwordHash: hashPassword(DEMO_PASSWORD, demoSalt) };
  const users: User[] = [
    seedUser({
      id: "u_demo",
      username: DEMO_USERNAME,
      displayName: "Riley Demo",
      email: "riley@example.com",
      bio: "New grad in SF. Will trade a library seat for a run buddy.",
      city: "San Francisco, CA",
      avatar: { emoji: "📚", color: "#2a78d6" },
      passwordHash: hashPassword(DEMO_PASSWORD, demoSalt),
      salt: demoSalt,
      isSeed: false,
    }),
    seedUser({ ...demoLogin, id: "u_maya", username: "maya_runs", displayName: "Maya Chen", email: "maya@example.com", phone: "+15125550101", city: "Austin, TX", timezone: "America/Chicago", bio: "Training for my first half marathon.", avatar: { emoji: "🏃‍♀️", color: "#eb6834" } }),
    seedUser({ ...demoLogin, id: "u_jordan", username: "jordanp", displayName: "Jordan Park", email: "jordan@example.com", phone: "+12125550102", city: "New York, NY", timezone: "America/New_York", bio: "Law school survivor. Coffee-powered.", avatar: { emoji: "⚖️", color: "#6250d6" } }),
    seedUser({ ...demoLogin, id: "u_sam", username: "sam_l", displayName: "Sam Lee", email: "sam@example.com", phone: "+12065550103", city: "Seattle, WA", bio: "Finds the weirdest places on weekends.", avatar: { emoji: "🦙", color: "#1baf7a" } }),
    seedUser({ id: "u_priya", username: "priya.k", displayName: "Priya Kumar", email: "priya@example.com", phone: "+13125550104", city: "Berkeley, CA", bio: "PhD year 1 at Berkeley. Just moved, show me your spots.", avatar: { emoji: "🩺", color: "#e34948" } }),
    seedUser({ id: "u_alex", username: "alexr", displayName: "Alex Rivera", email: "alex@example.com", phone: "+16175550105", city: "Boston, MA", timezone: "America/New_York", bio: "Climbing, cooking, consulting.", avatar: { emoji: "🧗", color: "#008300" } }),
  ];

  const demoPerms = defaultPermissions("u_demo");
  demoPerms.calendars.google = { connected: true, account: "riley@example.com", connectedAt: Date.now() };
  demoPerms.location = "granted";
  demoPerms.photos = "granted";
  demoPerms.screenTime = "screenshot";

  const connections = [
    { id: "c_1", fromId: "u_demo", toId: "u_maya", status: "accepted" as const, createdAt: Date.now() },
    { id: "c_2", fromId: "u_jordan", toId: "u_demo", status: "accepted" as const, createdAt: Date.now() },
    { id: "c_3", fromId: "u_demo", toId: "u_sam", status: "accepted" as const, createdAt: Date.now() },
    { id: "c_4", fromId: "u_priya", toId: "u_demo", status: "pending" as const, createdAt: Date.now() },
  ];

  const demo = sampleGoalsFor("u_demo");
  const maya = mayaGoal();
  const goals = [...demo.goals, maya.goal];
  const logs = [...demo.logs, ...maya.logs];
  const mayaShare = defaultSharing("u_demo", "u_maya");
  mayaShare.categories.fitness = true;
  mayaShare.categories.photos = true;
  mayaShare.frequency = "realtime";
  const jordanShare = defaultSharing("u_demo", "u_jordan");
  jordanShare.frequency = "weekly";
  jordanShare.roastOk = true;
  jordanShare.categories.screenTime = true;
  const samShare = defaultSharing("u_demo", "u_sam");
  samShare.categories.places = true;
  samShare.categories.photos = true;

  return {
    users,
    permissions: [demoPerms],
    connections,
    sharing: [mayaShare, jordanShare, samShare],
    goals,
    logs,
    session: { userId: null },
    version,
  };
}
