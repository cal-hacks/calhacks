import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Calendar from "expo-calendar";
import * as Contacts from "expo-contacts";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import type { AppleProfile, ContactEntry, GoogleProfile } from "./api";
import type { CalendarProvider } from "./types";

// Native glue for sign-in, device permissions, contacts and calendars.

export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const googleConfigured = !!GOOGLE_IOS_CLIENT_ID;

// Loaded only when configured: the native module isn't in Expo Go or on web.
type GoogleLib = typeof import("@react-native-google-signin/google-signin");
let google: GoogleLib | null = null;
function googleLib(): GoogleLib {
  if (!google) {
    google = require("@react-native-google-signin/google-signin") as GoogleLib;
    google.GoogleSignin.configure({ iosClientId: GOOGLE_IOS_CLIENT_ID, webClientId: GOOGLE_WEB_CLIENT_ID });
  }
  return google;
}

/** Native Google sign-in. Returns null if the user cancels. */
export async function googleSignIn(): Promise<GoogleProfile | null> {
  const { GoogleSignin, isSuccessResponse } = googleLib();
  await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res)) return null;
  const u = res.data.user;
  return { sub: u.id, email: u.email, name: u.name ?? u.email, picture: u.photo ?? undefined };
}

export function appleSignInAvailable(): Promise<boolean> {
  return Platform.OS === "ios" ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false);
}

/** Native Sign in with Apple. Returns null if the user cancels. */
export async function appleSignIn(): Promise<AppleProfile | null> {
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(" ");
    return { user: cred.user, email: cred.email, name: name || null };
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return null;
    throw e;
  }
}

// ---------- calendars ----------

export interface DetectedCalendarAccount {
  provider: CalendarProvider | "other";
  account: string;
  calendars: number;
}

function providerFor(sourceName: string, sourceType: string | undefined): CalendarProvider | "other" {
  const n = sourceName.toLowerCase();
  if (n.includes("icloud") || n === "default") return "apple";
  if (n.includes("gmail") || n.includes("google")) return "google";
  if (sourceType === "exchange" || n.includes("outlook") || n.includes("hotmail") || n.includes("live.com") || n.includes("office")) return "outlook";
  return "other";
}

/**
 * iOS keeps every calendar account the user has added (iCloud, Google,
 * Outlook/Exchange) in one store, so a single permission covers them all.
 */
export async function requestCalendarAccess(): Promise<{ granted: boolean; accounts: DetectedCalendarAccount[] }> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== "granted") return { granted: false, accounts: [] };
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const byAccount = new Map<string, DetectedCalendarAccount>();
  for (const c of calendars) {
    const name = c.source?.name ?? "On this iPhone";
    const type = typeof c.source?.type === "string" ? c.source.type : undefined;
    if (type === "birthdays" || type === "subscribed") continue;
    const entry = byAccount.get(name) ?? { provider: providerFor(name, type), account: name, calendars: 0 };
    entry.calendars++;
    byAccount.set(name, entry);
  }
  return { granted: true, accounts: [...byAccount.values()] };
}

// ---------- location & photos ----------

export async function requestLocation(): Promise<"granted" | "denied"> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted" ? "granted" : "denied";
}

export async function requestPhotos(): Promise<"granted" | "denied"> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === "granted" ? "granted" : "denied";
}

/** Pick and square-crop a profile photo, downscaled so it stores comfortably. */
export async function pickAvatar(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (res.canceled || !res.assets[0]) return null;
  const rendered = await ImageManipulator.ImageManipulator.manipulate(res.assets[0].uri).resize({ width: 256 }).renderAsync();
  const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.8, base64: true });
  return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : saved.uri;
}

// ---------- contacts ----------

export async function readContacts(): Promise<{ granted: boolean; contacts: ContactEntry[] }> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== "granted") return { granted: false, contacts: [] };
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers],
  });
  const contacts = data.flatMap((c) => {
    const name = c.name;
    return [
      ...(c.emails ?? []).map((e) => ({ name, email: e.email })),
      ...(c.phoneNumbers ?? []).map((p) => ({ name, phone: p.number })),
    ];
  });
  return { granted: true, contacts };
}

/** Parse a pasted list of emails and phone numbers. */
export function parseContactsText(text: string): ContactEntry[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => (token.includes("@") ? { email: token } : /\d{7,}/.test(token.replace(/\D/g, "")) ? { phone: token } : { name: token }))
    .filter((c) => c.email || c.phone);
}
