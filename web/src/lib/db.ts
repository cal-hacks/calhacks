import { useSyncExternalStore } from "react";
import type { DB } from "./types";
import { seedDB } from "./seed";

// Local, localStorage-backed stand-in for the SpacetimeDB module. Components
// read through useDB() (like a subscription) and write only through api.ts
// (like reducer calls), so swapping in the SpacetimeDB client touches only
// this file and api.ts.

const STORAGE_KEY = "orbit.db";
const DB_VERSION = 1;

type Listener = () => void;
const listeners = new Set<Listener>();

function load(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch {
    // Storage blocked or corrupt; fall through to a fresh seed.
  }
  return seedDB(DB_VERSION);
}

let state: DB = load();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private mode: keep working in memory.
  }
}

export function getDB(): DB {
  return state;
}

/** Apply an immutable update and notify subscribers. */
export function mutate(fn: (db: DB) => DB) {
  state = fn(state);
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
  return () => listeners.delete(l);
}

// Keep tabs in sync so two windows behave like two live clients.
window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  try {
    state = JSON.parse(e.newValue) as DB;
    listeners.forEach((l) => l());
  } catch {
    // Ignore partial writes from the other tab.
  }
});

export function useDB(): DB {
  return useSyncExternalStore(subscribe, getDB);
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
