import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { agentPost } from "./agentApi";

// Apple Health, read straight from HealthKit. The native module needs a
// development build (npx expo run:ios); in Expo Go and on web it's missing,
// and the Share screen offers the iOS Shortcut instead.

type HK = typeof import("@kingstinct/react-native-healthkit");
let hk: HK | null | undefined;

function lib(): HK | null {
  if (hk !== undefined) return hk;
  if (Platform.OS !== "ios" || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return (hk = null);
  try {
    hk = require("@kingstinct/react-native-healthkit") as HK;
  } catch {
    hk = null;
  }
  return hk;
}

export function healthKitAvailable(): boolean {
  const h = lib();
  try {
    return !!h && h.isHealthDataAvailable();
  } catch {
    return false;
  }
}

const READ = [
  "HKQuantityTypeIdentifierStepCount",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKWorkoutTypeIdentifier",
] as const;

/** Shows Apple's Health permission sheet the first time; later calls return at once. */
export async function requestHealthAccess(): Promise<boolean> {
  const h = lib();
  if (!h) return false;
  return h.requestAuthorization({ toRead: READ });
}

// HKCategoryValueSleepAnalysis: 1 asleep (unspecified), 3 core, 4 deep, 5 REM.
// 0 is in bed and 2 is awake, which don't count as sleep.
const ASLEEP = new Set([1, 3, 4, 5]);

// HKWorkoutActivityType values for the workouts people mostly log.
const ACTIVITY: Record<number, string> = {
  6: "basketball", 9: "climbing", 13: "cycling", 14: "dance", 24: "hiking", 37: "run",
  41: "soccer", 46: "swim", 48: "tennis", 50: "strength training", 52: "walk", 57: "yoga",
};

export interface HealthToday {
  steps?: number;
  sleep: { start: string; end: string }[];
  workouts: { kind: string; minutes: number; distance_km?: number; start: string }[];
}

/** Today's steps, last night's sleep and today's workouts. */
export async function readHealthToday(now = new Date()): Promise<HealthToday | null> {
  const h = lib();
  if (!h) return null;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  // Last night: from 6 PM yesterday until now.
  const evening = new Date(midnight.getTime() - 6 * 3600 * 1000);

  const steps = await h.queryStatisticsForQuantity("HKQuantityTypeIdentifierStepCount", ["cumulativeSum"], {
    filter: { date: { startDate: midnight, endDate: now } },
    unit: "count",
  });
  const sleep = await h.queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
    limit: 0,
    filter: { date: { startDate: evening, endDate: now } },
  });
  const workouts = await h.queryWorkoutSamples({ limit: 20, filter: { date: { startDate: midnight, endDate: now } } });

  return {
    steps: steps.sumQuantity?.quantity,
    sleep: sleep
      .filter((s) => ASLEEP.has(Number(s.value)))
      .map((s) => ({ start: new Date(s.startDate).toISOString(), end: new Date(s.endDate).toISOString() })),
    workouts: workouts.map((w) => {
      const meters = w.totalDistance?.unit === "km" ? w.totalDistance.quantity * 1000 : w.totalDistance?.quantity;
      const minutes = w.duration.unit === "min" ? w.duration.quantity : w.duration.quantity / 60;
      return {
        kind: ACTIVITY[Number(w.workoutActivityType)] ?? "workout",
        minutes: Math.round(minutes),
        ...(meters ? { distance_km: Math.round(meters / 10) / 100 } : {}),
        start: new Date(w.startDate).toISOString(),
      };
    }),
  };
}

const SENT_KEY = "orbit.health.sent";
const MIN_GAP_MS = 30 * 60 * 1000;

interface Sent {
  at: number;
  /** Start times of workouts already sent. */
  workouts: string[];
  /** End of the last night already sent. */
  sleepEnd?: string;
}

async function readSent(): Promise<Sent> {
  try {
    return { at: 0, workouts: [], ...JSON.parse((await AsyncStorage.getItem(SENT_KEY)) ?? "{}") };
  } catch {
    return { at: 0, workouts: [] };
  }
}

/**
 * Send today's Health data to the agent service (the same endpoint the
 * Shortcut uses): the step count, plus workouts and a night of sleep that
 * weren't sent before. Automatic syncs (`force` false) run at most every 30
 * minutes. Returns what was stored, or null without HealthKit access.
 */
export async function syncHealth({ force = false } = {}): Promise<string[] | null> {
  if (!healthKitAvailable()) return null;
  const sent = await readSent();
  if (!force && Date.now() - sent.at < MIN_GAP_MS) return [];
  if (!(await requestHealthAccess())) return null;
  const today = await readHealthToday();
  if (!today) return null;

  const workouts = today.workouts.filter((w) => !sent.workouts.includes(w.start));
  const sleepEnd = today.sleep.map((s) => s.end).sort().at(-1);
  const newNight = sleepEnd !== undefined && sleepEnd !== sent.sleepEnd;
  const body: Record<string, unknown> = { workouts, sleep: newNight ? today.sleep : [] };
  if (today.steps !== undefined) body.steps = today.steps;

  const r = await agentPost<{ stored: string[] }>("/ingest/health", body);
  const next: Sent = {
    at: Date.now(),
    workouts: [...sent.workouts, ...workouts.map((w) => w.start)].slice(-50),
    sleepEnd: newNight ? sleepEnd : sent.sleepEnd,
  };
  await AsyncStorage.setItem(SENT_KEY, JSON.stringify(next)).catch(() => {});
  return r.stored;
}
