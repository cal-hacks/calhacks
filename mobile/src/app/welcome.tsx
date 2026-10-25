import { View } from "react-native";
import { router } from "expo-router";
import { useDB } from "../lib/db";
import { completeOnboarding, currentUser } from "../lib/api";
import { APP_NAME } from "../lib/meta";
import { SetupSteps } from "../components/SetupSteps";
import { Card, Screen, Txt } from "../components/ui";
import { Steps } from "../components/Steps";
import { useColors } from "../components/theme";

/** Shown once, right after sign-up. */
export default function WelcomeScreen() {
  const c = useColors();
  const me = currentUser(useDB());
  if (!me) return null;

  const finish = () => {
    completeOnboarding();
    // Wait a tick so the route guards have unlocked the tabs before navigating.
    setTimeout(() => router.replace({ pathname: "/friends", params: { welcome: "1" } }), 0);
  };

  return (
    <Screen title={`Welcome, ${me.displayName.split(" ")[0]}`} subtitle={`Connect what your ${APP_NAME} agent can use. Nothing is shared with friends yet: you'll pick that per friend next.`}>
      <Steps current={1} />
      <SetupSteps onFinish={finish} />
      <Card style={{ backgroundColor: c.accentSoft }}>
        <Txt small>
          <Txt small bold>How your agent uses this: </Txt>
          it filters out anything you haven't allowed before the AI sees it, only posts wins (never comparisons), and when it's unsure whether something is too personal, it doesn't share. Change any of it later in the Share tab.
        </Txt>
      </Card>
      <View style={{ height: 8 }} />
    </Screen>
  );
}
