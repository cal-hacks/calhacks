import type { CalendarProvider, Id } from "./types";
import type { ContactEntry, GoogleProfile } from "./api";
import { agentPost } from "./agentApi";

// Browser-side glue for third-party sign-in, device permissions and contacts.
// Google Calendar tokens go to the agent service for free/busy (agentApi.ts).
// Outlook/Apple OAuth needs server secrets and only runs when
// VITE_AGENT_API_URL is set.

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const AGENT_API_URL = import.meta.env.VITE_AGENT_API_URL as string | undefined;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
  }
}

let gsiPromise: Promise<void> | null = null;

export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  gsiPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gsiPromise = null;
      reject(new Error("Couldn't load Google sign-in."));
    };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/** Decode the (already Google-verified in production, server-side) ID token payload. */
export function decodeGoogleCredential(credential: string): GoogleProfile {
  const payload = credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(payload)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(""),
  );
  const p = JSON.parse(json);
  return { sub: p.sub, email: p.email, name: p.name ?? p.email, picture: p.picture };
}

export type CalendarConnectResult = { status: "connected"; account: string } | { status: "redirecting" } | { status: "cancelled" };

/**
 * Connect a calendar. Google uses the in-browser token flow when a client ID is
 * configured; other providers go through the agent service's OAuth routes.
 * Without either, it falls back to a demo prompt so the flow is clickable.
 */
export async function connectCalendar(provider: CalendarProvider, userId: Id, emailHint?: string): Promise<CalendarConnectResult> {
  if (provider === "google" && GOOGLE_CLIENT_ID) {
    await loadGoogleIdentity();
    return new Promise((resolve) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/calendar.freebusy email",
        hint: emailHint,
        callback: async (resp: any) => {
          if (resp.error || !resp.access_token) return resolve({ status: "cancelled" });
          let account = emailHint ?? "Google account";
          try {
            const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${resp.access_token}` },
            });
            account = (await r.json()).email ?? account;
          } catch {
            // Non-fatal; keep the hint.
          }
          // Hand the token to the agent service so it can query free/busy.
          // If calendar sharing isn't on yet, the service retries within a minute.
          agentPost("/calendar/google/token", {
            access_token: resp.access_token,
            expires_in: Number(resp.expires_in) || 3600,
          }).catch((e) => console.warn("Orbit calendar sync:", e instanceof Error ? e.message : e));
          resolve({ status: "connected", account });
        },
        error_callback: () => resolve({ status: "cancelled" }),
      });
      client.requestAccessToken();
    });
  }

  if (AGENT_API_URL) {
    const ret = encodeURIComponent(window.location.href.split("?")[0]);
    window.location.href = `${AGENT_API_URL}/oauth/${provider}/start?user_id=${userId}&return_to=${ret}`;
    return { status: "redirecting" };
  }

  const label = { google: "Google", outlook: "Outlook", apple: "iCloud" }[provider];
  const account = window.prompt(`Demo mode: which ${label} account should we connect?`, emailHint ?? "");
  return account ? { status: "connected", account } : { status: "cancelled" };
}

/** Ask the browser for location. Resolves with the permission outcome. */
export function requestLocation(): Promise<"granted" | "denied"> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve("denied");
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      () => resolve("denied"),
      { timeout: 15000, maximumAge: 600000 },
    );
  });
}

export const contactPickerSupported = "contacts" in navigator && "ContactsManager" in window;

/** Native contact picker (Android Chrome). */
export async function pickContacts(): Promise<ContactEntry[]> {
  const picked: any[] = await (navigator as any).contacts.select(["name", "email", "tel"], { multiple: true });
  return picked.flatMap((c) => {
    const name = c.name?.[0];
    const emails: string[] = c.email ?? [];
    const phones: string[] = c.tel ?? [];
    const rows: ContactEntry[] = [
      ...emails.map((email) => ({ name, email })),
      ...phones.map((phone) => ({ name, phone })),
    ];
    return rows.length ? rows : [{ name }];
  });
}

/** Parse a .vcf (iPhone/Mac/Google export) or simple CSV/plain list of emails & phones. */
export function parseContactsText(text: string): ContactEntry[] {
  if (/BEGIN:VCARD/i.test(text)) {
    return text
      .split(/END:VCARD/i)
      .map((card) => {
        const name = card.match(/^FN[^:]*:(.+)$/im)?.[1]?.trim();
        const email = card.match(/^EMAIL[^:]*:(.+)$/im)?.[1]?.trim();
        const phone = card.match(/^TEL[^:]*:(.+)$/im)?.[1]?.trim();
        return { name, email, phone };
      })
      .filter((c) => c.email || c.phone);
  }
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => (token.includes("@") ? { email: token } : /\d{7,}/.test(token.replace(/\D/g, "")) ? { phone: token } : { name: token }))
    .filter((c) => c.email || c.phone);
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Downscale an avatar so it fits comfortably in local storage. */
export async function resizeImage(file: File, size = 256): Promise<string> {
  const url = await readFileAsDataURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = size / Math.max(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * Math.min(1, scale));
  canvas.height = Math.round(img.height * Math.min(1, scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
