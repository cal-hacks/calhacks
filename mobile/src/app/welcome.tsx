import { View } from "react-native";
import { router } from "expo-router";
import { useDB } from "../lib/db";
import { completeOnboarding, currentUser } from "../lib/api";
import { APP_NAME } from "../lib/meta";
import { PermissionCards } from "../components/PermissionCards";
import { Button, Card, Row, Screen, Txt } from "../components/ui";
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
    <Screen title={`Welcome, ${me.displayName.split(" ")[0]}`} subtitle={`Choose what your ${APP_NAME} agent can see. Nothing is shared with friends yet: you'll pick that per friend next.`}>
      <Steps current={1} />
      <PermissionCards />
      <Card style={{ backgroundColor: c.accentSoft }}>
        <Txt small>
          <Txt small bold>How your agent uses this: </Txt>
          it filters out anything you haven't allowed before the AI sees it, only posts wins (never comparisons), and when it's unsure whether something is too personal, it doesn't share.
        </Txt>
      </Card>
      <Row>
        <Button variant="ghost" title="Skip for now" onPress={finish} style={{ flex: 1 }} />
        <Button title="Continue" onPress={finish} style={{ flex: 1 }} />
      </Row>
      <View style={{ height: 8 }} />
    </Screen>
  );
}
