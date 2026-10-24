import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { ApiError, logIn, signInWithApple, signInWithGoogle, signUp, type GoogleProfile } from "../lib/api";
import { appleSignIn, appleSignInAvailable, googleConfigured, googleSignIn } from "../lib/integrations";
import { APP_NAME } from "../lib/meta";
import { DEMO_PASSWORD, DEMO_USERNAME } from "../lib/seed";
import { Button, Card, ErrorText, Input, Screen, Segmented, Txt } from "../components/ui";
import { useColors } from "../components/theme";

type Mode = "signup" | "login";

export default function AuthScreen() {
  const c = useColors();
  const [mode, setMode] = useState<Mode>("signup");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [demoGoogle, setDemoGoogle] = useState(false);

  useEffect(() => {
    appleSignInAvailable().then(setAppleAvailable).catch(() => {});
  }, []);

  // Signing in flips the route guards in _layout.tsx, which redirect to
  // /welcome for new accounts and to the dashboard otherwise.
  const finishGoogle = (p: GoogleProfile) => signInWithGoogle(p);

  const onGoogle = async () => {
    if (!googleConfigured) return setDemoGoogle(true);
    try {
      const p = await googleSignIn();
      if (p) finishGoogle(p);
    } catch (e) {
      Alert.alert("Google sign-in failed", e instanceof Error ? e.message : String(e));
    }
  };

  const onApple = async () => {
    try {
      const p = await appleSignIn();
      if (p) signInWithApple(p);
    } catch (e) {
      Alert.alert("Sign in with Apple failed", e instanceof Error ? e.message : String(e));
    }
  };

  const submit = () => {
    setError(null);
    try {
      if (mode === "signup") {
        if (password !== confirm) throw new ApiError("Passwords don't match.");
        signUp({ username, password, displayName });
      } else {
        logIn(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <View style={{ gap: 10, paddingTop: 24, paddingBottom: 8 }}>
          <Text style={{ color: c.accent, fontSize: 22, fontWeight: "700" }}>◎ {APP_NAME}</Text>
          <Text style={{ color: c.text, fontSize: 30, fontWeight: "700", letterSpacing: -0.3 }}>Stay in each other's lives after graduation.</Text>
          <Txt muted>Your agent notices the wins worth sharing and turns them into plans with the friends who moved away.</Txt>
        </View>

        <Card>
          <Segmented<Mode>
            value={mode}
            options={[
              { key: "signup", label: "Sign up" },
              { key: "login", label: "Log in" },
            ]}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
          />

          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={mode === "signup" ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={999}
              style={{ height: 48 }}
              onPress={onApple}
            />
          )}
          <Button variant="secondary" title={mode === "signup" ? "Sign up with Google" : "Continue with Google"} icon={<Text style={{ fontWeight: "800", color: "#4285F4" }}>G</Text>} onPress={onGoogle} />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
            <Txt small muted>or with a username</Txt>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          </View>

          {mode === "signup" && <Input label="Your name" value={displayName} onChangeText={setDisplayName} placeholder="Riley Chen" textContentType="name" autoComplete="name" />}
          <Input label="Username" value={username} onChangeText={setUsername} placeholder="riley.c" autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username" />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder={mode === "signup" ? "At least 8 characters" : ""}
            textContentType={mode === "signup" ? "newPassword" : "password"}
            onSubmitEditing={mode === "login" ? submit : undefined}
          />
          {mode === "signup" && <Input label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" onSubmitEditing={submit} />}
          <ErrorText>{error}</ErrorText>
          <Button title={mode === "signup" ? "Create account" : "Log in"} onPress={submit} />
          {mode === "login" && (
            <Txt small muted center>
              Exploring? Log in as {DEMO_USERNAME} / {DEMO_PASSWORD} to see a filled-in account.
            </Txt>
          )}
        </Card>
      </Screen>

      <DemoGoogleSheet visible={demoGoogle} onClose={() => setDemoGoogle(false)} onProfile={(p) => { setDemoGoogle(false); finishGoogle(p); }} />
    </KeyboardAvoidingView>
  );
}

/** Stand-in for Google sign-in until EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is configured. */
function DemoGoogleSheet({ visible, onClose, onProfile }: { visible: boolean; onClose: () => void; onProfile: (p: GoogleProfile) => void }) {
  const c = useColors();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const submit = () => {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return;
    onProfile({ sub: `demo-${e}`, email: e, name: name.trim() || e.split("@")[0] });
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 20, gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Txt bold style={{ fontSize: 18 }}>Continue with Google</Txt>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Txt style={{ color: c.accent }}>Cancel</Txt></Pressable>
        </View>
        <Txt small muted>Demo mode: Google sign-in isn't configured in this build, so enter the account to simulate.</Txt>
        <Input label="Google email" value={email} onChangeText={setEmail} placeholder="you@gmail.com" keyboardType="email-address" autoCapitalize="none" autoFocus />
        <Input label="Name" value={name} onChangeText={setName} placeholder="Your name" />
        <Button title="Continue" onPress={submit} disabled={!email.includes("@")} />
      </View>
    </Modal>
  );
}
