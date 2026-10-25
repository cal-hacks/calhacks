import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DB } from "./types";
import { seedDB } from "./seed";

// On-device stand-in for the SpacetimeDB module. Screens read through useDB()
// (like a subscription) and write only through api.ts (like reducer calls),
// so swapping in the SpacetimeDB client touches only this file and api.ts.

const STORAGE_KEY = "orbit.db";
// Bumped when the seed changes so old installs pick up the new one.
const DB_VERSION = 2;

type Listener = () => void;
const listeners = new Set<Listener>();

let state: DB | null = null;
let hydrating: Promise<void> | null = null;

/** Load saved state once at launch; seeds on first run. */
export function hydrate(): Promise<void> {
  hydrating ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as DB) : null;
      state = parsed?.version === DB_VERSION ? parsed : seedDB(DB_VERSION);
    } catch {
      state = seedDB(DB_VERSION);
    }
    listeners.forEach((l) => l());
  })();
  return hydrating;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  // Coalesce bursts of writes (e.g. "apply to all friends") into one save.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, 150);
}

export function getDB(): DB {
  if (!state) throw new Error("DB read before hydrate()");
  return state;
}

/** Apply an immutable update and notify subscribers. */
export function mutate(fn: (db: DB) => DB) {
  state = fn(getDB());
  persist();
  listeners.forEach((l) => l());
}

export function resetDB() {
  state = seedDB(DB_VERSION);
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDB(): DB {
  return useSyncExternalStore(subscribe, getDB);
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => state !== null);
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
