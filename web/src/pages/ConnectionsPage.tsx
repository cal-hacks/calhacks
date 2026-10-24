import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDB } from "../lib/db";
import {
  acceptFriendRequest,
  currentUser,
  friendsOf,
  matchContacts,
  relationship,
  removeConnection,
  searchUsers,
  sendFriendRequest,
  setPermissions,
  setSharing,
  setSharingForAll,
  sharingWith,
  type ContactEntry,
} from "../lib/api";
import { contactPickerSupported, parseContactsText, pickContacts } from "../lib/integrations";
import { APP_NAME, FREQUENCIES, SHARE_CATEGORIES } from "../lib/meta";
import type { DB, User } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { Toggle } from "../components/Toggle";

export function ConnectionsPage() {
  const db = useDB();
  const me = currentUser(db)!;
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";

  const friends = friendsOf(db, me.id);
  const incoming = db.connections.filter((c) => c.toId === me.id && c.status === "pending");
  const outgoing = db.connections.filter((c) => c.fromId === me.id && c.status === "pending");
  const userById = (id: string) => db.users.find((u) => u.id === id);

  return (
    <div className="page">
      {welcome && (
        <div className="banner">
          <div className="steps" aria-label="Setup progress">
            <span className="step is-done">Account</span>
            <span className="step is-done">Permissions</span>
            <span className="step is-active" aria-current="step">Friends</span>
          </div>
          <p>Last step: add the friends you want to stay close to. You decide what each one sees.</p>
          <Link className="btn btn-primary btn-sm" to="/">Go to my dashboard →</Link>
        </div>
      )}

      <header className="page-head">
        <h1>Friends</h1>
        <p className="muted">Connect with friends on {APP_NAME} and choose how often, and what, your agent shares with each of them.</p>
      </header>

      {(incoming.length > 0 || outgoing.length > 0) && (
        <section className="card">
          <h2 className="card-title">Requests</h2>
          <ul className="people">
            {incoming.map((c) => {
              const u = userById(c.fromId);
              if (!u) return null;
              return (
                <li key={c.id} className="person">
                  <Avatar user={u} />
                  <PersonText user={u} extra="wants to connect" />
                  <div className="row-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => removeConnection(u.id)}>Decline</button>
                    <button className="btn btn-primary btn-sm" onClick={() => acceptFriendRequest(c.id)}>Accept</button>
                  </div>
                </li>
              );
            })}
            {outgoing.map((c) => {
              const u = userById(c.toId);
              if (!u) return null;
              return (
                <li key={c.id} className="person">
                  <Avatar user={u} />
                  <PersonText user={u} extra="request sent" />
                  <button className="btn btn-ghost btn-sm" onClick={() => removeConnection(u.id)}>Cancel</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <FindFriends db={db} me={me} />

      <section className="stack">
        <div className="section-head">
          <h2>Your connections <span className="muted">({friends.length})</span></h2>
        </div>
        {friends.length === 0 ? (
          <div className="card empty">
            <p>No connections yet. Search for a username above or link your contacts to find friends already on {APP_NAME}.</p>
          </div>
        ) : (
          friends.map((f) => <FriendCard key={f.id} db={db} me={me} friend={f} />)
        )}
      </section>
    </div>
  );
}

function PersonText({ user, extra }: { user: User; extra?: string }) {
  return (
    <span className="person-text">
      <strong>{user.displayName}</strong>
      <small className="muted">
        @{user.username}
        {user.city && user.profileVisibility.city ? ` · ${user.city}` : ""}
        {extra ? ` · ${extra}` : ""}
      </small>
    </span>
  );
}

function RelationButton({ db, me, user }: { db: DB; me: User; user: User }) {
  const rel = relationship(db, me.id, user.id);
  if (rel === "friends") return <span className="pill pill-on">✓ Connected</span>;
  if (rel === "outgoing") return <span className="pill pill-off">Requested</span>;
  return (
    <button className="btn btn-secondary btn-sm" onClick={() => sendFriendRequest(user.id)}>
      {rel === "incoming" ? "Accept" : "Add friend"}
    </button>
  );
}

function FindFriends({ db, me }: { db: DB; me: User }) {
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [contacts, setContacts] = useState<ContactEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Recomputed on every db change so request status stays live.
  const results = query ? searchUsers(query) : [];
  const matches = useMemo(() => (contacts ? matchContacts(contacts) : []), [contacts]);
  const onApp = matches.filter((m) => m.user);
  const notOnApp = matches.filter((m) => !m.user);

  const importContacts = (list: ContactEntry[]) => {
    setError(list.length ? null : "We couldn't find any emails or phone numbers there.");
    setContacts(list);
    setPermissions({ contacts: "granted" });
  };

  const onPick = async () => {
    try {
      importContacts(await pickContacts());
    } catch {
      setError("Contact access was cancelled.");
    }
  };

  const onFile = async (file?: File) => {
    if (file) importContacts(parseContactsText(await file.text()));
  };

  const invite = async (c: ContactEntry) => {
    const text = `Join me on ${APP_NAME} so we actually keep up: ${window.location.origin}/?invite=${me.username}`;
    if (navigator.share) {
      await navigator.share({ text }).catch(() => {});
    } else if (c.phone) {
      window.location.href = `sms:${c.phone}?&body=${encodeURIComponent(text)}`;
    } else if (c.email) {
      window.location.href = `mailto:${c.email}?subject=${encodeURIComponent(`Join me on ${APP_NAME}`)}&body=${encodeURIComponent(text)}`;
    }
  };

  return (
    <section className="card stack">
      <h2 className="card-title">Find friends</h2>
      <input
        className="input"
        type="search"
        placeholder="Search by name, @username or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search people"
      />
      {query.trim().length >= 2 && (
        <ul className="people">
          {results.length === 0 && <li className="muted small">No one matches “{query}”.</li>}
          {results.map((u) => (
            <li key={u.id} className="person">
              <Avatar user={u} />
              <PersonText user={u} />
              <RelationButton db={db} me={me} user={u} />
            </li>
          ))}
        </ul>
      )}

      <div className="link-contacts">
        <div>
          <strong>Link your contacts</strong>
          <p className="muted small">We match emails and phone numbers to people on {APP_NAME}. Contacts aren't stored or messaged.</p>
        </div>
        <div className="row-actions wrap">
          {contactPickerSupported && <button className="btn btn-secondary btn-sm" onClick={onPick}>Choose contacts</button>}
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>Import .vcf / .csv</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>Paste emails or numbers</button>
          <input ref={fileRef} type="file" accept=".vcf,.csv,.txt,text/vcard,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </div>

      {pasteOpen && (
        <div className="stack">
          <textarea
            className="input"
            rows={3}
            placeholder={"maya@example.com\n(206) 555-0103"}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            aria-label="Emails or phone numbers"
          />
          <button className="btn btn-primary btn-sm self-start" onClick={() => importContacts(parseContactsText(pasted))}>Find matches</button>
        </div>
      )}
      {error && <p className="form-error small">{error}</p>}

      {contacts && contacts.length > 0 && (
        <div className="stack">
          <h3 className="small-head">On {APP_NAME} ({onApp.length})</h3>
          {onApp.length === 0 ? (
            <p className="muted small">None of these contacts are here yet. Invite them below.</p>
          ) : (
            <ul className="people">
              {onApp.map(({ user }) => (
                <li key={user!.id} className="person">
                  <Avatar user={user!} />
                  <PersonText user={user!} />
                  <RelationButton db={db} me={me} user={user!} />
                </li>
              ))}
            </ul>
          )}
          {notOnApp.length > 0 && (
            <>
              <h3 className="small-head">Invite ({notOnApp.length})</h3>
              <ul className="people">
                {notOnApp.slice(0, 20).map(({ contact }, i) => (
                  <li key={i} className="person">
                    <span className="avatar avatar-empty" aria-hidden>?</span>
                    <span className="person-text">
                      <strong>{contact.name ?? contact.email ?? contact.phone}</strong>
                      <small className="muted">{contact.email ?? contact.phone}</small>
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => invite(contact)}>Invite</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function FriendCard({ db, me, friend }: { db: DB; me: User; friend: User }) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const prefs = sharingWith(db, me.id, friend.id);
  const shareableGoals = db.goals.filter((g) => g.userId === me.id && g.shareWithFriends && !g.archived);
  const freq = FREQUENCIES.find((f) => f.key === prefs.frequency)!;
  const enabled = SHARE_CATEGORIES.filter((c) => prefs.categories[c.key]);

  const summary =
    prefs.frequency === "paused" ? "Paused: nothing is shared" : `${freq.label} · ${enabled.length ? enabled.map((c) => c.label).join(", ") : "nothing selected"}`;

  return (
    <article className={`card friend-card${open ? " is-open" : ""}`}>
      <button type="button" className="friend-summary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Avatar user={friend} size={44} />
        <span className="person-text">
          <strong>{friend.displayName}</strong>
          <small className="muted">{summary}</small>
        </span>
        <span className="chevron" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="friend-body">
          <div className="field">
            <span>How often should your agent send {friend.displayName.split(" ")[0]} updates?</span>
            <div className="chips" role="radiogroup" aria-label="Update frequency">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={prefs.frequency === f.key}
                  className={`chip${prefs.frequency === f.key ? " is-active" : ""}`}
                  onClick={() => setSharing(friend.id, { frequency: f.key })}
                  title={f.hint}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <small className="muted">{freq.hint}</small>
          </div>

          <div className="field">
            <span>What you're okay sharing with them</span>
            <div className="toggle-list">
              {SHARE_CATEGORIES.map((c) => (
                <Toggle
                  key={c.key}
                  icon={c.icon}
                  label={c.label}
                  hint={c.hint}
                  checked={prefs.categories[c.key]}
                  disabled={prefs.frequency === "paused"}
                  onChange={(v) => setSharing(friend.id, { categories: { ...prefs.categories, [c.key]: v } })}
                />
              ))}
            </div>
          </div>

          {prefs.categories.goals && shareableGoals.length > 0 && (
            <div className="field">
              <span>Which goals</span>
              <div className="toggle-list">
                {shareableGoals.map((g) => (
                  <Toggle
                    key={g.id}
                    label={g.title}
                    checked={prefs.goals[g.id] ?? true}
                    disabled={prefs.frequency === "paused"}
                    onChange={(v) => setSharing(friend.id, { goals: { ...prefs.goals, [g.id]: v } })}
                  />
                ))}
              </div>
            </div>
          )}

          <Toggle
            icon="😜"
            label="Allow playful roasts"
            hint="Lets your agent post light jokes like “Screen Time champion 📱👑”. Off by default."
            checked={prefs.roastOk}
            disabled={prefs.frequency === "paused"}
            onChange={(v) => setSharing(friend.id, { roastOk: v })}
          />

          <div className="row-actions wrap spread">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSharingForAll({ frequency: prefs.frequency, categories: prefs.categories });
                setApplied(true);
                setTimeout(() => setApplied(false), 2000);
              }}
            >
              {applied ? "✓ Applied to all friends" : "Apply to all friends"}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (confirm(`Remove ${friend.displayName}? Your agent will stop sharing with them.`)) removeConnection(friend.id);
              }}
            >
              Remove connection
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
