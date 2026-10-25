import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { resetDB, useDB } from "../lib/db";
import { ApiError, changePassword, currentUser, deleteAccount, logOut, updateProfile } from "../lib/api";
import { resizeImage } from "../lib/integrations";
import { TIMEZONES } from "../lib/meta";
import type { User } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { Toggle } from "../components/Toggle";
import { PermissionCards } from "../components/PermissionCards";

export function SettingsPage() {
  const me = currentUser(useDB())!;
  return (
    <div className="page">
      <header className="page-head">
        <h1>Profile & settings</h1>
        <p className="muted">How friends see you, what your agent can access, and your account.</p>
      </header>
      <ProfileSection key={me.id} me={me} />
      <section className="stack">
        <div className="section-head">
          <h2>Connected data</h2>
          <p className="muted small">Add another calendar or change what your agent can see.</p>
        </div>
        <PermissionCards />
      </section>
      <AccountSection me={me} />
    </div>
  );
}

function ProfileSection({ me }: { me: User }) {
  const [draft, setDraft] = useState({
    displayName: me.displayName,
    bio: me.bio,
    city: me.city,
    timezone: me.timezone,
    email: me.email ?? "",
    phone: me.phone ?? "",
    avatar: me.avatar,
    profileVisibility: me.profileVisibility,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify({
    displayName: me.displayName, bio: me.bio, city: me.city, timezone: me.timezone,
    email: me.email ?? "", phone: me.phone ?? "", avatar: me.avatar, profileVisibility: me.profileVisibility,
  });

  const onPhoto = async (file?: File) => {
    if (!file) return;
    try {
      set("avatar", { ...draft.avatar, imageDataUrl: await resizeImage(file) });
    } catch {
      setError("That image couldn't be read. Try a JPG or PNG.");
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.displayName.trim()) return setError("Your name can't be empty.");
    setError(null);
    updateProfile({ ...draft, displayName: draft.displayName.trim(), email: draft.email.trim() || undefined, phone: draft.phone.trim() || undefined });
    setSaved(true);
  };

  const timezones = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES];
  const preview = { ...me, ...draft };

  return (
    <form className="profile-layout" onSubmit={save}>
      <section className="card stack">
        <h2 className="card-title">Profile</h2>

        <div className="field">
          <span>Picture</span>
          <div className="avatar-editor">
            <Avatar user={preview} size={72} />
            <div className="stack-sm">
              <div className="row-actions wrap">
                <label className="btn btn-secondary btn-sm">
                  Upload photo
                  <input type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
                </label>
                {draft.avatar.imageDataUrl && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("avatar", { ...draft.avatar, imageDataUrl: undefined })}>
                    Use my initial
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <label className="field">
          <span>Display name</span>
          <input className="input" value={draft.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </label>
        <label className="field">
          <span>Bio</span>
          <textarea className="input" rows={2} maxLength={160} value={draft.bio} onChange={(e) => set("bio", e.target.value)} placeholder="What are you up to these days?" />
          <small className="muted">{draft.bio.length}/160</small>
        </label>
        <div className="grid-2">
          <label className="field">
            <span>City</span>
            <input className="input" value={draft.city} onChange={(e) => set("city", e.target.value)} placeholder="Austin, TX" />
          </label>
          <label className="field">
            <span>Time zone</span>
            <select className="input" value={draft.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {timezones.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} />
          </label>
          <label className="field">
            <span>Phone (for iMessage)</span>
            <input className="input" type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+1 555 555 0100" />
          </label>
        </div>
        <small className="muted">Friends who link their contacts can find you by email or phone. These are never shown on your profile.</small>

        <div className="field">
          <span>Friends can see</span>
          <div className="toggle-list">
            <Toggle label="My city" checked={draft.profileVisibility.city} onChange={(v) => set("profileVisibility", { ...draft.profileVisibility, city: v })} />
            <Toggle label="My bio" checked={draft.profileVisibility.bio} onChange={(v) => set("profileVisibility", { ...draft.profileVisibility, bio: v })} />
            <Toggle label="My shareable goals" checked={draft.profileVisibility.goals} onChange={(v) => set("profileVisibility", { ...draft.profileVisibility, goals: v })} />
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row-actions">
          <button className="btn btn-primary" type="submit" disabled={!dirty}>Save profile</button>
          {saved && !dirty && <span className="muted small" role="status">✓ Saved</span>}
        </div>
      </section>

      <aside className="card profile-preview">
        <p className="eyebrow">What friends see</p>
        <Avatar user={preview} size={88} />
        <h3>{draft.displayName || "Your name"}</h3>
        <p className="muted small">@{me.username}{draft.profileVisibility.city && draft.city ? ` · ${draft.city}` : ""}</p>
        {draft.profileVisibility.bio && draft.bio && <p>{draft.bio}</p>}
        {draft.profileVisibility.goals && <p className="muted small">Shareable goals appear here.</p>}
      </aside>
    </form>
  );
}

function AccountSection({ me }: { me: User }) {
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const hasPassword = me.authProvider === "password" || !!me.passwordHash;

  const onChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      changePassword(current, next);
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: hasPassword ? "Password updated." : "Password set. You can now log in with your username too." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Couldn't update password." });
    }
  };

  return (
    <section className="card stack">
      <h2 className="card-title">Account</h2>
      <p className="muted small">
        Signed in as <strong>@{me.username}</strong>
        {me.authProvider === "google" ? ` with Google (${me.email})` : " with a password"}.
      </p>

      <form className="stack" onSubmit={onChangePassword}>
        <h3 className="small-head">{hasPassword ? "Change password" : "Set a password"}</h3>
        <div className="grid-2">
          {me.authProvider === "password" && (
            <input className="input" type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          )}
          <input className="input" type="password" placeholder="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        {msg && <p className={msg.ok ? "muted small" : "form-error small"} role="status">{msg.text}</p>}
        <button className="btn btn-secondary btn-sm self-start" type="submit" disabled={!next}>Update password</button>
      </form>

      <div className="row-actions wrap spread">
        <button type="button" className="btn btn-secondary" onClick={() => { logOut(); navigate("/auth"); }}>Log out</button>
        <div className="row-actions wrap">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (confirm("Reset all local demo data? Every account on this device is removed.")) {
                resetDB();
                navigate("/auth");
              }
            }}
          >
            Reset demo data
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (confirm("Delete your account, goals and connections? This can't be undone.")) {
                deleteAccount();
                navigate("/auth");
              }
            }}
          >
            Delete account
          </button>
        </div>
      </div>
    </section>
  );
}
