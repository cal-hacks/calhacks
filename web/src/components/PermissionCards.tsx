import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDB } from "../lib/db";
import { currentUser, permissionsOf, setCalendar, setPermissions } from "../lib/api";
import { CALENDAR_PROVIDERS } from "../lib/meta";
import { shareForPlanning } from "../lib/live";
import { connectCalendar, requestLocation } from "../lib/integrations";
import type { CalendarProvider, ScreenTimeMethod } from "../lib/types";
import { Segmented } from "./Toggle";

type Section = "calendar" | "location" | "photos" | "screenTime";

/** Calendar, location, photo and screen time access, or just the `only` ones. */
export function PermissionCards({ only }: { only?: Section[] } = {}) {
  const show = (s: Section) => !only || only.includes(s);
  const db = useDB();
  const me = currentUser(db)!;
  const perms = permissionsOf(db, me.id);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Return leg of the agent service's Google sign-in: ?connected=google&account=...
  useEffect(() => {
    const provider = params.get("connected") as CalendarProvider | null;
    if (provider && CALENDAR_PROVIDERS.some((p) => p.key === provider)) {
      setCalendar(provider, true, params.get("account") ?? undefined);
      params.delete("connected");
      params.delete("account");
      params.delete("calendar");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const onConnect = async (provider: CalendarProvider) => {
    setBusy(provider);
    try {
      // On before leaving for Google, so the first sync isn't thrown away.
      await shareForPlanning("calendar");
      const r = await connectCalendar(me.email);
      if (r.status === "connected") setCalendar(provider, true, r.account);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onLocation = async () => {
    setBusy("location");
    const result = await requestLocation();
    setPermissions({ location: result });
    setNote(result === "denied" ? "Location was blocked. You can allow it in your browser's site settings, then try again." : null);
    setBusy(null);
  };

  const connectedCount = CALENDAR_PROVIDERS.filter((p) => perms.calendars[p.key].connected).length;

  return (
    <div className="perm-grid">
      {show("calendar") && (
      <section className="card perm-card">
        <header className="perm-head">
          <span className="perm-icon" aria-hidden>🗓️</span>
          <div>
            <h3>Calendars</h3>
            <p className="muted small">Your agent reads free/busy only, so it can suggest times. Event titles stay private.</p>
          </div>
          <StatusPill on={connectedCount > 0} text={connectedCount ? `${connectedCount} connected` : "Not connected"} />
        </header>
        <ul className="provider-list">
          {CALENDAR_PROVIDERS.map((p) => {
            const c = perms.calendars[p.key];
            return (
              <li key={p.key} className="provider-row">
                <span aria-hidden>{p.icon}</span>
                <span className="provider-name">
                  {p.label}
                  {c.connected && c.account && <small className="muted">{c.account}</small>}
                </span>
                {c.connected ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCalendar(p.key, false)}>
                    Disconnect
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy === p.key} onClick={() => onConnect(p.key)}>
                    {busy === p.key ? "Connecting…" : "Connect"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      )}

      {show("location") && (
      <section className="card perm-card">
        <header className="perm-head">
          <span className="perm-icon" aria-hidden>📍</span>
          <div>
            <h3>Location</h3>
            <p className="muted small">Tracks time at places you name in a goal (like “the library”). Friends only see places you choose to share, at city level.</p>
          </div>
          <StatusPill on={perms.location === "granted"} text={perms.location === "granted" ? "Allowed" : perms.location === "denied" ? "Blocked" : "Off"} />
        </header>
        <div className="perm-actions">
          {perms.location === "granted" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPermissions({ location: "off" })}>Turn off</button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy === "location"} onClick={onLocation}>
              {busy === "location" ? "Asking your browser…" : "Allow location"}
            </button>
          )}
        </div>
        {note && <p className="form-error small">{note}</p>}
      </section>
      )}

      {show("photos") && (
      <section className="card perm-card">
        <header className="perm-head">
          <span className="perm-icon" aria-hidden>📸</span>
          <div>
            <h3>Photos</h3>
            <p className="muted small">Your agent never scans your camera roll. It only sees the photos you pick, and reads where and when they were taken.</p>
          </div>
          <StatusPill on={perms.photos === "granted"} text={perms.photos === "granted" ? "Allowed" : "Off"} />
        </header>
        <div className="perm-actions">
          <Segmented
            label="Photo access"
            value={perms.photos === "granted" ? "granted" : "off"}
            options={[
              { key: "granted", label: "Photos I pick" },
              { key: "off", label: "Off" },
            ]}
            onChange={(v) => setPermissions({ photos: v })}
          />
        </div>
      </section>
      )}

      {show("screenTime") && (
      <section className="card perm-card">
        <header className="perm-head">
          <span className="perm-icon" aria-hidden>📱</span>
          <div>
            <h3>Screen Time</h3>
            <p className="muted small">Browsers can't read Screen Time directly. Upload a screenshot and your agent reads the numbers.</p>
          </div>
          <StatusPill on={perms.screenTime !== "off"} text={perms.screenTime === "screenshot" ? "Screenshots" : "Off"} />
        </header>
        <div className="perm-actions">
          <Segmented<ScreenTimeMethod>
            label="Screen Time source"
            value={perms.screenTime === "screenshot" ? "screenshot" : "off"}
            options={[
              { key: "screenshot", label: "Screenshots" },
              { key: "off", label: "Off" },
            ]}
            onChange={(v) => setPermissions({ screenTime: v })}
          />
        </div>
      </section>
      )}
    </div>
  );
}

function StatusPill({ on, text }: { on: boolean; text: string }) {
  return (
    <span className={`pill ${on ? "pill-on" : "pill-off"}`}>
      <span aria-hidden>{on ? "✓" : "○"}</span> {text}
    </span>
  );
}
