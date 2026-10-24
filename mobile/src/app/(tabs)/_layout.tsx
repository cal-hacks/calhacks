import { useEffect } from "react";
import { AppState } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useDB } from "../../lib/db";
import { currentUser } from "../../lib/api";
import { connectAs, syncGoals, syncProfile, useLive } from "../../lib/live";
import { syncBusyTimes } from "../../lib/agentApi";
import { useColors } from "../../components/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: string; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };

export default function TabsLayout() {
  const db = useDB();
  const c = useColors();
  const me = currentUser(db);
  const pending = me ? db.connections.filter((x) => x.toId === me.id && x.status === "pending").length : 0;
  const live = useLive();
  const calendarOn = live.myConsent.some((r) => r.source === "calendar" && r.shareLevel !== "off");

  // Join the live group as this account, then push what friends should see.
  useEffect(() => {
    if (me) connectAs(me);
  }, [me?.id]);
  useEffect(() => {
    if (!me || live.status !== "ready") return;
    syncProfile(me);
    syncGoals(me.id, db.goals, db.logs);
    // Once per connection; later changes are pushed by api.ts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.status, me?.id]);
  // Busy times from the phone's calendars, now and whenever the app comes back.
  useEffect(() => {
    if (live.status !== "ready" || !calendarOn) return;
    const sync = () => syncBusyTimes().catch(() => {});
    sync();
    const sub = AppState.addEventListener("change", (state) => state === "active" && sync());
    return () => sub.remove();
  }, [live.status, calendarOn]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.text3,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
      }}
    >
      <Tabs.Screen name="group" options={{ title: "Group", tabBarIcon: icon("chatbubbles") }} />
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: icon("stats-chart") }} />
      <Tabs.Screen name="goals" options={{ title: "Goals", tabBarIcon: icon("flag") }} />
      <Tabs.Screen name="agent" options={{ title: "Agent", tabBarIcon: icon("chatbubble-ellipses") }} />
      <Tabs.Screen name="friends" options={{ title: "Friends", tabBarIcon: icon("people"), tabBarBadge: pending || undefined }} />
      <Tabs.Screen name="settings" options={{ title: "Profile", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}
