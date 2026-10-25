import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import exifr from "exifr";
import { AGENT_URL, agentPost, fileToBase64 } from "../lib/agentApi";
import { ingestToken, setConsent, useLive } from "../lib/live";
import { Segmented } from "../components/Toggle";

type Level = "highlights" | "planning_only" | "off";

const SOURCES: { key: string; label: string; hint: string }[] = [
  { key: "health", label: "Health", hint: "Steps, sleep and workouts from the Health Shortcut" },
  { key: "screen_time", label: "Screen Time", hint: "Screenshots you upload" },
  { key: "photos", label: "Photos", hint: "Places from photos you upload" },
  { key: "calendar", label: "Calendar", hint: "Free/busy only, never event details" },
  { key: "canvas", label: "Canvas", hint: "Upcoming deadlines" },
];

const LEVELS: { key: Level; label: string }[] = [
  { key: "highlights", label: "Share wins" },
  { key: "planning_only", label: "Planning only" },
  { key: "off", label: "Off" },
];

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Real data for your agent: consent per source, and a way in for each one. */
export function SharePage() {
  const live = useLive();
  const level = (source: string): Level =>
    (live.myConsent.find((c) => c.source === source)?.shareLevel as Level | undefined) ?? "off";

  if (live.status !== "ready") {
    return (
      <div className="page">
        <header className="page-head"><h1>Share</h1></header>
        <div className={live.status === "error" ? "banner warn" : "card"}>
          {live.status === "error" ? live.error : "Connecting to your group…"}
        </div>
      </div>
    );
  }

  return (
    <div className="page stack">
      <header className="page-head">
        <h1>Share</h1>
        <p className="muted">
          What your agent may use. <strong>Share wins</strong> lets it post highlights to your group.{" "}
          <strong>Planning only</strong> keeps the data private and uses it only to find times that work.
          Raw numbers, GPS and calendar details never leave the private tables.
        </p>
      </header>

      <section className="card stack-sm">
        <h2 className="card-title">What your agent can use</h2>
        {SOURCES.map((s) => (
          <div key={s.key} className="consent-row">
            <span className="toggle-text">
              <strong>{s.label}</strong>
              <small className="muted">{s.hint}</small>
            </span>
            <Segmented
              value={level(s.key)}
              options={LEVELS}
              label={`${s.label} sharing`}
              onChange={(l) => setConsent(s.key, l).catch(() => {})}
            />
          </div>
        ))}
      </section>

      <div className="grid-2">
        <ScreenTimeCard off={level("screen_time") === "off"} />
        <PhotoCard on={level("photos") === "highlights"} />
        <HealthCard off={level("health") === "off"} />
        <CanvasCard off={level("canvas") === "off"} />
        <section className="card stack-sm">
          <h2 className="card-title">Google Calendar</h2>
          <p className="muted small">
            Connect it under <Link to="/settings">Profile → Connected data</Link>. Your agent reads free/busy for the
            next week, so the coordinator can suggest times that actually work. Event names are never read.
          </p>
          {level("calendar") === "off" && <p className="small warn">Calendar is off above, so it won't be used.</p>}
        </section>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card stack-sm">
      <h2 className="card-title">{title}</h2>
      {children}
    </section>
  );
}

function Status({ busy, error, done }: { busy: boolean; error: string | null; done: ReactNode }) {
  if (busy) return <p className="small muted">Working…</p>;
  if (error) return <p className="form-error">{error}</p>;
  return done ? <div className="status status-good">{done}</div> : null;
}

function ScreenTimeCard({ off }: { off: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ daily_avg_hours: number; top_apps: string[]; pickups: number | null } | null>(null);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await agentPost<{ stored: typeof result }>("/ingest/screen-time", await fileToBase64(file));
      setResult(r.stored);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Screen Time">
      <p className="muted small">
        Upload a screenshot of Settings → Screen Time. Claude reads the daily average and top apps. If you have the
        least screen time in the group, your agent will brag for you. "Most" is only posted if you allowed roasts.
      </p>
      <label className={`btn btn-secondary ${off ? "disabled" : ""}`}>
        Upload screenshot
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={off || busy} onChange={upload} />
      </label>
      {off && <p className="small warn">Screen Time is off above.</p>}
      <Status
        busy={busy}
        error={error}
        done={
          result && (
            <>
              Read {result.daily_avg_hours}h a day
              {result.top_apps.length > 0 && ` · top: ${result.top_apps.slice(0, 3).join(", ")}`}
              {result.pickups != null && ` · ${result.pickups} pickups`}
            </>
          )
        }
      />
    </Card>
  );
}

function PhotoCard({ on }: { on: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [place, setPlace] = useState("");
  const [needPlace, setNeedPlace] = useState<{ taken_at?: string } | null>(null);
  const [result, setResult] = useState<{ place_name: string; caption: string; obscurity_score: number } | null>(null);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await agentPost("/ingest/photo", body));
      setNeedPlace(null);
      setPlace("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setResult(null);
    setError(null);
    // Only the location and time leave this device, never the image.
    let gps: { latitude?: number; longitude?: number } | undefined;
    let taken: Date | undefined;
    try {
      gps = (await exifr.gps(file)) ?? undefined;
      taken = (await exifr.parse(file, ["DateTimeOriginal"]))?.DateTimeOriginal;
    } catch {
      // No EXIF (e.g. stripped by the phone's browser): ask for the place.
    }
    const taken_at = taken instanceof Date ? taken.toISOString() : undefined;
    if (gps?.latitude != null && gps.longitude != null) {
      await send({ lat: gps.latitude, lng: gps.longitude, taken_at });
    } else {
      setNeedPlace({ taken_at });
    }
  };

  const submitPlace = (e: FormEvent) => {
    e.preventDefault();
    if (place.trim()) void send({ place_name: place.trim(), taken_at: needPlace?.taken_at });
  };

  return (
    <Card title="Weirdest place">
      <p className="muted small">
        Pick a photo from somewhere fun. Only its location and time are sent (the photo stays on your device); your
        agent names the place, and if it's unusual enough, posts it as the weirdest place of the week.
      </p>
      <label className={`btn btn-secondary ${on ? "" : "disabled"}`}>
        Choose photo
        <input type="file" accept="image/*" hidden disabled={!on || busy} onChange={pick} />
      </label>
      {!on && <p className="small warn">Set Photos to "Share wins" above to use this.</p>}
      {needPlace && (
        <form className="row-actions" onSubmit={submitPlace}>
          <input
            className="input"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="No location in that photo. Where was it?"
            maxLength={120}
            aria-label="Place"
          />
          <button className="btn btn-primary" disabled={busy || !place.trim()}>Add</button>
        </form>
      )}
      <Status
        busy={busy}
        error={error}
        done={result && <>{result.place_name}: "{result.caption}" (unusual: {Math.round(result.obscurity_score * 100)}%)</>}
      />
    </Card>
  );
}

function HealthCard({ off }: { off: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) ingestToken().then(setToken).catch(() => setToken(null));
  }, [shown]);

  return (
    <Card title="Apple Health">
      <p className="muted small">
        An iOS Shortcut sends today's steps, last night's sleep and workouts. Sleep is only ever used privately;
        workouts and big step days can become highlights.
      </p>
      {off && <p className="small warn">Health is off above.</p>}
      {!shown ? (
        <button type="button" className="btn btn-secondary" onClick={() => setShown(true)}>Set up the Shortcut</button>
      ) : (
        <ol className="small stack-sm shortcut-steps">
          <li>In Shortcuts, make a shortcut that finds today's <em>Steps</em>, last night's <em>Sleep Analysis</em> and today's <em>Workouts</em>.</li>
          <li>
            Add <em>Get Contents of URL</em>: POST to <code>{AGENT_URL}/ingest/health</code>, header{" "}
            <code>Authorization: Bearer {token ?? "…"}</code>, JSON body like{" "}
            <code>{'{"steps": 8123, "sleep": [{"start": "…", "end": "…"}], "workouts": [{"kind": "run", "minutes": 30, "distance_km": 5}]}'}</code>
          </li>
          <li>Add a daily Personal Automation that runs it each morning.</li>
          <li className="muted">Keep the token private: it lets anyone send data as you. Signing out and in again makes a new one.</li>
        </ol>
      )}
    </Card>
  );
}

function CanvasCard({ off }: { off: boolean }) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await agentPost("/canvas/token", { base_url: url.trim(), token: token.trim() });
      setDone(true);
      setToken("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Canvas">
      <p className="muted small">
        Your agent checks upcoming deadlines hourly. Three or more in a week counts as a heavy week, which the
        coordinator plans around. Make a token in Canvas → Account → Settings → New access token.
      </p>
      {off && <p className="small warn">Canvas is off above.</p>}
      <form className="stack-sm" onSubmit={submit}>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://canvas.yourschool.edu" aria-label="Canvas URL" disabled={off} />
        <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access token" type="password" aria-label="Canvas access token" disabled={off} />
        <button className="btn btn-secondary" disabled={off || busy || !url.trim() || !token.trim()}>Connect Canvas</button>
      </form>
      <Status busy={busy} error={error} done={done && "Connected. Deadlines refresh every hour."} />
    </Card>
  );
}
