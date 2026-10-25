import { useEffect, useState, type ReactNode } from "react";
import { Linking, Platform, View } from "react-native";
import * as Calendar from "expo-calendar";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { Text } from "./Text";
import { AGENT_URL, agentPost, connectGoogleCalendar, syncBusyTimes } from "../lib/agentApi";
import { connectAs, ingestToken, setConsent, useLive } from "../lib/live";
import { healthKitAvailable, requestHealthAccess, syncHealth } from "../lib/health";
import { requestPhotos } from "../lib/integrations";
import { currentUser, setCalendar, setPermissions } from "../lib/api";
import { useDB } from "../lib/db";
import { PermissionCards } from "./PermissionCards";
import { Button, Card, ErrorText, Input, Row, Txt } from "./ui";
import { useColors } from "./theme";

// Guided first-run setup: one source per step, each with the real system
// prompt (Health sheet, photo library, calendar) or sign-in (Google, Canvas).
// Connecting a source also turns on sharing for it, since the agent service
// refuses data for a source that's off.

type Level = "highlights" | "planning_only" | "off";
type StepKey = "calendar" | "health" | "photos" | "canvas" | "more";

const STEPS: { key: StepKey; icon: string; title: string }[] = [
  { key: "calendar", icon: "📅", title: "Calendar" },
  { key: "health", icon: "🏃", title: "Apple Health" },
  { key: "photos", icon: "📸", title: "Photos" },
  { key: "canvas", icon: "📚", title: "Canvas" },
  { key: "more", icon: "📱", title: "Screen Time & location" },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs a setup action: busy state, a success note, or the error. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const note = await fn();
      if (note) setDone(note);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

/** Share `source` at `level` for the duration of `fn`; back to off if it fails or is cancelled. */
async function withConsent(source: string, level: Level, fn: () => Promise<string | null>): Promise<string | null> {
  await setConsent(source, level);
  try {
    const note = await fn();
    if (!note) await setConsent(source, "off");
    return note;
  } catch (e) {
    await setConsent(source, "off").catch(() => {});
    throw e;
  }
}

export function SetupSteps({ onFinish }: { onFinish: () => void }) {
  const c = useColors();
  const me = currentUser(useDB());
  const live = useLive();
  const [step, setStep] = useState(0);
  const [connected, setConnected] = useState<Partial<Record<StepKey, boolean>>>({});

  // Welcome sits outside the tabs, which normally connect: connect here so
  // the agent service knows who this is before any data goes to it.
  useEffect(() => {
    if (me) connectAs(me);
  }, [me]);

  if (live.status !== "ready") {
    return (
      <Card>
        <Txt muted={live.status !== "error"} style={live.status === "error" ? { color: c.warn } : undefined}>
          {live.status === "error" ? live.error : "Setting up your account…"}
        </Txt>
      </Card>
    );
  }

  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const next = () => (last ? onFinish() : setStep(step + 1));
  const markDone = () => setConnected((d) => ({ ...d, [current.key]: true }));

  return (
    <View style={{ gap: 12 }}>
      <Row wrap gap={6}>
        {STEPS.map((s, i) => (
          <View
            key={s.key}
            accessibilityLabel={`${s.title}${connected[s.key] ? ", set up" : ""}`}
            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: i === step ? c.accent : connected[s.key] ? c.goodSoft : c.surface }}
          >
            <Text style={{ fontSize: 14, color: c.text }}>{connected[s.key] ? "✓" : s.icon}</Text>
          </View>
        ))}
        <Txt small muted>Step {step + 1} of {STEPS.length}</Txt>
      </Row>

      {current.key === "calendar" && <CalendarStep onDone={markDone} />}
      {current.key === "health" && <HealthStep onDone={markDone} />}
      {current.key === "photos" && <PhotosStep onDone={markDone} />}
      {current.key === "canvas" && <CanvasStep onDone={markDone} />}
      {current.key === "more" && <PermissionCards only={["location", "screenTime"]} />}

      <Row>
        {step > 0 && <Button variant="ghost" title="Back" onPress={() => setStep(step - 1)} style={{ flex: 1 }} />}
        <Button
          variant={connected[current.key] || current.key === "more" ? "primary" : "secondary"}
          title={last ? "Finish" : connected[current.key] ? "Next" : "Skip for now"}
          onPress={next}
          style={{ flex: 1 }}
        />
      </Row>
    </View>
  );
}

function StepCard({ icon, title, why, children }: { icon: string; title: string; why: string; children: ReactNode }) {
  return (
    <Card style={{ gap: 10 }}>
      <Txt bold style={{ fontSize: 18 }}>{icon}  {title}</Txt>
      <Txt small muted>{why}</Txt>
      {children}
    </Card>
  );
}

function Outcome({ error, done }: { error: string | null; done: string | null }) {
  const c = useColors();
  if (error) return <ErrorText>{error}</ErrorText>;
  return done ? <Txt small style={{ color: c.good }}>✓ {done}</Txt> : null;
}

function CalendarStep({ onDone }: { onDone: () => void }) {
  const google = useAction();
  const phone = useAction();
  const connectGoogle = () =>
    google.run(() =>
      withConsent("calendar", "planning_only", async () => {
        const account = await connectGoogleCalendar();
        if (!account) return null;
        setCalendar("google", true, account);
        onDone();
        return `Connected ${account}. Free/busy refreshes every 15 minutes.`;
      }),
    );
  const usePhone = () =>
    phone.run(() =>
      withConsent("calendar", "planning_only", async () => {
        const { status } = await Calendar.requestCalendarPermissionsAsync();
        if (status !== "granted") throw new Error("Calendar access is off. Allow it in Settings → Waggle → Calendars.");
        const result = await syncBusyTimes();
        if (!result) return null;
        onDone();
        return "Sent this week's busy times from this phone.";
      }),
    );
  return (
    <StepCard icon="📅" title="Calendar" why="Your agent sees only when you're busy, never event titles, so the plans it suggests fit everyone.">
      <Button title="Connect Google Calendar" onPress={connectGoogle} loading={google.busy} />
      <Outcome error={google.error} done={google.done} />
      <Txt small muted>Or use the calendars already on this iPhone.</Txt>
      <Button variant="secondary" title="Use this iPhone's calendars" onPress={usePhone} loading={phone.busy} />
      <Outcome error={phone.error} done={phone.done} />
    </StepCard>
  );
}

function HealthStep({ onDone }: { onDone: () => void }) {
  const c = useColors();
  const a = useAction();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const native = healthKitAvailable();

  const connect = () =>
    a.run(() =>
      withConsent("health", "highlights", async () => {
        // Apple's sheet: the person picks which types to allow.
        if (!(await requestHealthAccess())) throw new Error("Health access wasn't allowed. You can change it in Settings → Health → Data Access & Devices → Waggle.");
        const stored = await syncHealth({ force: true });
        if (stored === null) throw new Error("Couldn't read Health. Check Settings → Health → Data Access & Devices → Waggle.");
        onDone();
        return stored.length ? `Connected. Sent ${stored.join(", ")}.` : "Connected. New steps, sleep and workouts sync when you open Waggle.";
      }),
    );
  const shortcut = () =>
    a.run(async () => {
      await setConsent("health", "highlights");
      setToken(await ingestToken());
      onDone();
      return null;
    });

  return (
    <StepCard icon="🏃" title="Apple Health" why="Steps, sleep and workouts. Sleep stays private; workouts and big step days can become wins your friends see.">
      {native ? (
        <Button title="Connect Apple Health" onPress={connect} loading={a.busy} />
      ) : !token ? (
        <>
          <Txt small muted>This version of the app can't read Health directly, so you'll send it with an iOS Shortcut instead.</Txt>
          <Button title="Set up the Health Shortcut" onPress={shortcut} loading={a.busy} />
        </>
      ) : (
        <View style={{ gap: 6 }}>
          <Txt small>1. Open Shortcuts and make a shortcut that finds today's Steps, last night's Sleep Analysis and today's Workouts.</Txt>
          <Txt small>2. Add "Get Contents of URL" that POSTs them to</Txt>
          <Text selectable style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, color: c.text }}>{AGENT_URL}/ingest/health</Text>
          <Txt small>with the header Authorization: Bearer (your token).</Txt>
          <Txt small>3. Add a daily Personal Automation that runs it each morning.</Txt>
          <Button small variant="secondary" title={copied ? "Token copied" : "Copy my token"} onPress={() => Clipboard.setStringAsync(token).then(() => setCopied(true))} />
          <Button small variant="ghost" title="Open Shortcuts" onPress={() => Linking.openURL("shortcuts://").catch(() => {})} />
          <Txt small muted>Keep the token private: it lets anyone send data as you.</Txt>
        </View>
      )}
      <Outcome error={a.error} done={a.done} />
    </StepCard>
  );
}

function PhotosStep({ onDone }: { onDone: () => void }) {
  const a = useAction();
  const allow = () =>
    a.run(async () => {
      // iOS shows its photo-library prompt here.
      const result = await requestPhotos();
      setPermissions({ photos: result });
      if (result !== "granted") {
        throw new Error("Photo access was turned down. You can allow it in Settings → Waggle → Photos.");
      }
      await setConsent("photos", "highlights");
      onDone();
      return "Photos allowed. Pick a photo from the Share tab whenever you go somewhere fun.";
    });
  return (
    <StepCard icon="📸" title="Photos" why="Your agent never scans your library. When you pick a photo, it reads only where and when it was taken, for “weirdest place of the week”.">
      <Button title="Allow photo access" onPress={allow} loading={a.busy} />
      <Outcome error={a.error} done={a.done} />
      {a.error && <Button small variant="secondary" title="Open Settings" onPress={() => Linking.openSettings()} />}
    </StepCard>
  );
}

/** Canvas addresses people type: "bcourses.berkeley.edu", with or without https. */
function canvasBase(raw: string): string {
  const t = raw.trim().replace(/\/+$/, "");
  return t && !/^https?:\/\//i.test(t) ? `https://${t}` : t;
}

function CanvasStep({ onDone }: { onDone: () => void }) {
  const a = useAction();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const base = canvasBase(url);

  const openSettings = () => WebBrowser.openBrowserAsync(`${base}/profile/settings`).catch(() => {});
  const paste = async () => setToken((await Clipboard.getStringAsync()).trim());
  const connect = () =>
    a.run(() =>
      withConsent("canvas", "planning_only", async () => {
        await agentPost("/canvas/token", { base_url: base, token: token.trim() });
        setToken("");
        onDone();
        return "Canvas connected. Deadlines refresh every hour.";
      }),
    );

  return (
    <StepCard icon="📚" title="Canvas" why="Your agent checks upcoming deadlines so plans land after a heavy week. Assignment names never leave it.">
      <Txt small bold>1. Your school's Canvas address</Txt>
      <Input placeholder="bcourses.berkeley.edu" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Txt small bold>2. Make an access token</Txt>
      <Txt small muted>Sign in, scroll to Approved Integrations, tap “+ New Access Token”, name it Waggle, then Generate and copy the token.</Txt>
      <Button small variant="secondary" title="Open Canvas settings" onPress={openSettings} disabled={!base} style={{ alignSelf: "flex-start" }} />
      <Txt small bold>3. Paste it here</Txt>
      <Row>
        <View style={{ flex: 1 }}>
          <Input placeholder="Access token" value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} />
        </View>
        <Button small variant="ghost" title="Paste" onPress={paste} />
      </Row>
      <Button title="Connect Canvas" onPress={connect} loading={a.busy} disabled={!base || !token.trim()} />
      <Outcome error={a.error} done={a.done} />
    </StepCard>
  );
}
