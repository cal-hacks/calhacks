import { useState } from "react";
import { Pressable, View } from "react-native";
import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { useDB } from "../../lib/db";
import { ApiError, createGoal, currentUser, permissionsOf, updateGoal } from "../../lib/api";
import { CATEGORIES, GOAL_TEMPLATES, PERIODS, SOURCES } from "../../lib/meta";
import { PERIOD_NOUN } from "../../lib/dates";
import type { Goal, GoalPeriod, Permissions, TrackingSource } from "../../lib/types";
import { Button, Card, Chip, Chips, ErrorText, Input, Row, Screen, Segmented, ToggleList, ToggleRow, Txt } from "../../components/ui";
import { useColors } from "../../components/theme";

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

function sourceNeedsPermission(source: TrackingSource, perms: Permissions): string | null {
  if (source === "location" && perms.location !== "granted") return "Location access is off";
  if (source === "screenTime" && perms.screenTime === "off") return "Screen Time isn't connected";
  if (source === "calendar" && !Object.values(perms.calendars).some((c) => c.connected) && !perms.calendarAccounts?.length) return "No calendar is connected";
  return null;
}

/** Create (id = "new", optional template index) or edit a goal. Presented as a modal. */
export default function GoalEditor() {
  const { id, template } = useLocalSearchParams<{ id: string; template?: string }>();
  const db = useDB();
  const c = useColors();
  const me = currentUser(db);
  const existing = db.goals.find((g) => g.id === id);
  const isNew = id === "new" || !existing;

  const [d, setD] = useState<Draft>(() => {
    if (existing) return { ...existing, place: existing.place ?? "" };
    const t = template !== undefined ? GOAL_TEMPLATES[Number(template)] : undefined;
    if (!t) return BLANK;
    const { icon: _icon, ...rest } = t;
    return { ...BLANK, ...rest, place: rest.place ?? "" };
  });
  const [targetText, setTargetText] = useState(String(d.target));
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  const perms = permissionsOf(db, me.id);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const missing = sourceNeedsPermission(d.trackBy, perms);

  const save = () => {
    try {
      const target = Number(targetText);
      if (!d.title.trim()) throw new ApiError("Give your goal a name.");
      if (!(target > 0)) throw new ApiError("Target must be more than zero.");
      if (d.trackBy === "location" && !d.place?.trim()) throw new ApiError("Name the place to track, like “Green Library”.");
      const out = { ...d, target, title: d.title.trim(), place: d.trackBy === "location" ? d.place?.trim() : undefined };
      if (isNew) createGoal(out);
      else updateGoal(existing!.id, out);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save goal.");
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: isNew ? "New goal" : "Edit goal",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
              <Txt style={{ color: c.text, textDecorationLine: "underline" }}>Cancel</Txt>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={save} hitSlop={10} accessibilityRole="button">
              <Txt bold style={{ color: c.text, textDecorationLine: "underline" }}>Save</Txt>
            </Pressable>
          ),
        }}
      />
      <Screen header>
        <Input label="Goal" value={d.title} onChangeText={(v) => set("title", v)} placeholder="Spend 2 hours at the library" autoFocus={isNew && !template} />

        <View style={{ gap: 6 }}>
          <Txt small bold>Category</Txt>
          <Chips>
            {CATEGORIES.map((x) => (
              <Chip key={x.key} label={`${x.icon} ${x.label}`} active={d.category === x.key} onPress={() => set("category", x.key)} />
            ))}
          </Chips>
          {d.category === "study" && <Txt small muted>Study goals measured in time count toward “study hours” on your dashboard.</Txt>}
        </View>

        <View style={{ gap: 6 }}>
          <Txt small bold>Every</Txt>
          <Segmented<GoalPeriod> value={d.period} options={PERIODS.map((p) => ({ key: p.key, label: PERIOD_NOUN[p.key] }))} onChange={(v) => set("period", v)} />
        </View>

        <View style={{ gap: 6 }}>
          <Txt small bold>Target</Txt>
          <Segmented
            value={d.direction}
            options={[
              { key: "atLeast", label: "At least" },
              { key: "atMost", label: "At most" },
            ]}
            onChange={(v) => set("direction", v)}
          />
          <Row>
            <View style={{ width: 110 }}>
              <Input value={targetText} onChangeText={setTargetText} keyboardType="decimal-pad" accessibilityLabel="Target amount" />
            </View>
            <Txt muted>{d.unit} per {PERIOD_NOUN[d.period]}</Txt>
          </Row>
          <Chips>
            {UNITS.map((u) => (
              <Chip key={u} label={u} active={d.unit === u} onPress={() => set("unit", u)} />
            ))}
          </Chips>
        </View>

        <View style={{ gap: 6 }}>
          <Txt small bold>How should your agent track it?</Txt>
          <View style={{ gap: 8 }}>
            {SOURCES.map((s) => {
              const active = d.trackBy === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => set("trackBy", s.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{ padding: 12, borderRadius: 12, borderWidth: 2, borderColor: c.border, backgroundColor: active ? c.accent : c.surface }}
                >
                  <Txt bold>{s.label}</Txt>
                  <Txt small muted>{s.hint}</Txt>
                </Pressable>
              );
            })}
          </View>
          {missing && (
            <Card style={{ backgroundColor: c.warnSoft, borderColor: c.warnSoft, padding: 12 }}>
              <Txt small style={{ color: c.warn }}>
                ⚠️ {missing}.{" "}
                <Link href="/settings" style={{ fontWeight: "700" }} onPress={() => router.back()}>
                  Turn it on in Profile
                </Link>
                , or log progress by hand until then.
              </Txt>
            </Card>
          )}
        </View>

        {d.trackBy === "location" && (
          <Input
            label="Place"
            value={d.place}
            onChangeText={(v) => set("place", v)}
            placeholder="Green Library"
            hint="Your agent counts time spent here. The place itself is only shared if you allow Places for a friend."
          />
        )}

        <ToggleList>
          <ToggleRow
            last
            icon="🫂"
            label="Let my agent share wins"
            hint="Adds this goal as a sharing option on each friend's page."
            value={d.shareWithFriends}
            onChange={(v) => set("shareWithFriends", v)}
          />
        </ToggleList>

        <ErrorText>{error}</ErrorText>
        <Button title={isNew ? "Create goal" : "Save changes"} onPress={save} />
      </Screen>
    </>
  );
}
