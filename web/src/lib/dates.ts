import type { GoalPeriod } from "./types";

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toISODate(new Date());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Start of the period containing `d`. Weeks start on Monday. */
export function periodStart(d: Date, period: GoalPeriod): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (period === "weekly") r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  if (period === "monthly") r.setDate(1);
  if (period === "yearly") r.setMonth(0, 1);
  return r;
}

/** Exclusive end of the period that starts at `start`. */
export function periodEnd(start: Date, period: GoalPeriod): Date {
  const r = new Date(start);
  if (period === "daily") r.setDate(r.getDate() + 1);
  if (period === "weekly") r.setDate(r.getDate() + 7);
  if (period === "monthly") r.setMonth(r.getMonth() + 1);
  if (period === "yearly") r.setFullYear(r.getFullYear() + 1);
  return r;
}

/** Start of the period `n` periods before the one containing `d`. */
export function shiftPeriod(start: Date, period: GoalPeriod, n: number): Date {
  const r = new Date(start);
  if (period === "daily") r.setDate(r.getDate() + n);
  if (period === "weekly") r.setDate(r.getDate() + 7 * n);
  if (period === "monthly") r.setMonth(r.getMonth() + n);
  if (period === "yearly") r.setFullYear(r.getFullYear() + n);
  return r;
}

export function periodLabel(start: Date, period: GoalPeriod): string {
  if (period === "daily") return start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (period === "weekly") return `Wk of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  if (period === "monthly") return start.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return String(start.getFullYear());
}

export const PERIOD_NOUN: Record<GoalPeriod, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};
