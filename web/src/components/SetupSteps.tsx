import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import exifr from "exifr";
import { useDB } from "../lib/db";
import { currentUser, setCalendar, setPermissions } from "../lib/api";
import { agentPost } from "../lib/agentApi";
import { connectCalendar } from "../lib/integrations";
import { connectAs, setConsent, useLive } from "../lib/live";
import { PermissionCards } from "./PermissionCards";

// Guided first-run setup: one source per step, each with its real sign-in or
// browser prompt. Connecting a source also turns on sharing for it, since the
// agent service refuses data for a source that's off.

type StepKey = "calendar" | "photos" | "canvas" | "more";

const STEPS: { key: StepKey; icon: string; title: string }[] = [
  { key: "calendar", icon: "📅", title: "Google Calendar" },
  { key: "photos", icon: "📸", title: "Photos" },
  { key: "canvas", icon: "📚", title: "Canvas" },
  { key: "more", icon: "📍", title: "Location & Screen Time" },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  return { busy, error, done, setDone, run };
}

function Outcome({ error, done }: { error: string | null; done: string | null }) {
  if (error) return <p className="form-error small">{error}</p>;
  return done ? <div className="status status-good">✓ {done}</div> : null;
}

export function SetupSteps({ onFinish }: { onFinish: () => void }) {
  const me = currentUser(useDB());
  const live = useLive();
  const [step, setStep] = useState(0);
  const [connected, setConnected] = useState<Partial<Record<StepKey, boolean>>>({});

  // Welcome sits outside the main layout, which normally connects.
  useEffect(() => {
    if (me) connectAs(me);
  }, [me]);

  if (live.status !== "ready") {
    return <div className={live.status === "error" ? "banner warn" : "card"}>{live.status === "error" ? live.error : "Setting up your account…"}</div>;
  }

  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const markDone = (key: StepKey) => setConnected((d) => ({ ...d, [key]: true }));

  return (
    <div className="stack">
      <ol className="chips" aria-label="Setup steps" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {STEPS.map((s, i) => (
          <li key={s.key} className={`chip${i === step ? " is-active" : ""}${connected[s.key] ? " chip-soft" : ""}`} aria-current={i === step ? "step" : undefined}>
            <span aria-hidden>{connected[s.key] ? "✓" : s.icon}</span> {s.title}
          </li>
        ))}
      </ol>
      <p className="small muted">Step {step + 1} of {STEPS.length}</p>

      {current.key === "calendar" && <CalendarStep onDone={() => markDone("calendar")} />}
      {current.key === "photos" && <PhotosStep onDone={() => markDone("photos")} />}
      {current.key === "canvas" && <CanvasStep onDone={() => markDone("canvas")} />}
      {current.key === "more" && <PermissionCards only={["location", "screenTime"]} />}

      <div className="onboarding-actions">
        {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
        <button
          type="button"
          className={`btn ${connected[current.key] || last ? "btn-primary" : "btn-secondary"}`}
          onClick={() => (last ? onFinish() : setStep(step + 1))}
        >
          {last ? "Finish" : connected[current.key] ? "Next" : "Skip for now"}
        </button>
      </div>
    </div>
  );
}

function StepCard({ icon, title, why, children }: { icon: string; title: string; why: string; children: ReactNode }) {
  return (
    <section className="card stack-sm">
      <h2 className="card-title"><span aria-hidden>{icon}</span> {title}</h2>
      <p className="muted small">{why}</p>
      {children}
    </section>
  );
}

function CalendarStep({ onDone }: { onDone: () => void }) {
  const me = currentUser(useDB())!;
  const [params, setParams] = useSearchParams();
  const a = useAction();
  const { setDone } = a;

  // Back from Google's sign-in (the agent service redirects to this page).
  useEffect(() => {
    if (params.get("connected") !== "google") return;
    const account = params.get("account") ?? undefined;
    if (params.get("calendar") === "cancelled") {
      setConsent("calendar", "off").catch(() => {});
    } else {
      setCalendar("google", true, account);
      setDone(`Connected ${account ?? "Google Calendar"}. Free/busy refreshes every 15 minutes.`);
      onDone();
    }
    for (const k of ["connected", "account", "calendar"]) params.delete(k);
    setParams(params, { replace: true });
  }, [params, setParams, onDone, setDone]);

  const connect = () =>
    a.run(async () => {
      // On before leaving for Google: the callback syncs free/busy right away.
      await setConsent("calendar", "planning_only");
      try {
        const r = await connectCalendar(me.email);
        if (r.status === "connected") {
          setCalendar("google", true, r.account);
          onDone();
          return `Connected ${r.account}.`;
        }
        if (r.status === "cancelled") await setConsent("calendar", "off");
        return null;
      } catch (e) {
        await setConsent("calendar", "off").catch(() => {});
        throw e;
      }
    });

  return (
    <StepCard icon="📅" title="Google Calendar" why="Your agent sees only when you're busy, never event titles, so the plans it suggests fit everyone.">
      <button type="button" className="btn btn-primary" onClick={connect} disabled={a.busy}>
        {a.busy ? "Opening Google…" : "Connect Google Calendar"}
      </button>
      <Outcome error={a.error} done={a.done} />
    </StepCard>
  );
}

function PhotosStep({ onDone }: { onDone: () => void }) {
  const a = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [on, setOn] = useState(false);

  const allow = () =>
    a.run(async () => {
      await setConsent("photos", "highlights");
      setPermissions({ photos: "granted" });
      setOn(true);
      onDone();
      return "Photos you pick can become “weirdest place of the week”.";
    });

  // Picking opens the browser's photo picker (the photo library on a phone).
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    a.run(async () => {
      const gps = await exifr.gps(file).catch(() => undefined);
      if (gps?.latitude == null || gps.longitude == null) {
        return "That photo has no location in it. Add places later from the Share tab.";
      }
      const r = await agentPost<{ place_name: string; caption: string }>("/ingest/photo", { lat: gps.latitude, lng: gps.longitude });
      return `${r.place_name}: “${r.caption}”`;
    });
  };

  return (
    <StepCard icon="📸" title="Photos" why="Your agent never scans your camera roll. When you pick a photo, only where and when it was taken leaves your device, never the image.">
      {!on ? (
        <button type="button" className="btn btn-primary" onClick={allow} disabled={a.busy}>Allow photos I pick</button>
      ) : (
        <>
          <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()} disabled={a.busy}>Try it: choose a photo</button>
          <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
        </>
      )}
      <Outcome error={a.error} done={a.done} />
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => {
      await setConsent("canvas", "planning_only");
      try {
        await agentPost("/canvas/token", { base_url: base, token: token.trim() });
      } catch (err) {
        await setConsent("canvas", "off").catch(() => {});
        throw err;
      }
      setToken("");
      onDone();
      return "Canvas connected. Deadlines refresh every hour.";
    });
  };

  return (
    <StepCard icon="📚" title="Canvas" why="Your agent checks upcoming deadlines so plans land after a heavy week. Assignment names never leave it.">
      <form className="stack-sm" onSubmit={submit}>
        <label className="field">
          <span>1. Your school's Canvas address</span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="bcourses.berkeley.edu" autoCapitalize="none" />
        </label>
        <div className="field">
          <span>2. Make an access token</span>
          <p className="small muted">Sign in, scroll to <em>Approved Integrations</em>, click <em>+ New Access Token</em>, name it Waggle, then Generate and copy the token.</p>
          {base ? (
            <a className="btn btn-secondary btn-sm" href={`${base}/profile/settings`} target="_blank" rel="noreferrer">Open Canvas settings ↗</a>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled>Open Canvas settings ↗</button>
          )}
        </div>
        <label className="field">
          <span>3. Paste it here</span>
          <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access token" type="password" autoComplete="off" />
        </label>
        <button className="btn btn-primary" disabled={a.busy || !base || !token.trim()}>{a.busy ? "Checking with Canvas…" : "Connect Canvas"}</button>
      </form>
      <Outcome error={a.error} done={a.done} />
    </StepCard>
  );
}
