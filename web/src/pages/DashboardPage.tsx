import { useState } from "react";
import { Link } from "react-router-dom";
import { useDB } from "../lib/db";
import { currentUser, friendsOf, loadSampleData } from "../lib/api";
import { CATEGORIES, PERIODS } from "../lib/meta";
import { WINDOW, daysAgo, formatAmount, hitRate, streak, studyHoursBetween, studyHoursByDay } from "../lib/goals";
import { PERIOD_NOUN, addDays, fromISODate, periodEnd, periodStart, shiftPeriod } from "../lib/dates";
import type { Goal, GoalPeriod } from "../lib/types";
import { BarChart, type Bar } from "../components/BarChart";

type Range = "30d" | "12w";

const fmtHours = (h: number) => (h >= 10 ? Math.round(h).toString() : h.toFixed(1).replace(/\.0$/, ""));

export function DashboardPage() {
  const db = useDB();
  const me = currentUser(db)!;
  const [range, setRange] = useState<Range>("30d");

  const goals = db.goals.filter((g) => g.userId === me.id && !g.archived);
  const logs = db.logs.filter((l) => l.userId === me.id);
  const friends = friendsOf(db, me.id);
  const now = new Date();

  if (goals.length === 0) {
    return (
      <div className="page">
        <Greeting name={me.displayName} />
        <div className="card empty stack">
          <p>Your dashboard fills in once you have goals. Set one, or load a few months of sample data to see how it works.</p>
          <div className="row-actions wrap center">
            <Link to="/goals" className="btn btn-primary">Set a goal</Link>
            <button className="btn btn-secondary" onClick={loadSampleData}>Load sample data</button>
          </div>
        </div>
      </div>
    );
  }

  const monthStart = periodStart(now, "monthly");
  const lastMonthStart = shiftPeriod(monthStart, "monthly", -1);
  const studyThisMonth = studyHoursBetween(goals, logs, monthStart, periodEnd(monthStart, "monthly"));
  // Compare against the same number of days into last month, so early-month numbers aren't unfairly low.
  const sameDayLastMonth = addDays(lastMonthStart, now.getDate());
  const studyLastMonthToDate = studyHoursBetween(goals, logs, lastMonthStart, sameDayLastMonth < monthStart ? sameDayLastMonth : monthStart);
  const delta = studyThisMonth - studyLastMonthToDate;
  const hasStudyGoal = goals.some((g) => g.category === "study");

  const bars: Bar[] =
    range === "30d"
      ? studyHoursByDay(goals, logs, 30, now).map((d, i, arr) => ({
          key: d.date.toISOString(),
          label: d.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
          tick: i % 7 === (arr.length - 1) % 7 ? d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : undefined,
          value: d.hours,
          display: `${fmtHours(d.hours)} h`,
        }))
      : Array.from({ length: 12 }, (_, i) => {
          const start = shiftPeriod(periodStart(now, "weekly"), "weekly", i - 11);
          const h = studyHoursBetween(goals, logs, start, periodEnd(start, "weekly"));
          const label = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          return { key: start.toISOString(), label: `Week of ${label}`, tick: i % 3 === 2 ? label : undefined, value: h, display: `${fmtHours(h)} h` };
        });

  const summaries = PERIODS.map((p) => {
    const list = goals.filter((g) => g.period === p.key);
    let hits = 0;
    let possible = 0;
    for (const g of list) {
      const r = hitRate(g, logs, WINDOW[p.key], now);
      hits += r.hits;
      possible += r.possible;
    }
    return { period: p.key, label: p.label, count: list.length, hits, possible };
  }).filter((s) => s.count > 0);

  const bestStreak = goals
    .map((g) => ({ g, s: streak(g, logs, now) }))
    .sort((a, b) => b.s - a.s)[0];

  const recent = [...logs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 6);

  return (
    <div className="page">
      <Greeting name={me.displayName} friends={friends.length} />

      <section className="hero-row">
        <div className="card hero">
          <p className="eyebrow">Study hours this month</p>
          <p className="hero-figure">{fmtHours(studyThisMonth)}<span className="hero-unit">h</span></p>
          {hasStudyGoal ? (
            <p className="muted small">
              {delta >= 0 ? "▲" : "▼"} {fmtHours(Math.abs(delta))} h {delta >= 0 ? "more" : "less"} than this point last month
            </p>
          ) : (
            <p className="muted small">Add a study goal in minutes or hours to track this.</p>
          )}
        </div>
        <div className="kpis">
          {summaries.map((s) => (
            <div key={s.period} className="card kpi">
              <p className="eyebrow">{s.label} goals met</p>
              {s.possible > 0 ? (
                <p className="kpi-value">
                  {s.hits}
                  <span className="kpi-of"> / {s.possible}</span>
                </p>
              ) : (
                <p className="kpi-value kpi-pending">In progress</p>
              )}
              <p className="muted small">
                {s.count} goal{s.count > 1 ? "s" : ""}
                {s.possible > 0 ? `, last ${WINDOW[s.period]} ${PERIOD_NOUN[s.period]}s` : `, first ${PERIOD_NOUN[s.period]} not over yet`}
              </p>
            </div>
          ))}
          {bestStreak && bestStreak.s > 0 && (
            <div className="card kpi">
              <p className="eyebrow">Best current streak</p>
              <p className="kpi-value">🔥 {bestStreak.s}</p>
              <p className="muted small">{PERIOD_NOUN[bestStreak.g.period]}s in a row: {bestStreak.g.title}</p>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="filters">
          <div className="segmented" role="radiogroup" aria-label="Range">
            {(["30d", "12w"] as Range[]).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={range === r} className={range === r ? "is-active" : ""} onClick={() => setRange(r)}>
                {r === "30d" ? "Last 30 days" : "Last 12 weeks"}
              </button>
            ))}
          </div>
        </div>
        <BarChart title={range === "30d" ? "Study hours per day" : "Study hours per week"} unit="Hours" bars={bars} />
      </section>

      <section className="stack">
        <div className="section-head">
          <h2>Goal history</h2>
          <span className="legend small">
            <span className="dot dot-hit" aria-hidden /> Met
            <span className="dot dot-miss" aria-hidden /> Missed
            <span className="dot dot-open" aria-hidden /> In progress
          </span>
        </div>
        <div className="goal-cards">
          {goals.map((g) => <GoalScorecard key={g.id} goal={g} logs={logs} />)}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Recent activity</h2>
        <ul className="activity">
          {recent.map((l) => {
            const g = goals.find((x) => x.id === l.goalId);
            if (!g) return null;
            const ago = daysAgo(l.date);
            return (
              <li key={l.id}>
                <span aria-hidden>{CATEGORIES.find((c) => c.key === g.category)?.icon}</span>
                <span>
                  <strong>{formatAmount(g, l.amount)}</strong> · {g.title}
                </span>
                <span className="muted small">
                  {ago === 0 ? "Today" : ago === 1 ? "Yesterday" : fromISODate(l.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Greeting({ name, friends }: { name: string; friends?: number }) {
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  return (
    <header className="page-head">
      <h1>Good {part}, {name.split(" ")[0]}</h1>
      <p className="muted">
        Here's how your goals are going.
        {friends !== undefined && (friends > 0 ? ` Your agent is keeping ${friends} friend${friends > 1 ? "s" : ""} in the loop.` : " ")}
        {friends === 0 && <Link to="/friends">Add friends</Link>}
      </p>
    </header>
  );
}

function GoalScorecard({ goal, logs }: { goal: Goal; logs: Parameters<typeof hitRate>[1] }) {
  const period: GoalPeriod = goal.period;
  const { hits, possible, history } = hitRate(goal, logs, WINDOW[period]);
  const cat = CATEGORIES.find((c) => c.key === goal.category)!;
  const pct = possible ? Math.round((hits / possible) * 100) : 0;
  const cur = history[history.length - 1];

  return (
    <article className="card scorecard">
      <header>
        <span aria-hidden>{cat.icon}</span>
        <strong>{goal.title}</strong>
      </header>
      {possible > 0 ? (
        <p className="score">
          <span className="score-big">{hits}</span>
          <span className="muted"> of {possible} {PERIOD_NOUN[period]}s · {pct}%</span>
        </p>
      ) : (
        <p className="score muted">First {PERIOD_NOUN[period]} in progress</p>
      )}
      <div className={`dots dots-${period}`} role="list" aria-label={`${goal.title} history`}>
        {history.map((p) => {
          const state = p.current && !p.hit ? "open" : p.hit ? "hit" : "miss";
          return (
            <span
              key={p.label}
              role="listitem"
              className={`dot dot-${state}`}
              title={`${p.label}: ${formatAmount(goal, p.total)} ${state === "hit" ? "✓ met" : state === "open" ? "(in progress)" : "✕ missed"}`}
              aria-label={`${p.label}: ${state === "hit" ? "met" : state === "open" ? "in progress" : "missed"}`}
            />
          );
        })}
      </div>
      {cur && (
        <p className="muted small">
          {period === "daily" ? "Today" : `This ${PERIOD_NOUN[period]}`}: {formatAmount(goal, cur.total)} of {formatAmount(goal, goal.target)}
          {goal.direction === "atMost" ? " max" : ""}
        </p>
      )}
    </article>
  );
}
