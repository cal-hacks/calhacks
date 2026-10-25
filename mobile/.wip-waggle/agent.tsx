import { useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { Text } from "../components/Text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useDB } from "../lib/db";
import { currentUser } from "../lib/api";
import { agentConfigured, chatFor, clearChat, sendToAgent } from "../lib/agent";
import type { ChatItem } from "../lib/types";
import { Chip, Chips, Txt } from "../components/ui";
import { useColors } from "../components/theme";

const SUGGESTIONS = [
  "I studied 2 hours at the library today",
  "Set a goal to run 3 times a week",
  "I want to read 12 books this year",
  "How am I doing this week?",
];

export default function AgentScreen() {
  const db = useDB();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const me = currentUser(db);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  if (!me) return null;

  const items = chatFor(me.id).items;

  const send = async (raw: string) => {
    const msg = raw.trim();
    if (!msg || sending) return;
    setText("");
    setSending(true);
    try {
      await sendToAgent(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Txt muted small>Tell your bee what you did or what you want to work on. It sets goals and logs progress for you.</Txt>
        </View>
        {items.length > 0 && (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            onPress={() =>
              Alert.alert("Clear this conversation?", "Your goals and logs stay as they are.", [
                { text: "Cancel", style: "cancel" },
                { text: "Clear", style: "destructive", onPress: () => clearChat(me.id) },
              ])
            }
          >
            <Txt small style={{ color: c.link, textDecorationLine: "underline" }}>Clear</Txt>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {items.length === 0 && (
          <View style={{ gap: 12, paddingTop: 8 }}>
            {!agentConfigured && (
              <Txt small style={{ color: c.warn }}>The agent service isn't configured in this build. Set EXPO_PUBLIC_AGENT_API_URL.</Txt>
            )}
            <Txt muted>Try one of these:</Txt>
            <Chips>
              {SUGGESTIONS.map((s) => (
                <Chip key={s} label={s} onPress={() => send(s)} />
              ))}
            </Chips>
          </View>
        )}
        {items.map((m) => <Bubble key={m.id} item={m} />)}
        {sending && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 4 }}>
            <ActivityIndicator size="small" color={c.text3} />
            <Txt small muted>Thinking…</Txt>
          </View>
        )}
      </ScrollView>

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 2, borderTopColor: c.border, backgroundColor: c.bg }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message your bee"
          placeholderTextColor={c.text3}
          multiline
          accessibilityLabel="Message your bee"
          style={{ flex: 1, maxHeight: 120, minHeight: 40, borderWidth: 1, borderColor: c.border, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 16, color: c.text, backgroundColor: c.bg }}
        />
        <Pressable
          onPress={() => send(text)}
          disabled={!text.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: c.accent, opacity: !text.trim() || sending ? 0.4 : 1 }}
        >
          <Text style={{ color: c.accentInk, fontSize: 18, fontWeight: "700" }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ item }: { item: ChatItem }) {
  const c = useColors();
  if (item.role === "action" || item.role === "error") {
    return (
      <View style={{ alignSelf: "center", paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: item.role === "action" ? c.goodSoft : c.dangerSoft }}>
        <Text style={{ color: item.role === "action" ? c.good : c.danger, fontSize: 13, fontWeight: "600" }}>{item.text}</Text>
      </View>
    );
  }
  const mine = item.role === "user";
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6, backgroundColor: mine ? c.accentSoft : c.surface, borderWidth: 2, borderColor: c.border }}>
      <Text style={{ color: mine ? c.accentInk : c.text, fontSize: 16, lineHeight: 22 }}>{item.text}</Text>
    </View>
  );
}
