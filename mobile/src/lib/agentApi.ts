import * as Calendar from "expo-calendar";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { devHost } from "./devHost";
import { forgetIngestToken, ingestToken } from "./live";

// Calls to the agent service (agent/) as the signed-in friend. Requests carry
// the friend's ingest token; the service only stores its hash.

/** Default in development: port 8000 on the Mac running Expo (see devHost.ts). */
export const AGENT_URL: string | undefined =
  process.env.EXPO_PUBLIC_AGENT_API_URL || (__DEV__ ? `http://${devHost()}:8000` : undefined);

export class AgentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * POST JSON as this friend. A 401 means the service doesn't know our token
 * (e.g. after reset_demo), so make a new one and try once more.
 */
export async function agentPost<T = unknown>(path: string, body: unknown): Promise<T> {
  if (!AGENT_URL) throw new AgentError("The agent service URL isn't configured (EXPO_PUBLIC_AGENT_API_URL).", 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await ingestToken();
    if (!token) throw new AgentError("Still joining your group. Try again in a moment.", 0);
    let r: Response;
    try {
      r = await fetch(`${AGENT_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AgentError(`Can't reach the agent service at ${AGENT_URL}.`, 0);
    }
    if (r.status === 401) {
      await forgetIngestToken();
      continue;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new AgentError(typeof data.detail === "string" ? data.detail : `Agent service error ${r.status}`, r.status);
    return data as T;
  }
  throw new AgentError("The agent service didn't accept this phone. Try signing out and in.", 401);
}

// ---------- calendar ----------

const BUSY_DAYS = 8;

/**
 * Busy times for the next week from every calendar on this phone (iCloud,
 * Google, Outlook). Only start and end times leave the phone. All-day events
 * and events marked "free" don't count as busy.
 */
export async function readBusyTimes(): Promise<{ start: string; end: string }[] | null> {
  if (Platform.OS === "web") return null;
  const { status } = await Calendar.getCalendarPermissionsAsync();
  if (status !== "granted") return null;
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const start = new Date();
  const end = new Date(start.getTime() + BUSY_DAYS * 24 * 3600 * 1000);
  const events = await Calendar.getEventsAsync(calendars.map((c) => c.id), start, end);
  return events
    .filter((e) => !e.allDay && e.availability !== Calendar.Availability.FREE)
    .map((e) => ({ start: new Date(e.startDate).toISOString(), end: new Date(e.endDate).toISOString() }));
}

/** Send this week's busy times so the coordinator plans around them. */
export async function syncBusyTimes(): Promise<number | null> {
  const busy = await readBusyTimes();
  if (!busy) return null;
  const r = await agentPost<{ free_blocks: number }>("/ingest/busy", { busy });
  return r.free_blocks;
}

// ---------- photos and screenshots ----------

type Exif = Record<string, unknown> | null | undefined;

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** GPS from image-picker EXIF: iOS nests it under {GPS} with N/S/E/W refs. */
export function gpsFromExif(exif: Exif): { lat: number; lng: number } | null {
  if (!exif) return null;
  const gps = (exif["{GPS}"] as Record<string, unknown> | undefined) ?? exif;
  let lat = num(gps.Latitude) ?? num(gps.GPSLatitude);
  let lng = num(gps.Longitude) ?? num(gps.GPSLongitude);
  if (lat === undefined || lng === undefined) return null;
  const latRef = gps.LatitudeRef ?? gps.GPSLatitudeRef;
  const lngRef = gps.LongitudeRef ?? gps.GPSLongitudeRef;
  if (latRef === "S" && lat > 0) lat = -lat;
  if (lngRef === "W" && lng > 0) lng = -lng;
  return { lat, lng };
}

/** "2026:10:24 14:03:11" (EXIF) as ISO, if present. */
export function takenAtFromExif(exif: Exif): string | undefined {
  const raw = (exif?.["{Exif}"] as Record<string, unknown> | undefined)?.DateTimeOriginal ?? exif?.DateTimeOriginal;
  if (typeof raw !== "string") return undefined;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`).toISOString() : undefined;
}

/** Pick a photo; returns its location and time only (the image stays on the phone). */
export async function pickPhotoPlace(): Promise<{ lat?: number; lng?: number; taken_at?: string } | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], exif: true, quality: 0.2 });
  if (res.canceled || !res.assets[0]) return null;
  const exif = res.assets[0].exif as Exif;
  return { ...(gpsFromExif(exif) ?? {}), taken_at: takenAtFromExif(exif) };
}

/** Pick a Screen Time screenshot as base64 for Claude to read. */
export async function pickScreenshot(): Promise<{ media_type: string; data: string } | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
  const asset = res.canceled ? undefined : res.assets[0];
  if (!asset?.base64) return null;
  const type = asset.mimeType && ["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) ? asset.mimeType : "image/jpeg";
  return { media_type: type, data: asset.base64 };
}
