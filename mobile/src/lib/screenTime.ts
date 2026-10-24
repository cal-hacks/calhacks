import { Platform } from "react-native";
import Constants from "expo-constants";
import { getDB } from "./db";
import { setTrackedAmount } from "./api";
import { today } from "./dates";

// Apple Screen Time via FamilyControls + DeviceActivity
// (react-native-device-activity). Apple never hands apps raw usage numbers,
// so we schedule "reached N minutes" threshold events over the apps the user
// picks; the DeviceActivityMonitor extension records which ones fired, and the
// highest one today is the user's screen time, rounded down to the step size.

const ACTIVITY = "orbit_screen_time";
export const SELECTION_ID = "orbit_tracked_apps";

/** True when this build includes the extensions (APPLE_TEAM_ID set at build time) and runs on iOS 16+. */
export const screenTimeNative =
  Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 16 && Constants.expoConfig?.extra?.screenTimeNative === true;

type Lib = typeof import("react-native-device-activity");
let lib: Lib | null = null;
/** Loaded lazily so builds without the extensions never touch the native module. */
export function deviceActivity(): Lib | null {
  if (!screenTimeNative) return null;
  lib ??= require("react-native-device-activity") as Lib;
  return lib.isAvailable() ? lib : null;
}

export type ScreenTimeStatus = "unavailable" | "notDetermined" | "denied" | "approved";

export function screenTimeStatus(): ScreenTimeStatus {
  const da = deviceActivity();
  if (!da) return "unavailable";
  const s = da.getAuthorizationStatus();
  return s === da.AuthorizationStatus.approved ? "approved" : s === da.AuthorizationStatus.denied ? "denied" : "notDetermined";
}

/** Shows Apple's Screen Time permission sheet. */
export async function requestScreenTime(): Promise<ScreenTimeStatus> {
  const da = deviceActivity();
  if (!da) return "unavailable";
  await da.requestAuthorization("individual");
  // The status can lag a moment behind the user's choice.
  await da.pollAuthorizationStatus({ pollIntervalMs: 300, maxAttempts: 10 }).catch(() => {});
  return screenTimeStatus();
}

/** 15-minute steps up to 4h, 30-minute steps to 8h, then hourly to 16h. */
const THRESHOLDS = [
  ...Array.from({ length: 16 }, (_, i) => (i + 1) * 15),
  ...Array.from({ length: 8 }, (_, i) => 240 + (i + 1) * 30),
  ...Array.from({ length: 8 }, (_, i) => 480 + (i + 1) * 60),
];

export function hasTrackedApps(): boolean {
  return !!deviceActivity()?.getFamilyActivitySelectionId(SELECTION_ID);
}

/** (Re)start daily monitoring of the selected apps. Call after the user picks apps. */
export async function startScreenTimeTracking(): Promise<boolean> {
  const da = deviceActivity();
  const selection = da?.getFamilyActivitySelectionId(SELECTION_ID);
  if (!da || !selection) return false;
  da.stopMonitoring([ACTIVITY]);
  await da.startMonitoring(
    ACTIVITY,
    { intervalStart: { hour: 0, minute: 0, second: 0 }, intervalEnd: { hour: 23, minute: 59, second: 59 }, repeats: true },
    THRESHOLDS.map((m) => ({
      eventName: `minutes_${m}`,
      familyActivitySelection: selection,
      threshold: { hour: Math.floor(m / 60), minute: m % 60 },
    })),
  );
  return true;
}

/** Screen time so far today in minutes (a lower bound), or null if not tracking. */
export function screenTimeMinutesToday(): number | null {
  const da = deviceActivity();
  if (!da || !hasTrackedApps()) return null;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let max = 0;
  for (const e of da.getEvents(ACTIVITY)) {
    if (e.callbackName !== "eventDidReachThreshold" || !e.eventName) continue;
    if (new Date(e.lastCalledAt) < startOfDay) continue;
    const m = Number(e.eventName.replace("minutes_", ""));
    if (m > max) max = m;
  }
  return max;
}

/** Write today's Screen Time reading into every Screen Time-tracked goal. */
export function syncScreenTimeGoals() {
  const minutes = screenTimeMinutesToday();
  if (minutes === null) return;
  const db = getDB();
  const me = db.session.userId;
  if (!me) return;
  for (const g of db.goals.filter((x) => x.userId === me && !x.archived && x.trackBy === "screenTime")) {
    const amount = g.unit === "hours" ? minutes / 60 : g.unit === "minutes" ? minutes : null;
    if (amount !== null) setTrackedAmount(g.id, today(), amount, "screenTime");
  }
}
