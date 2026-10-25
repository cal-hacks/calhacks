import { Tabs } from "expo-router";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useDB } from "../../lib/db";
import { currentUser } from "../../lib/api";
import { FONT, useColors, waggle } from "../../components/theme";

// Ink stroke icons, filled honey when their tab is active.
type IconProps = { focused: boolean; size: number };
const stroke = { stroke: waggle.ink, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const fill = (on: boolean) => (on ? waggle.honey : "none");

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  index: ({ focused, size }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke}>
      <Path d="M4 20h16" />
      <Rect x="5.5" y="11" width="3" height="6" rx="1" fill={fill(focused)} />
      <Rect x="10.5" y="6" width="3" height="11" rx="1" fill={fill(focused)} />
      <Rect x="15.5" y="9" width="3" height="8" rx="1" fill={fill(focused)} />
    </Svg>
  ),
  goals: ({ focused, size }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke}>
      <Circle cx="12" cy="12" r="8.5" fill={fill(focused)} />
      <Circle cx="12" cy="12" r="4.5" fill={focused ? waggle.card : "none"} />
      <Circle cx="12" cy="12" r="1" />
    </Svg>
  ),
  agent: ({ focused, size }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <Path d="M4 5h16v11H9l-5 4z" fill={fill(focused)} />
    </Svg>
  ),
  friends: ({ focused, size }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke}>
      <Circle cx="9" cy="8.5" r="3.5" fill={fill(focused)} />
      <Path d="M2.5 19.5c.9-3.4 3.3-5 6.5-5s5.6 1.6 6.5 5" />
      <Path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 14.8c2 .6 3.4 2.2 4 4.7" />
    </Svg>
  ),
  settings: ({ focused, size }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke}>
      <Circle cx="12" cy="8.5" r="4" fill={fill(focused)} />
      <Path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" />
    </Svg>
  ),
};

const icon = (name: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return ICONS[name]({ focused, size: 26 });
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
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.text,
        tabBarLabelStyle: { fontFamily: FONT, fontSize: 14 },
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border, borderTopWidth: 2 },
        tabBarBadgeStyle: { backgroundColor: c.surface, color: c.text, borderWidth: 2, borderColor: c.border, fontFamily: FONT, fontSize: 12, lineHeight: 15 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: icon("index") }} />
      <Tabs.Screen name="goals" options={{ title: "Goals", tabBarIcon: icon("goals") }} />
      <Tabs.Screen name="agent" options={{ title: "Agent", tabBarIcon: icon("agent") }} />
      <Tabs.Screen name="friends" options={{ title: "Friends", tabBarIcon: icon("friends"), tabBarBadge: pending || undefined }} />
      <Tabs.Screen name="settings" options={{ title: "Profile", tabBarIcon: icon("settings") }} />
    </Tabs>
  );
}
