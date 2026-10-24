import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useDB } from "../../lib/db";
import { currentUser } from "../../lib/api";
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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.text3,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: icon("stats-chart") }} />
      <Tabs.Screen name="goals" options={{ title: "Goals", tabBarIcon: icon("flag") }} />
      <Tabs.Screen name="agent" options={{ title: "Agent", tabBarIcon: icon("chatbubble-ellipses") }} />
      <Tabs.Screen name="friends" options={{ title: "Friends", tabBarIcon: icon("people"), tabBarBadge: pending || undefined }} />
      <Tabs.Screen name="settings" options={{ title: "Profile", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}
