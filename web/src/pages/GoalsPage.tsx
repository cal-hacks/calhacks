import { useState } from "react";
import { Link } from "react-router-dom";
import { useDB } from "../lib/db";
import { ApiError, createGoal, currentUser, deleteGoal, logProgress, permissionsOf, updateGoal } from "../lib/api";
import { CATEGORIES, GOAL_TEMPLATES, PERIODS, SOURCES, type GoalTemplate } from "../lib/meta";
import { currentProgress, formatAmount, streak } from "../lib/goals";
import { PERIOD_NOUN } from "../lib/dates";
import type { DB, Goal, GoalPeriod, Permissions, TrackingSource } from "../lib/types";
import { Segmented, Toggle } from "../components/Toggle";

type Draft = Omit<Goal, "id" | "userId" | "archived" | "createdAt">;

const UNITS = ["minutes", "hours", "times", "steps", "pages", "books", "km", "miles"];

const BLANK: Draft = {
  title: "",
  category: "study",
  period: "weekly",
  target: 5,
  unit: "hours",
  direction: "atLeast",
  trackBy: "manual",
  place: "",
  shareWithFriends: true,
};

export function GoalsPage() {
  const db = useDB();
  const me = currentUser(db)!;
  const perms = permissionsOf(db, me.id);
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [template, setTemplate] = useState<Draft>(BLANK);

  const goals = db.goals.filter((g) => g.userId === me.id && !g.archived);

  const startFromTemplate = (t: GoalTemplate) => {
    const { icon: _icon, ...rest } = t;
    setTemplate({ ...BLANK, ...rest });
    setEditing("new");
  };

  return (
    <div className="page">
      <header className="page-head row-between">
        <div>
          <h1>Goals</h1>
          <p className="muted">Set goals for the day, week, month or year. Your agent tracks them and can share wins with friends you choose.</p>
        </div>
        {editing === null && (
          <button className="btn btn-primary" onClick={() => { setTemplate(BLANK); setEditing("new"); }}>+ New goal</button>
        )}
      </header>

      {editing === null && (
        <section className="stack-sm">
          <h2 className="small-head">Quick start</h2>
          <div className="chips">
            {GOAL_TEMPLATES.map((t) => (
              <button key={t.title} type="button" className="chip" onClick={() => startFromTemplate(t)}>
                <span aria-hidden>{t.icon}</span> {t.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {editing !== null && (
        <GoalForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? template : editing}
          perms={perms}
          isNew={editing === "new"}
          onCancel={() => setEditing(null)}
          onSave={(d) => {
            if (editing === "new") createGoal(d);
            else updateGoal(editing.id, d);
            setEditing(null);
          }}
        />
      )}

      {goals.length === 0 && editing === null ? (
        <div className="card empty">
          <p>No goals yet. Try a quick start above, like studying at the library for 2 hours a day.</p>
        </div>
      ) : (
        PERIODS.map((p) => {
          const list = goals.filter((g) => g.period === p.key);
          if (!list.length) return null;
          return (
            <section key={p.key} className="stack">
              <h2 className="section-title">{p.label}</h2>
              {list.map((g) => (
                <GoalRow key={g.id} db={db} goal={g} onEdit={() => setEditing(g)} />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function sourceNeedsPermission(source: TrackingSource, perms: Permissions): string | null {
  if (source === "location" && perms.location !== "granted") return "Location access is off";
  if (source === "screenTime" && perms.screenTime === "off") return "Screen Time isn't connected";
  if (source === "calendar" && !Object.values(perms.calendars).some((c) => c.connected)) return "No calendar is connected";
  return null;
}

function GoalForm({
  initial,
  perms,
  isNew,
  onSave,
  onCancel,
}: {
  initial: Draft;
  perms: Permissions;
  isNew: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>({ ...initial, place: initial.place ?? "" });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const missing = sourceNeedsPermission(d.trackBy, perms);
  const units = UNITS.includes(d.unit) ? UNITS : [d.unit, ...UNITS];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (d.trackBy === "location" && !d.place?.trim()) return setError("Name the place to track, like “Green Library”.");
    try {
      if (!d.title.trim()) throw new ApiError("Give your goal a name.");
      if (!(d.target > 0)) throw new ApiError("Target must be more than zero.");
      onSave({ ...d, title: d.title.trim(), place: d.trackBy === "location" ? d.place?.trim() : undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save goal.");
    }
  };

  return (
    <form className="card stack goal-form" onSubmit={submit}>
      <h2 className="card-title">{isNew ? "New goal" : "Edit goal"}</h2>

      <label className="field">
        <span>Goal</span>
        <input className="input" value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Spend 2 hours at the library" autoFocus />
      </label>

      <div className="field">
        <span>Category</span>
        <div className="chips" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button key={c.key} type="button" role="radio" aria-checked={d.category === c.key} className={`chip${d.category === c.key ? " is-active" : ""}`} onClick={() => set("category", c.key)}>
              <span aria-hidden>{c.icon}</span> {c.label}
            </button>
          ))}
        </div>
        {d.category === "study" && <small className="muted">Study goals measured in time count toward “study hours” on your dashboard.</small>}
      </div>

      <div className="field">
        <span>Every</span>
        <Segmented<GoalPeriod> label="Period" value={d.period} options={PERIODS.map((p) => ({ key: p.key, label: PERIOD_NOUN[p.key] }))} onChange={(v) => set("period", v)} />
      </div>

      <div className="field">
        <span>Target</span>
        <div className="target-row">
          <select className="input" value={d.direction} onChange={(e) => set("direction", e.target.value as Draft["direction"])} aria-label="Direction">
            <option value="atLeast">At least</option>
            <option value="atMost">At most</option>
          </select>
          <input className="input" type="number" min={0} step="any" inputMode="decimal" value={Number.isFinite(d.target) ? d.target : ""} onChange={(e) => set("target", e.target.valueAsNumber)} aria-label="Target amount" />
          <select className="input" value={d.unit} onChange={(e) => set("unit", e.target.value)} aria-label="Unit">
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <span className="muted">per {PERIOD_NOUN[d.period]}</span>
        </div>
      </div>

      <div className="field">
        <span>How should your agent track it?</span>
        <div className="source-grid" role="radiogroup" aria-label="Tracking source">
          {SOURCES.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={d.trackBy === s.key} className={`source-card${d.trackBy === s.key ? " is-active" : ""}`} onClick={() => set("trackBy", s.key)}>
              <strong>{s.label}</strong>
              <small>{s.hint}</small>
            </button>
          ))}
        </div>
        {missing && (
          <p className="warn small">
            ⚠️ {missing}. <Link to="/settings">Turn it on in Settings</Link>, or log progress by hand until then.
          </p>
        )}
      </div>

      {d.trackBy === "location" && (
        <label className="field">
          <span>Place</span>
          <input className="input" value={d.place} onChange={(e) => set("place", e.target.value)} placeholder="Green Library" />
          <small className="muted">Your agent counts time spent here. The place itself is only shared if you allow Places for a friend.</small>
        </label>
      )}

      <Toggle
        icon="🫂"
        label="Let my agent share wins for this goal"
        hint="Adds this goal as a sharing option on the Friends page, where you pick which friends see it."
        checked={d.shareWithFriends}
        onChange={(v) => set("shareWithFriends", v)}
      />

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">{isNew ? "Create goal" : "Save changes"}</button>
      </div>
    </form>
  );
}

function GoalRow({ db, goal, onEdit }: { db: DB; goal: Goal; onEdit: () => void }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { total, ratio, hit } = currentProgress(goal, db.logs);
  const s = streak(goal, db.logs);
  const cat = CATEGORIES.find((c) => c.key === goal.category)!;
  const src = SOURCES.find((x) => x.key === goal.trackBy)!;
  const atMost = goal.direction === "atMost";
  const over = atMost && total > goal.target;

  const submitLog = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      logProgress(goal.id, Number(amount));
      setAmount("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log that.");
    }
  };

  return (
    <article className="card goal-row">
      <div className="goal-main">
        <span className="goal-icon" aria-hidden>{cat.icon}</span>
        <div className="goal-text">
          <strong>{goal.title}</strong>
          <small className="muted">
            {atMost ? "At most" : "At least"} {formatAmount(goal, goal.target)} per {PERIOD_NOUN[goal.period]} · tracked by {src.label}
            {goal.place ? ` (${goal.place})` : ""}
            {goal.shareWithFriends ? " · 🫂 shareable" : " · 🔒 private"}
          </small>
        </div>
        <div className="row-actions">
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>
          <button className="btn btn-ghost btn-sm" aria-label={`Delete ${goal.title}`} onClick={() => confirm(`Delete “${goal.title}” and its history?`) && deleteGoal(goal.id)}>🗑️</button>
        </div>
      </div>

      <div className="progress-line">
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={total} aria-label={`${goal.title} this ${PERIOD_NOUN[goal.period]}`}>
          <span className={`progress-fill${over ? " is-over" : hit ? " is-hit" : ""}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
        <span className="progress-text">
          {formatAmount(goal, total)} / {formatAmount(goal, goal.target)}
          {!atMost && hit && <span className="status status-good"> ✓ Hit</span>}
          {over && <span className="status status-warn"> ▲ Over</span>}
        </span>
      </div>

      <div className="goal-foot">
        <span className="muted small">{s > 0 ? `🔥 ${s}-${PERIOD_NOUN[goal.period]} streak` : `This ${PERIOD_NOUN[goal.period]}`}</span>
        <form className="log-form" onSubmit={submitLog}>
          <input className="input input-sm" type="number" min={0} step="any" inputMode="decimal" placeholder={goal.unit} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Log ${goal.unit} for ${goal.title}`} />
          <button className="btn btn-secondary btn-sm" type="submit" disabled={!amount}>Log</button>
        </form>
      </div>
      {error && <p className="form-error small">{error}</p>}
    </article>
  );
}
