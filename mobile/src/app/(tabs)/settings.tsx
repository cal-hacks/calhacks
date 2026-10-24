import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { resetDB, useDB } from "../../lib/db";
import { ApiError, changePassword, currentUser, deleteAccount, logOut, updateProfile } from "../../lib/api";
import { pickAvatar } from "../../lib/integrations";
import { TIMEZONES } from "../../lib/meta";
import type { User } from "../../lib/types";
import { Avatar, Button, Card, Chip, ErrorText, Eyebrow, H2, Input, Row, Screen, ToggleList, ToggleRow, Txt } from "../../components/ui";
import { PermissionCards } from "../../components/PermissionCards";
import { useColors } from "../../components/theme";

const EMOJI = ["🙂", "📚", "🏃", "🎧", "🌻", "🚀", "🌊", "🍜", "🎨", "🪴", "⚡", "🐢", "🦙", "☕", "🎮", "🧗"];
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

export default function SettingsScreen() {
  const me = currentUser(useDB());
  if (!me) return null;
  return (
    <Screen title="Profile" subtitle="How friends see you, what your agent can access, and your account.">
      <ProfileSection key={me.id} me={me} />
      <View style={{ gap: 4 }}>
        <H2>Connected data</H2>
        <Txt small muted>Add another calendar or change what your agent can see.</Txt>
      </View>
      <PermissionCards />
      <Button variant="secondary" title="📤 What your agent shares with the group" onPress={() => router.push("/share")} />
      <AccountSection me={me} />
    </Screen>
  );
}

function draftOf(me: User) {
  return {
    displayName: me.displayName,
    bio: me.bio,
    city: me.city,
    timezone: me.timezone,
    email: me.email ?? "",
    phone: me.phone ?? "",
    avatar: me.avatar,
    profileVisibility: me.profileVisibility,
  };
}

function ProfileSection({ me }: { me: User }) {
  const c = useColors();
  const [draft, setDraft] = useState(() => draftOf(me));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(me));
  const timezones = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES];

  const onPhoto = async () => {
    try {
      const uri = await pickAvatar();
      if (uri) set("avatar", { ...draft.avatar, imageDataUrl: uri });
    } catch {
      setError("That photo couldn't be read.");
    }
  };

  const save = () => {
    if (!draft.displayName.trim()) return setError("Your name can't be empty.");
    setError(null);
    updateProfile({ ...draft, displayName: draft.displayName.trim(), email: draft.email.trim() || undefined, phone: draft.phone.trim() || undefined });
    setSaved(true);
  };

  const preview = { ...me, ...draft };

  return (
    <>
      <Card style={{ alignItems: "center", gap: 6 }}>
        <Eyebrow>What friends see</Eyebrow>
        <Avatar user={preview} size={88} />
        <H2>{draft.displayName || "Your name"}</H2>
        <Txt small muted>@{me.username}{draft.profileVisibility.city && draft.city ? ` · ${draft.city}` : ""}</Txt>
        {draft.profileVisibility.bio && draft.bio ? <Txt center>{draft.bio}</Txt> : null}
      </Card>

      <Card>
        <H2>Edit profile</H2>
        <Row wrap>
          <Button small variant="secondary" title="Choose photo" onPress={onPhoto} />
          {draft.avatar.imageDataUrl && <Button small variant="ghost" title="Use emoji instead" onPress={() => set("avatar", { ...draft.avatar, imageDataUrl: undefined })} />}
        </Row>
        {!draft.avatar.imageDataUrl && (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="Avatar emoji">
              {EMOJI.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => set("avatar", { ...draft.avatar, emoji: e })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft.avatar.emoji === e }}
                  style={{ width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: draft.avatar.emoji === e ? c.accentSoft : c.surface2, borderWidth: 1, borderColor: draft.avatar.emoji === e ? c.accent : "transparent" }}
                >
                  <Text style={{ fontSize: 18 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <Row wrap>
              {COLORS.map((col) => (
                <Pressable
                  key={col}
                  onPress={() => set("avatar", { ...draft.avatar, color: col })}
                  accessibilityRole="radio"
                  accessibilityLabel={`Color ${col}`}
                  accessibilityState={{ selected: draft.avatar.color === col }}
                  style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: col, borderWidth: 3, borderColor: draft.avatar.color === col ? c.text : c.surface }}
                />
              ))}
            </Row>
          </>
        )}

        <Input label="Display name" value={draft.displayName} onChangeText={(v) => set("displayName", v)} />
        <Input label="Bio" value={draft.bio} onChangeText={(v) => set("bio", v)} multiline maxLength={160} placeholder="What are you up to these days?" hint={`${draft.bio.length}/160`} />
        <Input label="City" value={draft.city} onChangeText={(v) => set("city", v)} placeholder="Austin, TX" />
        <View style={{ gap: 6 }}>
          <Txt small bold>Time zone</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {timezones.map((tz) => (
              <Chip key={tz} label={tz.split("/").pop()!.replace(/_/g, " ")} active={draft.timezone === tz} onPress={() => set("timezone", tz)} />
            ))}
          </ScrollView>
        </View>
        <Input label="Email" value={draft.email} onChangeText={(v) => set("email", v)} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
        <Input label="Phone (for iMessage)" value={draft.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" textContentType="telephoneNumber" placeholder="+1 555 555 0100" hint="Friends who link contacts can find you by email or phone. These are never shown on your profile." />

        <Txt small bold>Friends can see</Txt>
        <ToggleList>
          <ToggleRow label="My city" value={draft.profileVisibility.city} onChange={(v) => set("profileVisibility", { ...draft.profileVisibility, city: v })} />
          <ToggleRow label="My bio" value={draft.profileVisibility.bio} onChange={(v) => set("profileVisibility", { ...draft.profileVisibility, bio: v })} />
          <ToggleRow last label="My shareable goals" value={draft.profileVisibility.goals} onChange={(v) => set("profileVisibility", { ...draft.profileVisibility, goals: v })} />
        </ToggleList>

        <ErrorText>{error}</ErrorText>
        <Button title={saved && !dirty ? "✓ Saved" : "Save profile"} onPress={save} disabled={!dirty} />
      </Card>
    </>
  );
}

function AccountSection({ me }: { me: User }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const hasPassword = !!me.passwordHash;
  const via = me.authProvider === "google" ? ` with Google (${me.email})` : me.authProvider === "apple" ? " with Apple" : " with a password";

  const onChangePassword = () => {
    try {
      changePassword(current, next);
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: hasPassword ? "Password updated." : "Password set. You can now log in with your username too." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Couldn't update password." });
    }
  };

  return (
    <Card>
      <H2>Account</H2>
      <Txt small muted>Signed in as @{me.username}{via}.</Txt>

      <Txt small bold>{hasPassword ? "Change password" : "Set a password"}</Txt>
      {hasPassword && <Input placeholder="Current password" secureTextEntry value={current} onChangeText={setCurrent} textContentType="password" />}
      <Input placeholder="New password" secureTextEntry value={next} onChangeText={setNext} textContentType="newPassword" />
      {msg && (msg.ok ? <Txt small muted>{msg.text}</Txt> : <ErrorText>{msg.text}</ErrorText>)}
      <Button small variant="secondary" title="Update password" disabled={!next} onPress={onChangePassword} style={{ alignSelf: "flex-start" }} />

      <Button variant="secondary" title="Log out" onPress={logOut} />
      <Row style={{ justifyContent: "space-between" }} wrap>
        <Button
          small
          variant="ghost"
          title="Reset demo data"
          onPress={() =>
            Alert.alert("Reset demo data?", "Every account on this device is removed.", [
              { text: "Cancel", style: "cancel" },
              { text: "Reset", style: "destructive", onPress: resetDB },
            ])
          }
        />
        <Button
          small
          variant="danger"
          title="Delete account"
          onPress={() =>
            Alert.alert("Delete your account?", "Your goals and connections are deleted. This can't be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: deleteAccount },
            ])
          }
        />
      </Row>
    </Card>
  );
}
