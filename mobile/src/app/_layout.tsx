import { useEffect } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { PatrickHand_400Regular, useFonts } from "@expo-google-fonts/patrick-hand";
import { hydrate, useDB, useHydrated } from "../lib/db";
import { currentUser } from "../lib/api";
import { syncScreenTimeGoals } from "../lib/screenTime";
import { FONT, useColors } from "../components/theme";
import { Confetti } from "../components/Confetti";

export default function RootLayout() {
  const hydrated = useHydrated();
  const [fontsLoaded, fontError] = useFonts({ PatrickHand_400Regular });
  // If the font can't load, carry on in the system font rather than hang.
  const ready = hydrated && (fontsLoaded || !!fontError);
  const c = useColors();

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

  const base = DefaultTheme;
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, background: c.bg, card: c.bg, primary: c.text, text: c.text, border: c.border },
        fonts: Object.fromEntries(Object.entries(base.fonts).map(([k, v]) => [k, { ...v, fontFamily: FONT, fontWeight: "400" }])) as typeof base.fonts,
      }}
    >
      <StatusBar style="dark" />
      <Routes />
      <Confetti />
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
    <Stack
      screenOptions={{
        headerShown: false,
        headerTitleStyle: { fontFamily: FONT, fontSize: 22 },
        headerBackTitleStyle: { fontFamily: FONT },
        headerShadowVisible: false,
      }}
    >
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
