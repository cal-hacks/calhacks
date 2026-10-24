import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useDB } from "../../lib/db";
import { currentUser, deleteGoal, logProgress } from "../../lib/api";
import { CATEGORIES, GOAL_TEMPLATES, PERIODS, SOURCES } from "../../lib/meta";
import { currentProgress, formatAmount, streak } from "../../lib/goals";
import { PERIOD_NOUN } from "../../lib/dates";
import type { DB, Goal } from "../../lib/types";
import { Button, Card, Chip, Chips, ErrorText, Eyebrow, Row, Screen, Txt } from "../../components/ui";
import { useColors } from "../../components/theme";

export default function GoalsScreen() {
  const db = useDB();
  const me = currentUser(db);
  if (!me) return null;
  const goals = db.goals.filter((g) => g.userId === me.id && !g.archived);

  return (
    <Screen
      title="Goals"
      subtitle="Set goals for the day, week, month or year. Your agent tracks them and can share wins with friends you choose."
      right={<Button small title="+ New" onPress={() => router.push("/goal/new")} />}
    >
      <View style={{ gap: 8 }}>
        <Eyebrow>Quick start</Eyebrow>
        <Chips>
          {GOAL_TEMPLATES.map((t, i) => (
            <Chip key={t.title} label={`${t.icon} ${t.title}`} onPress={() => router.push({ pathname: "/goal/[id]", params: { id: "new", template: String(i) } })} />
          ))}
        </Chips>
      </View>

      {goals.length === 0 ? (
        <Card style={{ alignItems: "center", paddingVertical: 28 }}>
          <Txt muted center>No goals yet. Try a quick start above, like studying at the library for 2 hours a day.</Txt>
        </Card>
      ) : (
        PERIODS.map((p) => {
          const list = goals.filter((g) => g.period === p.key);
          if (!list.length) return null;
          return (
            <View key={p.key} style={{ gap: 10 }}>
              <Eyebrow>{p.label}</Eyebrow>
              {list.map((g) => <GoalRow key={g.id} db={db} goal={g} />)}
            </View>
          );
        })
      )}
    </Screen>
  );
}

function GoalRow({ db, goal }: { db: DB; goal: Goal }) {
  const c = useColors();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { total, ratio, hit } = currentProgress(goal, db.logs);
  const s = streak(goal, db.logs);
  const cat = CATEGORIES.find((x) => x.key === goal.category)!;
  const src = SOURCES.find((x) => x.key === goal.trackBy)!;
  const atMost = goal.direction === "atMost";
  const over = atMost && total > goal.target;

  const submitLog = () => {
    try {
      logProgress(goal.id, Number(amount));
      setAmount("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that.");
    }
  };

  const onMore = () =>
    Alert.alert(goal.title, undefined, [
      { text: "Edit", onPress: () => router.push({ pathname: "/goal/[id]", params: { id: goal.id } }) },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          Alert.alert(`Delete “${goal.title}”?`, "Its history is deleted too.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => deleteGoal(goal.id) },
          ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);

  return (
    <Card>
      <Row gap={12} style={{ alignItems: "flex-start" }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 20 }}>{cat.icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Txt bold>{goal.title}</Txt>
          <Txt small muted>
            {atMost ? "At most" : "At least"} {formatAmount(goal, goal.target)} per {PERIOD_NOUN[goal.period]} · {src.label}
            {goal.place ? ` (${goal.place})` : ""} · {goal.shareWithFriends ? "🫂 shareable" : "🔒 private"}
          </Txt>
        </View>
        <Pressable onPress={onMore} hitSlop={10} accessibilityRole="button" accessibilityLabel={`More options for ${goal.title}`}>
          <Text style={{ color: c.text2, fontSize: 20 }}>•••</Text>
        </Pressable>
      </Row>

      <View style={{ gap: 6 }}>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: c.surface2, overflow: "hidden" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: goal.target, now: total }}>
          <View style={{ height: 8, width: `${Math.min(100, ratio * 100)}%`, borderRadius: 999, backgroundColor: over ? c.warn : hit ? c.good : c.series1 }} />
        </View>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt small muted>{s > 0 ? `🔥 ${s}-${PERIOD_NOUN[goal.period]} streak` : `This ${PERIOD_NOUN[goal.period]}`}</Txt>
          <Txt small>
            {formatAmount(goal, total)} / {formatAmount(goal, goal.target)}
            {!atMost && hit ? <Txt small style={{ color: c.good, fontWeight: "600" }}> ✓ Hit</Txt> : null}
            {over ? <Txt small style={{ color: c.warn, fontWeight: "600" }}> ▲ Over</Txt> : null}
          </Txt>
        </Row>
      </View>

      <Row>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder={`Log ${goal.unit}`}
          placeholderTextColor={c.text3}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={submitLog}
          accessibilityLabel={`Log ${goal.unit} for ${goal.title}`}
          style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, color: c.text, backgroundColor: c.surface }}
        />
        <Button small variant="secondary" title="Log" disabled={!amount} onPress={submitLog} />
      </Row>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
