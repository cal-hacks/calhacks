import { useEffect } from "react";
import { ActivityIndicator, AppState, View, useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { hydrate, useDB, useHydrated } from "../lib/db";
import { currentUser } from "../lib/api";
import { syncScreenTimeGoals } from "../lib/screenTime";
import { useColors } from "../components/theme";

export default function RootLayout() {
  const ready = useHydrated();
  const c = useColors();
  const scheme = useColorScheme();

  useEffect(() => {
    hydrate().then(syncScreenTimeGoals);
    // Screen Time events accrue in the background; pick them up on return.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") syncScreenTimeGoals();
    });
    return () => sub.remove();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: c.bg, card: c.surface, primary: c.accent, text: c.text, border: c.border } }}>
      <StatusBar style="auto" />
      <Routes />
    </ThemeProvider>
  );
}

/**
 * Route guards:
 * - signed out → auth only
 * - signed up but not onboarded → welcome (permissions), shown once
 * - onboarded → the app; permissions are managed in Settings from then on
 */
function Routes() {
  const me = currentUser(useDB());
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="auth" />
      </Stack.Protected>
      <Stack.Protected guard={!!me && !me.onboarded}>
        <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!me?.onboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="goal/[id]" options={{ presentation: "modal", headerShown: true, title: "Goal" }} />
        <Stack.Screen name="friend/[id]" options={{ headerShown: true, title: "", headerBackTitle: "Friends" }} />
        <Stack.Screen name="share" options={{ headerShown: true, title: "Share with your agent", headerBackTitle: "Back" }} />
      </Stack.Protected>
    </Stack>
  );
}
