// Shapes mirror the SpacetimeDB tables in calhacks13-plan section 5, so the
// local store in db.ts can be swapped for SpacetimeDB subscriptions later.

export type Id = string;

export type AuthProvider = "password" | "google";

export interface Avatar {
  emoji: string;
  color: string;
  imageDataUrl?: string;
}

export interface User {
  id: Id;
  username: string;
  email?: string;
  phone?: string;
  authProvider: AuthProvider;
  passwordHash?: string;
  salt?: string;
  googleSub?: string;
  displayName: string;
  bio: string;
  city: string;
  timezone: string;
  avatar: Avatar;
  /** Which profile fields friends can see. */
  profileVisibility: { city: boolean; bio: boolean; goals: boolean };
  onboarded: boolean;
  /** Seed users are other people "on the platform" for the demo. */
  isSeed?: boolean;
  /**
   * Set for people mirrored from the live server (other signed-up users): their
   * friend id there. Their `id` is `f_<remoteId>`. They can't log in here.
   */
  remoteId?: string;
  createdAt: number;
}

export type CalendarProvider = "google";
export type PermissionState = "granted" | "denied" | "off";
export type ScreenTimeMethod = "shortcut" | "screenshot" | "off";

export interface Permissions {
  userId: Id;
  calendars: Record<CalendarProvider, { connected: boolean; account?: string; connectedAt?: number }>;
  location: PermissionState;
  photos: PermissionState;
  screenTime: ScreenTimeMethod;
  contacts: PermissionState;
}

/** Things a user can choose to share with an individual friend. */
export type ShareCategory =
  | "photos"
  | "places"
  | "availability"
  | "fitness"
  | "sleep"
  | "screenTime"
  | "checkins"
  | "goals";

export type UpdateFrequency = "realtime" | "daily" | "weekly" | "monthly" | "paused";

export interface Connection {
  id: Id;
  fromId: Id;
  toId: Id;
  status: "pending" | "accepted";
  createdAt: number;
}

/** What `ownerId` shares with `friendId`. One row per direction. */
export interface SharingPrefs {
  ownerId: Id;
  friendId: Id;
  frequency: UpdateFrequency;
  categories: Record<ShareCategory, boolean>;
  /** Per-goal overrides, keyed by goal id. Only goals with shareWithFriends appear. */
  goals: Record<Id, boolean>;
  roastOk: boolean;
}

export type GoalPeriod = "daily" | "weekly" | "monthly" | "yearly";
export type GoalCategory = "study" | "fitness" | "wellness" | "social" | "custom";
export type TrackingSource = "location" | "calendar" | "health" | "screenTime" | "manual";
export type GoalDirection = "atLeast" | "atMost";

export interface Goal {
  id: Id;
  userId: Id;
  title: string;
  category: GoalCategory;
  period: GoalPeriod;
  target: number;
  unit: string;
  direction: GoalDirection;
  trackBy: TrackingSource;
  /** For location goals, e.g. "Green Library". */
  place?: string;
  shareWithFriends: boolean;
  archived: boolean;
  createdAt: number;
}

export interface GoalLog {
  id: Id;
  goalId: Id;
  userId: Id;
  amount: number;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  source: TrackingSource | "seed";
  note?: string;
  createdAt: number;
}

export interface DB {
  users: User[];
  permissions: Permissions[];
  connections: Connection[];
  sharing: SharingPrefs[];
  goals: Goal[];
  logs: GoalLog[];
  session: { userId: Id | null };
  version: number;
}
