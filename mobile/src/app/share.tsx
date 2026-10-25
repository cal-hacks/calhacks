import { useState, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import * as Calendar from "expo-calendar";
import * as Clipboard from "expo-clipboard";
import { AGENT_URL, agentPost, connectGoogleCalendar, pickPhotoPlace, pickScreenshot, syncBusyTimes } from "../lib/agentApi";
import { ingestToken, setConsent, useLive } from "../lib/live";
import { healthKitAvailable, syncHealth } from "../lib/health";
import { Button, Card, ErrorText, Eyebrow, Input, Screen, Segmented, Txt } from "../components/ui";
import { useColors } from "../components/theme";

type Level = "highlights" | "planning_only" | "off";

const SOURCES: { key: string; label: string; icon: string; hint: string }[] = [
  { key: "health", label: "Health", icon: "🏃", hint: "Steps, sleep and workouts from the Health Shortcut" },
  { key: "screen_time", label: "Screen Time", icon: "📱", hint: "Screenshots you upload" },
  { key: "photos", label: "Photos", icon: "📸", hint: "Places from photos you pick" },
  { key: "calendar", label: "Calendar", icon: "📅", hint: "Busy times only, never event details" },
  { key: "canvas", label: "Canvas", icon: "📚", hint: "Upcoming deadlines" },
];

const LEVELS: { key: Level; label: string }[] = [
  { key: "highlights", label: "Share wins" },
  { key: "planning_only", label: "Planning" },
  { key: "off", label: "Off" },
];

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Real data for your agent: consent per source, and a way in for each one. */
export default function ShareScreen() {
  const live = useLive();
  const level = (source: string): Level =>
    (live.myConsent.find((c) => c.source === source)?.shareLevel as Level | undefined) ?? "off";

  if (live.status !== "ready") {
    return (
      <Screen header>
        <Card><Txt muted>{live.status === "error" ? live.error : "Connecting to your group…"}</Txt></Card>
      </Screen>
    );
  }

  return (
    <Screen header>
      <Txt muted>
        What your agent may use. Share wins lets it post highlights; Planning keeps the data private and uses it only to
        find times that work.
      </Txt>
      <Card style={{ gap: 14 }}>
        {SOURCES.map((s) => (
          <View key={s.key} style={{ gap: 6 }}>
            <Txt bold>{s.icon}  {s.label}</Txt>
            <Txt small muted>{s.hint}</Txt>
            <Segmented value={level(s.key)} options={LEVELS} onChange={(l) => setConsent(s.key, l).catch(() => {})} />
          </View>
        ))}
      </Card>

      <CalendarCard off={level("calendar") === "off"} />
      <ScreenTimeCard off={level("screen_time") === "off"} />
      <PhotoCard on={level("photos") === "highlights"} />
      <HealthCard off={level("health") === "off"} />
      <CanvasCard off={level("canvas") === "off"} />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
    </Card>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

function Result({ error, done }: { error: string | null; done: string | null }) {
  const c = useColors();
  if (error) return <ErrorText>{error}</ErrorText>;
  return done ? <Txt small style={{ color: c.good }}>{done}</Txt> : null;
}

function OffNote({ show, what }: { show: boolean; what: string }) {
  const c = useColors();
  return show ? <Txt small style={{ color: c.warn }}>{what} is off above.</Txt> : null;
}

function CalendarCard({ off }: { off: boolean }) {
  const a = useAction();
  const google = useAction();
  const sync = () =>
    a.run(async () => {
      if (Platform.OS === "web") throw new Error("Calendar sync runs on the phone.");
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") throw new Error("Calendar access is off. Allow it in Settings → Orbit.");
      const result = await syncBusyTimes();
      if (result === "skipped") throw new Error("Calendar sharing is off above.");
      return result && "Sent this week's busy times. Plans will fit around them.";
    });
  const connectGoogle = () =>
    google.run(async () => {
      const account = await connectGoogleCalendar();
      return account && `Connected ${account}. Free/busy refreshes every 15 minutes.`;
    });
  return (
    <Section title="📅 Calendar">
      <Txt small muted>
        Your agent only sees busy times, never titles or details, so the coordinator suggests times that actually work.
      </Txt>
      <OffNote show={off} what="Calendar" />
      <Button variant="secondary" title="Connect Google Calendar" onPress={connectGoogle} loading={google.busy} disabled={off} />
      <Result error={google.error} done={google.done} />
      <Txt small muted>Or use every calendar on this phone (iCloud, Outlook, Google). It refreshes whenever you open the app.</Txt>
      <Button variant="secondary" title="Sync this phone's calendars" onPress={sync} loading={a.busy} disabled={off} />
      <Result error={a.error} done={a.done} />
    </Section>
  );
}

function ScreenTimeCard({ off }: { off: boolean }) {
  const a = useAction();
  const upload = () =>
    a.run(async () => {
      const image = await pickScreenshot();
      if (!image) return null;
      const r = await agentPost<{ stored: { daily_avg_hours: number; top_apps: string[]; pickups: number | null } }>("/ingest/screen-time", image);
      const s = r.stored;
      return `Read ${s.daily_avg_hours}h a day${s.top_apps.length ? ` · top: ${s.top_apps.slice(0, 3).join(", ")}` : ""}${s.pickups != null ? ` · ${s.pickups} pickups` : ""}`;
    });
  return (
    <Section title="📱 Screen Time">
      <Txt small muted>
        Upload a screenshot of Settings → Screen Time. Claude reads the daily average and top apps. Least screen time in the
        group gets a brag; "most" is only posted if you allowed roasts.
      </Txt>
      <OffNote show={off} what="Screen Time" />
      <Button variant="secondary" title="Upload screenshot" onPress={upload} loading={a.busy} disabled={off} />
      <Result error={a.error} done={a.done} />
    </Section>
  );
}

function PhotoCard({ on }: { on: boolean }) {
  const c = useColors();
  const a = useAction();
  const [needPlace, setNeedPlace] = useState<{ taken_at?: string } | null>(null);
  const [place, setPlace] = useState("");

  const send = (body: Record<string, unknown>) =>
    a.run(async () => {
      const r = await agentPost<{ place_name: string; caption: string; obscurity_score: number }>("/ingest/photo", body);
      setNeedPlace(null);
      setPlace("");
      return `${r.place_name}: "${r.caption}" (unusual: ${Math.round(r.obscurity_score * 100)}%)`;
    });

  const pick = async () => {
    const p = await pickPhotoPlace().catch(() => null);
    if (!p) return;
    // No GPS (often stripped): ask for the place instead.
    if (p.lat !== undefined && p.lng !== undefined) await send(p);
    else setNeedPlace({ taken_at: p.taken_at });
  };

  return (
    <Section title="📸 Weirdest place">
      <Txt small muted>
        Pick a photo from somewhere fun. Only its location and time are sent; the photo stays on your phone. If the place is
        unusual enough, your agent posts it as the weirdest place of the week.
      </Txt>
      {!on && <Txt small style={{ color: c.warn }}>Set Photos to "Share wins" above to use this.</Txt>}
      <Button variant="secondary" title="Choose photo" onPress={pick} loading={a.busy} disabled={!on} />
      {needPlace && (
        <View style={{ gap: 8 }}>
          <Input label="No location in that photo. Where was it?" value={place} onChangeText={setPlace} maxLength={120} placeholder="e.g. Llama farm in Snohomish" />
          <Button small title="Add place" onPress={() => send({ place_name: place.trim(), taken_at: needPlace.taken_at })} disabled={!place.trim()} />
        </View>
      )}
      <Result error={a.error} done={a.done} />
    </Section>
  );
}

function HealthCard({ off }: { off: boolean }) {
  const c = useColors();
  const a = useAction();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const native = healthKitAvailable();
  const show = () => ingestToken().then(setToken).catch(() => setToken(null));
  const sync = () =>
    a.run(async () => {
      const stored = await syncHealth({ force: true });
      if (stored === null) throw new Error("Health access is off. Allow it in Settings → Health → Data Access & Devices → Orbit.");
      return stored.length ? `Sent ${stored.join(", ")}. It syncs again when you open Orbit.` : "Nothing new since the last sync.";
    });

  return (
    <Section title="🏃 Apple Health">
      <Txt small muted>
        Today's steps, last night's sleep and workouts. Sleep is only ever used privately; workouts and big step days can
        become highlights.
      </Txt>
      <OffNote show={off} what="Health" />
      {native ? (
        <>
          <Button variant="secondary" title="Sync Apple Health" onPress={sync} loading={a.busy} disabled={off} />
          <Result error={a.error} done={a.done} />
        </>
      ) : !token ? (
        <>
          <Txt small muted>This build can't read Health directly (Expo Go), so use an iOS Shortcut instead.</Txt>
          <Button variant="secondary" title="Set up the Shortcut" onPress={show} />
        </>
      ) : (
        <View style={{ gap: 6 }}>
          <Txt small>1. In Shortcuts, find today's Steps, last night's Sleep Analysis and today's Workouts.</Txt>
          <Txt small>2. Add "Get Contents of URL": POST to</Txt>
          <Text selectable style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, color: c.text }}>{AGENT_URL}/ingest/health</Text>
          <Txt small>with header Authorization: Bearer (your token) and a JSON body like {'{"steps": 8123, "sleep": [{"start": "…", "end": "…"}], "workouts": [{"kind": "run", "minutes": 30}]}'}</Txt>
          <Txt small>3. Add a daily Personal Automation that runs it each morning.</Txt>
          <Button
            small
            variant="secondary"
            title={copied ? "Token copied" : "Copy my token"}
            onPress={() => Clipboard.setStringAsync(token).then(() => setCopied(true))}
          />
          <Txt small muted>Keep the token private: it lets anyone send data as you.</Txt>
        </View>
      )}
    </Section>
  );
}

function CanvasCard({ off }: { off: boolean }) {
  const a = useAction();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const connect = () =>
    a.run(async () => {
      await agentPost("/canvas/token", { base_url: url.trim(), token: token.trim() });
      setToken("");
      return "Connected. Deadlines refresh every hour.";
    });
  return (
    <Section title="📚 Canvas">
      <Txt small muted>
        Your agent checks upcoming deadlines hourly. Three or more in a week counts as a heavy week, which the coordinator
        plans around. Make a token in Canvas → Account → Settings → New access token.
      </Txt>
      <OffNote show={off} what="Canvas" />
      <Input placeholder="https://canvas.yourschool.edu" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" editable={!off} />
      <Input placeholder="Access token" value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" editable={!off} />
      <Button variant="secondary" title="Connect Canvas" onPress={connect} loading={a.busy} disabled={off || !url.trim() || !token.trim()} />
      <Result error={a.error} done={a.done} />
    </Section>
  );
}
