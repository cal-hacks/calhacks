import type { Goal, GoalLog, GoalPeriod } from "./types";
import { fromISODate, periodEnd, periodLabel, periodStart, shiftPeriod, toISODate } from "./dates";

export interface PeriodResult {
  start: Date;
  label: string;
  total: number;
  hasData: boolean;
  hit: boolean;
  /** The period that contains today. */
  current: boolean;
}

function sumBetween(logs: GoalLog[], start: Date, end: Date) {
  const s = toISODate(start);
  const e = toISODate(end);
  let total = 0;
  let hasData = false;
  for (const l of logs) {
    if (l.date >= s && l.date < e) {
      total += l.amount;
      hasData = true;
    }
  }
  return { total, hasData };
}

/**
 * "At most" goals (e.g. screen time) only count as hit once the period is over
 * and there is data for it; "at least" goals count as soon as the target is reached.
 */
function evaluate(goal: Goal, total: number, hasData: boolean, current: boolean) {
  if (goal.direction === "atLeast") return total >= goal.target;
  return !current && hasData && total <= goal.target;
}

/** The last `count` periods for a goal, oldest first, ending with the current one. */
export function goalHistory(goal: Goal, logs: GoalLog[], count: number, now = new Date()): PeriodResult[] {
  const own = logs.filter((l) => l.goalId === goal.id);
  const currentStart = periodStart(now, goal.period);
  const createdStart = periodStart(new Date(goal.createdAt), goal.period);
  const out: PeriodResult[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = shiftPeriod(currentStart, goal.period, -i);
    if (start < createdStart) continue;
    const { total, hasData } = sumBetween(own, start, periodEnd(start, goal.period));
    const current = i === 0;
    out.push({ start, label: periodLabel(start, goal.period), total, hasData, hit: evaluate(goal, total, hasData, current), current });
  }
  return out;
}

export function currentProgress(goal: Goal, logs: GoalLog[], now = new Date()) {
  const [cur] = goalHistory(goal, logs, 1, now);
  const total = cur?.total ?? 0;
  const ratio = goal.target > 0 ? total / goal.target : 0;
  return { total, ratio, hit: cur?.hit ?? false, hasData: cur?.hasData ?? false };
}

/** Hits over a window. The in-progress period counts only if it's already hit. */
export function hitRate(goal: Goal, logs: GoalLog[], count: number, now = new Date()) {
  const hist = goalHistory(goal, logs, count, now);
  const scored = hist.filter((p) => !p.current || p.hit);
  return { hits: scored.filter((p) => p.hit).length, possible: scored.length, history: hist };
}

/** Consecutive hit periods ending now (or at the last complete period, if the current one isn't hit yet). */
export function streak(goal: Goal, logs: GoalLog[], now = new Date()): number {
  const hist = goalHistory(goal, logs, 400, now);
  let i = hist.length - 1;
  if (i >= 0 && hist[i].current && !hist[i].hit) i--;
  let n = 0;
  for (; i >= 0 && hist[i].hit; i--) n++;
  return n;
}

/** How many periods of history to show/score by default for each cadence. */
export const WINDOW: Record<GoalPeriod, number> = { daily: 30, weekly: 12, monthly: 6, yearly: 3 };

export function toHours(goal: Goal, amount: number): number | null {
  if (goal.unit === "minutes") return amount / 60;
  if (goal.unit === "hours") return amount;
  return null;
}

/** Study hours per calendar day across all study goals measured in time. */
export function studyHoursByDay(goals: Goal[], logs: GoalLog[], days: number, now = new Date()) {
  const studyGoals = new Map(goals.filter((g) => g.category === "study" && toHours(g, 1) !== null).map((g) => [g.id, g]));
  const byDate = new Map<string, number>();
  for (const l of logs) {
    const g = studyGoals.get(l.goalId);
    if (g) byDate.set(l.date, (byDate.get(l.date) ?? 0) + (toHours(g, l.amount) ?? 0));
  }
  const out: { date: Date; hours: number }[] = [];
  const end = periodStart(now, "daily");
  for (let i = days - 1; i >= 0; i--) {
    const d = shiftPeriod(end, "daily", -i);
    out.push({ date: d, hours: byDate.get(toISODate(d)) ?? 0 });
  }
  return out;
}

export function studyHoursBetween(goals: Goal[], logs: GoalLog[], start: Date, end: Date) {
  const s = toISODate(start);
  const e = toISODate(end);
  let h = 0;
  for (const l of logs) {
    if (l.date < s || l.date >= e) continue;
    const g = goals.find((x) => x.id === l.goalId);
    if (g?.category === "study") h += toHours(g, l.amount) ?? 0;
  }
  return h;
}

export function formatAmount(goal: Goal, amount: number): string {
  if (goal.unit === "minutes" && amount >= 60) {
    const h = Math.floor(amount / 60);
    const m = Math.round(amount % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const n = Number.isInteger(amount) ? amount : amount.toFixed(1);
  if (goal.unit === "times") return `${n}×`;
  return `${n} ${goal.unit}`;
}

export function daysAgo(dateStr: string): number {
  return Math.round((Date.now() - fromISODate(dateStr).getTime()) / 86_400_000);
}
