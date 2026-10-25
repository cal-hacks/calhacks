import { useState } from "react";
import { Alert, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useDB } from "../../lib/db";
import { directChatWith, liveFriendId, openChat, useLive } from "../../lib/live";
import { currentUser, friendsOf, removeConnection, setSharing, setSharingForAll, sharingWith } from "../../lib/api";
import { FREQUENCIES, SHARE_CATEGORIES } from "../../lib/meta";
import { Avatar, Button, Chip, Chips, H2, Row, Screen, ToggleList, ToggleRow, Txt } from "../../components/ui";

/** Per-friend sharing: how often updates go out and what's included. */
export default function FriendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDB();
  useLive(); // re-render when the 1:1 chat appears
  const me = currentUser(db);
  const [applied, setApplied] = useState(false);
  const friend = me ? friendsOf(db, me.id).find((f) => f.id === id) : undefined;
  if (!me || !friend) return null;

  const first = friend.displayName.split(" ")[0];
  const liveId = liveFriendId(friend.id);
  const chat = liveId === undefined ? undefined : directChatWith(liveId);
  const onMessage = () => {
    if (!chat) return;
    openChat(chat.id);
    router.navigate("/group");
  };
  const prefs = sharingWith(db, me.id, friend.id);
  const paused = prefs.frequency === "paused";
  const freq = FREQUENCIES.find((f) => f.key === prefs.frequency)!;
  const shareableGoals = db.goals.filter((g) => g.userId === me.id && g.shareWithFriends && !g.archived);

  const onRemove = () =>
    Alert.alert(`Remove ${friend.displayName}?`, "Your agent will stop sharing with them.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          router.back();
          removeConnection(friend.id).catch((e) => Alert.alert("Couldn't remove them", e instanceof Error ? e.message : String(e)));
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: friend.displayName }} />
      <Screen header>
        <Row gap={14}>
          <Avatar user={friend} size={64} />
          <View style={{ flex: 1 }}>
            <H2>{friend.displayName}</H2>
            <Txt small muted>
              @{friend.username}
              {friend.city && friend.profileVisibility.city ? ` · ${friend.city}` : ""}
            </Txt>
            {friend.bio && friend.profileVisibility.bio ? <Txt small>{friend.bio}</Txt> : null}
          </View>
        </Row>
        <Button title={`💬 Message ${first}`} onPress={onMessage} disabled={!chat} />

        <View style={{ gap: 8 }}>
          <Txt bold>How often should your agent send {first} updates?</Txt>
          <Chips>
            {FREQUENCIES.map((f) => (
              <Chip key={f.key} label={f.label} active={prefs.frequency === f.key} onPress={() => setSharing(friend.id, { frequency: f.key })} />
            ))}
          </Chips>
          <Txt small muted>{freq.hint}</Txt>
        </View>

        <View style={{ gap: 8 }}>
          <Txt bold>What you're okay sharing with {first}</Txt>
          <ToggleList>
            {SHARE_CATEGORIES.map((x, i) => (
              <ToggleRow
                key={x.key}
                icon={x.icon}
                label={x.label}
                hint={x.hint}
                value={prefs.categories[x.key]}
                disabled={paused}
                last={i === SHARE_CATEGORIES.length - 1}
                onChange={(v) => setSharing(friend.id, { categories: { ...prefs.categories, [x.key]: v } })}
              />
            ))}
          </ToggleList>
        </View>

        {prefs.categories.goals && shareableGoals.length > 0 && (
          <View style={{ gap: 8 }}>
            <Txt bold>Which goals</Txt>
            <ToggleList>
              {shareableGoals.map((g, i) => (
                <ToggleRow
                  key={g.id}
                  label={g.title}
                  value={prefs.goals[g.id] ?? true}
                  disabled={paused}
                  last={i === shareableGoals.length - 1}
                  onChange={(v) => setSharing(friend.id, { goals: { ...prefs.goals, [g.id]: v } })}
                />
              ))}
            </ToggleList>
          </View>
        )}

        <Button
          variant="secondary"
          title={applied ? "✓ Applied to all friends" : "Apply these settings to all friends"}
          onPress={() => {
            setSharingForAll({ frequency: prefs.frequency, categories: prefs.categories });
            setApplied(true);
            setTimeout(() => setApplied(false), 2000);
          }}
        />
        <Button variant="danger" title="Remove connection" onPress={onRemove} />
      </Screen>
    </>
  );
}
