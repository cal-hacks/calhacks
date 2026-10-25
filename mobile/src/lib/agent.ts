import { getDB, mutate, newId } from "./db";
import { createGoal, currentUser, logProgress, updateGoal } from "./api";
import { WINDOW, currentProgress, formatAmount, hitRate, streak, studyHoursBetween } from "./goals";
import { PERIOD_NOUN, periodEnd, periodStart, today } from "./dates";
import type { Chat, ChatItem, Goal, GoalCategory, GoalPeriod, Id, TrackingSource } from "./types";
import { AGENT_URL } from "./agentApi";

// Client side of the agent chat. The agent service (agent/app/main.py) holds
// the Anthropic key and the tool definitions; this file runs the tool loop,
// executing each tool against on-device data. Tool names and fields must
// match agent/app/tools.py.

const AGENT_KEY = process.env.EXPO_PUBLIC_AGENT_KEY;
const MAX_TOOL_ROUNDS = 8;

type Block = { type: string; [k: string]: unknown };
type ApiMessage = Chat["api"][number];

interface ChatResponse {
  content: Block[];
  stop_reason: string | null;
}

export const agentConfigured = !!AGENT_URL;

export function chatFor(userId: Id): Chat {
  return getDB().chats?.find((c) => c.userId === userId) ?? { userId, api: [], items: [] };
}

function saveChat(chat: Chat) {
  mutate((db) => ({ ...db, chats: [...(db.chats ?? []).filter((c) => c.userId !== chat.userId), chat] }));
}

function item(role: ChatItem["role"], text: string): ChatItem {
  return { id: newId("m"), role, text, createdAt: Date.now() };
}

export function clearChat(userId: Id) {
  saveChat({ userId, api: [], items: [] });
}

async function callAgent(messages: ApiMessage[]): Promise<ChatResponse> {
  if (!AGENT_URL) throw new Error("The agent service URL isn't configured (EXPO_PUBLIC_AGENT_API_URL).");
  const res = await fetch(`${AGENT_URL}/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(AGENT_KEY ? { "X-Orbit-Key": AGENT_KEY } : {}) },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    let detail = `Agent service error (${res.status})`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      // Non-JSON error body; keep the status message.
    }
    throw new Error(detail);
  }
  return res.json();
}

function contextLine(): string {
  const now = new Date();
  let tz = "local time";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
  } catch {
    // Older Hermes builds without Intl time zones.
  }
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return `[Today is ${weekday}, ${today()} (${tz}).]`;
}

/**
 * Send one user message and run the tool loop until the agent replies.
 * Each step is saved as it happens so the UI updates live.
 */
export async function sendToAgent(userText: string): Promise<void> {
  const me = currentUser(getDB());
  if (!me) throw new Error("Signed out");
  let chat = chatFor(me.id);

  // The date line is stored in history, so earlier turns never change (append-only).
  const userMsg: ApiMessage = {
    role: "user",
    content: [
      { type: "text", text: contextLine() },
      { type: "text", text: userText },
    ],
  };
  chat = { ...chat, api: [...chat.api, userMsg], items: [...chat.items, item("user", userText)] };
  saveChat(chat);

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await callAgent(chat.api);
      const assistantMsg: ApiMessage = { role: "assistant", content: res.content };
      const texts = res.content.filter((b) => b.type === "text").map((b) => String(b.text)).filter((t) => t.trim());
      chat = {
        ...chat,
        api: [...chat.api, assistantMsg],
        items: [...chat.items, ...texts.map((t) => item("assistant", t))],
      };

      if (res.stop_reason === "refusal") {
        chat = { ...chat, items: [...chat.items, item("error", "I can't help with that one. Try asking another way.")] };
        break;
      }
      if (res.stop_reason !== "tool_use") break;

      // Run every tool call, then send all results back in one user message.
      const results: Block[] = [];
      const actions: ChatItem[] = [];
      for (const b of res.content.filter((x) => x.type === "tool_use")) {
        const { result, summary, isError } = runTool(String(b.name), (b.input ?? {}) as Record<string, unknown>);
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(result), ...(isError ? { is_error: true } : {}) });
        // Failed calls go back to the agent to fix; only successful changes are shown.
        if (summary && !isError) actions.push(item("action", summary));
      }
      chat = { ...chat, api: [...chat.api, { role: "user", content: results }], items: [...chat.items, ...actions] };
      saveChat(chat);
    }
  } catch (e) {
    chat = { ...chat, items: [...chat.items, item("error", e instanceof Error ? e.message : "Couldn't reach the agent.")] };
  }
  saveChat(chat);
}

// ---------- tools ----------

const PERIODS: GoalPeriod[] = ["daily", "weekly", "monthly", "yearly"];
const CATEGORIES: GoalCategory[] = ["study", "fitness", "wellness", "social", "custom"];
const SOURCES: TrackingSource[] = ["location", "calendar", "health", "screenTime", "manual"];

function myGoals(): Goal[] {
  const db = getDB();
  return db.goals.filter((g) => g.userId === db.session.userId && !g.archived);
}

function describeGoal(g: Goal) {
  const logs = getDB().logs;
  const { total, hit } = currentProgress(g, logs);
  return {
    id: g.id,
    title: g.title,
    category: g.category,
    period: g.period,
    target: g.target,
    unit: g.unit,
    direction: g.direction,
    track_by: g.trackBy,
    place: g.place ?? null,
    share_with_friends: g.shareWithFriends,
    this_period: { total, met: hit, progress: `${formatAmount(g, total)} of ${formatAmount(g, g.target)}` },
  };
}

function oneOf<T extends string>(v: unknown, allowed: T[], field: string): T {
  if (typeof v === "string" && (allowed as string[]).includes(v)) return v as T;
  throw new Error(`${field} must be one of ${allowed.join(", ")}`);
}

/** Execute a tool call. Errors become is_error results the agent can recover from. */
function runTool(name: string, input: Record<string, unknown>): { result: unknown; summary?: string; isError?: boolean } {
  try {
    switch (name) {
      case "list_goals":
        return { result: { goals: myGoals().map(describeGoal) } };

      case "create_goal": {
        const g = createGoal({
          title: String(input.title ?? ""),
          category: oneOf(input.category, CATEGORIES, "category"),
          period: oneOf(input.period, PERIODS, "period"),
          target: Number(input.target),
          unit: String(input.unit ?? "times"),
          direction: oneOf(input.direction, ["atLeast", "atMost"], "direction"),
          trackBy: oneOf(input.track_by, SOURCES, "track_by"),
          place: typeof input.place === "string" && input.place ? input.place : undefined,
          shareWithFriends: input.share_with_friends !== false,
        });
        return { result: { created: describeGoal(g) }, summary: `🎯 New goal: ${g.title} (${g.direction === "atMost" ? "at most" : "at least"} ${formatAmount(g, g.target)} per ${PERIOD_NOUN[g.period]})` };
      }

      case "log_progress": {
        const goal = myGoals().find((g) => g.id === input.goal_id);
        if (!goal) throw new Error(`No goal with id ${String(input.goal_id)}. Call list_goals first.`);
        const date = typeof input.date === "string" && input.date ? input.date : today();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
        if (date > today()) throw new Error("Can't log progress for a future date.");
        logProgress(goal.id, Number(input.amount), date, typeof input.note === "string" ? input.note : undefined);
        return { result: { logged: { amount: Number(input.amount), date }, goal: describeGoal(goal) }, summary: `✓ Logged ${formatAmount(goal, Number(input.amount))} · ${goal.title}${date !== today() ? ` (${date})` : ""}` };
      }

      case "update_goal": {
        const goal = myGoals().find((g) => g.id === input.goal_id);
        if (!goal) throw new Error(`No goal with id ${String(input.goal_id)}. Call list_goals first.`);
        const patch: Partial<Goal> = {};
        if (typeof input.title === "string" && input.title.trim()) patch.title = input.title.trim();
        if (input.period != null) patch.period = oneOf(input.period, PERIODS, "period");
        if (typeof input.target === "number") {
          if (!(input.target > 0)) throw new Error("target must be more than zero");
          patch.target = input.target;
        }
        if (typeof input.unit === "string" && input.unit) patch.unit = input.unit;
        if (typeof input.share_with_friends === "boolean") patch.shareWithFriends = input.share_with_friends;
        updateGoal(goal.id, patch);
        const updated = myGoals().find((g) => g.id === goal.id)!;
        return { result: { updated: describeGoal(updated) }, summary: `✏️ Updated ${updated.title}` };
      }

      case "get_progress_summary": {
        const goals = myGoals();
        const logs = getDB().logs;
        const monthStart = periodStart(new Date(), "monthly");
        return {
          result: {
            study_hours_this_month: Math.round(studyHoursBetween(goals, logs, monthStart, periodEnd(monthStart, "monthly")) * 10) / 10,
            goals: goals.map((g) => {
              const r = hitRate(g, logs, WINDOW[g.period]);
              return { ...describeGoal(g), recent: `met ${r.hits} of last ${r.possible} ${g.period} periods`, current_streak: streak(g, logs) };
            }),
          },
        };
      }

      default:
        throw new Error(`Unknown tool ${name}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { result: { error: message }, isError: true };
  }
}
