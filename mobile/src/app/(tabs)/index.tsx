import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useDB } from "../../lib/db";
import { currentUser, friendsOf, loadSampleData } from "../../lib/api";
import { CATEGORIES, PERIODS } from "../../lib/meta";
import { WINDOW, daysAgo, formatAmount, hitRate, streak, studyHoursBetween, studyHoursByDay } from "../../lib/goals";
import { PERIOD_NOUN, addDays, fromISODate, periodEnd, periodStart, shiftPeriod } from "../../lib/dates";
import type { Goal, GoalLog } from "../../lib/types";
import { BarChart, type Bar } from "../../components/BarChart";
import { Button, Card, Eyebrow, H2, Row, Screen, Segmented, Txt } from "../../components/ui";
import { useColors } from "../../components/theme";

type Range = "30d" | "12w";

const fmtHours = (h: number) => (h >= 10 ? Math.round(h).toString() : h.toFixed(1).replace(/\.0$/, ""));

function greeting(name: string) {
  const h = new Date().getHours();
  return `Good ${h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"}, ${name.split(" ")[0]}`;
}

export default function DashboardScreen() {
  const db = useDB();
  const c = useColors();
  const me = currentUser(db);
  const [range, setRange] = useState<Range>("30d");
  if (!me) return null;

  const goals = db.goals.filter((g) => g.userId === me.id && !g.archived);
  const logs = db.logs.filter((l) => l.userId === me.id);
  const friends = friendsOf(db, me.id);
  const now = new Date();
  const subtitle = friends.length
    ? `Here's how your goals are going. Your agent is keeping ${friends.length} friend${friends.length > 1 ? "s" : ""} in the loop.`
    : "Here's how your goals are going.";

  if (goals.length === 0) {
    return (
      <Screen title={greeting(me.displayName)} subtitle={subtitle}>
        <Card style={{ alignItems: "center", paddingVertical: 28 }}>
          <Txt muted center>Your dashboard fills in once you have goals. Set one, or load a few months of sample data to see how it works.</Txt>
          <Row>
            <Button title="Set a goal" onPress={() => router.push("/goals")} />
            <Button variant="secondary" title="Load sample data" onPress={loadSampleData} />
          </Row>
        </Card>
      </Screen>
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

  const best = goals.map((g) => ({ g, s: streak(g, logs, now) })).sort((a, b) => b.s - a.s)[0];
  const recent = [...logs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 6);

  return (
    <Screen title={greeting(me.displayName)} subtitle={subtitle}>
      <Card>
        <Eyebrow>Study hours this month</Eyebrow>
        <Text style={{ color: c.text, fontSize: 56, fontWeight: "700", letterSpacing: -1 }}>
          {fmtHours(studyThisMonth)}
          <Text style={{ fontSize: 24, color: c.text2, fontWeight: "600" }}> h</Text>
        </Text>
        <Txt small muted>
          {hasStudyGoal
            ? `${delta >= 0 ? "▲" : "▼"} ${fmtHours(Math.abs(delta))} h ${delta >= 0 ? "more" : "less"} than this point last month`
            : "Add a study goal in minutes or hours to track this."}
        </Txt>
      </Card>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {summaries.map((s) => (
          <Card key={s.period} style={{ flexBasis: "47%", flexGrow: 1, gap: 4 }}>
            <Eyebrow>{s.label} goals met</Eyebrow>
            {s.possible > 0 ? (
              <Text style={{ color: c.text, fontSize: 28, fontWeight: "700" }}>
                {s.hits}
                <Text style={{ fontSize: 16, color: c.text2, fontWeight: "500" }}> / {s.possible}</Text>
              </Text>
            ) : (
              <Text style={{ color: c.text2, fontSize: 18, fontWeight: "700", paddingVertical: 5 }}>In progress</Text>
            )}
            <Txt small muted>
              {s.possible > 0 ? `Last ${WINDOW[s.period]} ${PERIOD_NOUN[s.period]}s` : `First ${PERIOD_NOUN[s.period]} not over yet`}
            </Txt>
          </Card>
        ))}
        {best && best.s > 0 && (
          <Card style={{ flexBasis: "47%", flexGrow: 1, gap: 4 }}>
            <Eyebrow>Best streak</Eyebrow>
            <Text style={{ color: c.text, fontSize: 28, fontWeight: "700" }}>🔥 {best.s}</Text>
            <Txt small muted>{PERIOD_NOUN[best.g.period]}s in a row: {best.g.title}</Txt>
          </Card>
        )}
      </View>

      <Card>
        <Segmented<Range>
          value={range}
          options={[
            { key: "30d", label: "Last 30 days" },
            { key: "12w", label: "Last 12 weeks" },
          ]}
          onChange={setRange}
        />
        <BarChart title={range === "30d" ? "Study hours per day" : "Study hours per week"} unit="Hours" bars={bars} />
      </Card>

      <Row style={{ justifyContent: "space-between" }} wrap>
        <H2>Goal history</H2>
        <Row gap={10}>
          <Legend color={c.good} label="Met" />
          <Legend color={c.miss} label="Missed" />
          <Legend outline={c.text3} label="Now" />
        </Row>
      </Row>
      {goals.map((g) => <Scorecard key={g.id} goal={g} logs={logs} />)}

      <Card>
        <H2>Recent activity</H2>
        {recent.map((l, i) => {
          const g = goals.find((x) => x.id === l.goalId);
          if (!g) return null;
          const ago = daysAgo(l.date);
          return (
            <Row key={l.id} gap={10} style={{ paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.border }}>
              <Text>{CATEGORIES.find((x) => x.key === g.category)?.icon}</Text>
              <Txt style={{ flex: 1 }}>
                <Txt bold>{formatAmount(g, l.amount)}</Txt> · {g.title}
              </Txt>
              <Txt small muted>{ago === 0 ? "Today" : ago === 1 ? "Yesterday" : fromISODate(l.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Txt>
            </Row>
          );
        })}
      </Card>
    </Screen>
  );
}

function Legend({ color, outline, label }: { color?: string; outline?: string; label: string }) {
  return (
    <Row gap={4}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color, borderWidth: outline ? 1.5 : 0, borderColor: outline }} />
      <Txt small muted>{label}</Txt>
    </Row>
  );
}

function Scorecard({ goal, logs }: { goal: Goal; logs: GoalLog[] }) {
  const c = useColors();
  const { hits, possible, history } = hitRate(goal, logs, WINDOW[goal.period]);
  const cat = CATEGORIES.find((x) => x.key === goal.category)!;
  const pct = possible ? Math.round((hits / possible) * 100) : 0;
  const cur = history[history.length - 1];
  const size = goal.period === "daily" ? 9 : 16;

  return (
    <Card style={{ gap: 8 }}>
      <Row>
        <Text>{cat.icon}</Text>
        <Txt bold style={{ flex: 1 }}>{goal.title}</Txt>
      </Row>
      {possible > 0 ? (
        <Txt>
          <Txt bold style={{ fontSize: 22 }}>{hits}</Txt>
          <Txt muted> of {possible} {PERIOD_NOUN[goal.period]}s · {pct}%</Txt>
        </Txt>
      ) : (
        <Txt muted>First {PERIOD_NOUN[goal.period]} in progress</Txt>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }} accessibilityLabel={`${goal.title}: met ${hits} of ${possible}`}>
        {history.map((p) => {
          const open = p.current && !p.hit;
          return (
            <View
              key={p.label}
              style={{ width: size, height: size, borderRadius: size > 10 ? 4 : 2.5, backgroundColor: open ? "transparent" : p.hit ? c.good : c.miss, borderWidth: open ? 1.5 : 0, borderColor: c.text3 }}
            />
          );
        })}
      </View>
      {cur && (
        <Txt small muted>
          {goal.period === "daily" ? "Today" : `This ${PERIOD_NOUN[goal.period]}`}: {formatAmount(goal, cur.total)} of {formatAmount(goal, goal.target)}
          {goal.direction === "atMost" ? " max" : ""}
        </Txt>
      )}
    </Card>
  );
}
