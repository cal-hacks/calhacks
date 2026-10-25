import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  addCheckin,
  addGroupMember,
  chatMembers,
  chatTitle,
  createGroup,
  leaveGroup,
  liveFriends,
  openChat,
  sendMessage,
  toggleReaction,
  useLive,
  votePlan,
  type LiveState,
} from "../../lib/live";
import type { FeedItem, Friend, FriendGroup, Plan } from "../../module_bindings/types";
import { Button, Card, Chip, Chips, ErrorText, Input, Txt } from "../../components/ui";
import { radius, useColors } from "../../components/theme";

const REACTIONS = ["❤️", "🎉", "😂", "👏"];

const KIND_LABEL: Record<string, { label: string; icon: string }> = {
  highlight: { label: "Highlight", icon: "✨" },
  goal_hit: { label: "Goal hit", icon: "🎯" },
  obscure_place: { label: "Weirdest place", icon: "🗺️" },
  roast: { label: "Roast (opted in)", icon: "🔥" },
  plan_proposal: { label: "Plan", icon: "📅" },
};

function timeLabel(item: { createdAt: { toDate(): Date } }) {
  const d = item.createdAt.toDate();
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** A plan_proposal post and its plan are written in one transaction, so their timestamps match. */
function planFor(live: LiveState, item: FeedItem): Plan | undefined {
  const t = item.createdAt.toDate().getTime();
  return live.plans.find((p) => p.createdAt.toDate().getTime() === t);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The Chats tab: the list of chats, or the open one. */
export default function GroupScreen() {
  const live = useLive();
  const c = useColors();
  const insets = useSafeAreaInsets();

  if (live.status !== "ready") {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 16, paddingTop: insets.top + 12, gap: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: "700", color: c.text }}>Chats</Text>
        <Card>
          <Txt muted={live.status !== "error"} style={live.status === "error" ? { color: c.warn } : undefined}>
            {live.status === "error" ? live.error : live.status === "joining" ? "Signing you up…" : "Connecting…"}
          </Txt>
        </Card>
      </View>
    );
  }
  return live.group ? <ChatScreen live={live} group={live.group} /> : <ChatList live={live} />;
}

function lastActivity(live: LiveState, groupId: bigint): FeedItem | undefined {
  const items = live.allFeed.filter((f) => f.groupId === groupId);
  return items[items.length - 1];
}

function ChatList({ live }: { live: LiveState }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [making, setMaking] = useState(false);
  const friends = liveFriends(live);
  // A 1:1 whose friend is gone has no other member: hide it.
  const chats = live.groups
    .filter((g) => !g.isDirect || chatMembers(live, g.id).length > 0)
    .map((g) => ({ g, last: lastActivity(live, g.id) }))
    .sort((a, b) => (b.last?.createdAt.toDate().getTime() ?? 0) - (a.last?.createdAt.toDate().getTime() ?? 0));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 28, fontWeight: "700", color: c.text }} accessibilityRole="header">Chats</Text>
        {friends.length > 0 && <Button small variant="secondary" title={making ? "Cancel" : "New group"} onPress={() => setMaking((v) => !v)} />}
        <Button small variant="secondary" title="📤 Share data" onPress={() => router.push("/share")} />
      </View>
      {making && <NewGroup friends={friends} onDone={() => setMaking(false)} />}
      {chats.length === 0 && (
        <Card style={{ alignItems: "center", paddingVertical: 24 }}>
          <Txt muted center>You can chat with your friends here. Add someone and a chat with them opens once they accept.</Txt>
          <Button small title="Find friends" onPress={() => router.navigate("/friends")} />
        </Card>
      )}
      {chats.map(({ g, last }) => {
        const others = chatMembers(live, g.id);
        const author = last && live.friends.find((f) => f.id === last.friendId);
        const preview = !last ? "No messages yet" : last.createdBy === "agent" ? `🤖 ${last.text}` : `${author?.id === live.me?.id ? "You" : author?.name.split(" ")[0] ?? "Someone"}: ${last.text}`;
        return (
          <Pressable
            key={String(g.id)}
            onPress={() => openChat(g.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open chat ${chatTitle(live, g)}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2 }}>
                  <Text style={{ fontSize: 22 }}>{g.isDirect ? others[0]?.avatar || "🙂" : "👥"}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Txt bold>{chatTitle(live, g)}</Txt>
                    {last && <Txt small muted>{timeLabel(last)}</Txt>}
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 14, color: c.text2 }}>
                    {g.isDirect ? preview : `${others.length + 1} people · ${preview}`}
                  </Text>
                </View>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function NewGroup({ friends, onDone }: { friends: Friend[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<bigint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: bigint) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createGroup(name, picked);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Input label="Group name" value={name} onChangeText={setName} placeholder="Weekend crew" maxLength={60} />
      <Txt small muted>Only your friends can be in your groups.</Txt>
      <Chips>
        {friends.map((f) => (
          <Chip key={String(f.id)} label={`${f.avatar || "🙂"} ${f.name}`} active={picked.includes(f.id)} onPress={() => toggle(f.id)} />
        ))}
      </Chips>
      {error && <ErrorText>{error}</ErrorText>}
      <Button title="Create group" onPress={create} loading={busy} disabled={!name.trim() || picked.length === 0} />
    </Card>
  );
}

function AddMembers({ live, group }: { live: LiveState; group: FriendGroup }) {
  const inChat = new Set(live.members.filter((m) => m.groupId === group.id).map((m) => m.friendId));
  const candidates = liveFriends(live).filter((f) => !inChat.has(f.id));
  if (candidates.length === 0) return <Txt small muted>All your friends are already here.</Txt>;
  return (
    <Chips>
      {candidates.map((f) => (
        <Chip
          key={String(f.id)}
          label={`+ ${f.avatar || "🙂"} ${f.name}`}
          onPress={() => addGroupMember(group.id, f.id).catch((e) => Alert.alert("Couldn't add them", errorText(e)))}
        />
      ))}
    </Chips>
  );
}

function ChatScreen({ live, group }: { live: LiveState; group: FriendGroup }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const [text, setText] = useState("");
  const [asCheckin, setAsCheckin] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [live.feed.length]);

  const friendById = new Map(live.friends.map((f) => [f.id, f]));
  const members = chatMembers(live, group.id);
  const title = chatTitle(live, group);
  const onLeave = () =>
    Alert.alert(`Leave ${title}?`, "You'll stop getting its messages.", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => leaveGroup(group.id).catch((e) => Alert.alert("Couldn't leave", errorText(e))) },
    ]);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      if (asCheckin) await addCheckin(body);
      else await sendMessage(body);
      setText("");
      setAsCheckin(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, gap: 6, borderBottomWidth: 1, borderColor: c.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => openChat(null)} accessibilityRole="button" accessibilityLabel="Back to chats" hitSlop={10}>
            <Text style={{ fontSize: 26, color: c.accent }}>‹</Text>
          </Pressable>
          <Text style={{ flex: 1, fontSize: 24, fontWeight: "700", color: c.text }} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          {!group.isDirect && <Button small variant="secondary" title={adding ? "Done" : "Add"} onPress={() => setAdding((v) => !v)} />}
          {!group.isDirect && <Button small variant="ghost" title="Leave" onPress={onLeave} />}
        </View>
        {!group.isDirect && (
          <View style={{ flexDirection: "row", gap: 4 }}>
            {members.map((f) => (
              <View key={String(f.id)} style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2 }} accessibilityLabel={f.name}>
                <Text style={{ fontSize: 16 }}>{f.avatar || "🙂"}</Text>
              </View>
            ))}
          </View>
        )}
        {adding && <AddMembers live={live} group={group} />}
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ padding: 12, gap: 10 }} keyboardDismissMode="interactive">
        {live.feed.length === 0 && <Txt muted center>No messages yet. Say hi!</Txt>}
        {live.feed.map((item) => (
          <ChatItem key={String(item.id)} item={item} live={live} friendById={friendById} />
        ))}
      </ScrollView>

      <View style={{ padding: 10, paddingBottom: 10, gap: 6, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
        {error && <ErrorText>{error}</ErrorText>}
        {asCheckin && <Txt small muted>Your agent turns check-ins into a post for the group, at most one a day.</Txt>}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check-in"
            accessibilityState={{ selected: asCheckin }}
            onPress={() => setAsCheckin((v) => !v)}
            style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: asCheckin ? c.accent : c.border, backgroundColor: asCheckin ? c.accentSoft : c.surface }}
          >
            <Text style={{ fontSize: 16 }}>🎉</Text>
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={asCheckin ? "What happened? e.g. ran my first 10K" : `Message ${group.isDirect ? title.split(" ")[0] : "the group"}`}
            placeholderTextColor={c.text3}
            maxLength={500}
            onSubmitEditing={submit}
            returnKeyType="send"
            accessibilityLabel={asCheckin ? "Check-in" : "Message"}
            style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, color: c.text, backgroundColor: c.bg, fontSize: 15 }}
          />
          <Button small title={asCheckin ? "Check in" : "Send"} onPress={submit} disabled={sending || !text.trim()} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function ChatItem({ item, live, friendById }: { item: FeedItem; live: LiveState; friendById: Map<bigint, Friend> }) {
  const c = useColors();
  const author = friendById.get(item.friendId);
  const reactions = live.reactions.filter((r) => r.feedItemId === item.id);

  if (item.createdBy === "agent") {
    const kind = KIND_LABEL[item.kind] ?? { label: "Agent", icon: "🤖" };
    const plan = item.kind === "plan_proposal" ? planFor(live, item) : undefined;
    return (
      <View style={{ backgroundColor: c.accentSoft, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text>{kind.icon}</Text>
          <Txt bold>{item.kind === "plan_proposal" ? "Coordinator" : `${author?.name.split(" ")[0] ?? "Friend"}'s agent`}</Txt>
          <Txt small muted>· {kind.label} · {timeLabel(item)}</Txt>
        </View>
        <Txt>{item.text}</Txt>
        {plan && <PlanCard plan={plan} live={live} />}
        <Reactions item={item} reactions={reactions} meId={live.me?.id} />
      </View>
    );
  }

  const mine = item.friendId === live.me?.id;
  const parent = item.replyToId ? live.feed.find((f) => f.id === item.replyToId) : undefined;
  return (
    <View style={{ flexDirection: "row", gap: 8, alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", alignItems: "flex-end" }}>
      {!mine && <Text style={{ fontSize: 20 }}>{author?.avatar || "🙂"}</Text>}
      <View style={{ backgroundColor: mine ? c.accent : c.surface2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2, flexShrink: 1 }}>
        {!mine && <Text style={{ fontSize: 12, color: c.text2 }}>{author?.name ?? "Someone"}</Text>}
        {parent && <Text style={{ fontSize: 12, color: mine ? c.accentInk : c.text2, opacity: 0.8 }}>↪ {parent.text.slice(0, 60)}</Text>}
        <Text style={{ fontSize: 15, color: mine ? c.accentInk : c.text }}>{item.text}</Text>
        <Text style={{ fontSize: 11, color: mine ? c.accentInk : c.text3, opacity: 0.8 }}>{timeLabel(item)}</Text>
        <Reactions item={item} reactions={reactions} meId={live.me?.id} />
      </View>
    </View>
  );
}

function Reactions({ item, reactions, meId }: { item: FeedItem; reactions: LiveState["reactions"]; meId?: bigint }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
      {REACTIONS.map((emoji) => {
        const these = reactions.filter((r) => r.emoji === emoji);
        const on = these.some((r) => r.friendId === meId);
        return (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={`React ${emoji}`}
            accessibilityState={{ selected: on }}
            onPress={() => toggleReaction(item.id, emoji).catch(() => {})}
            style={{ flexDirection: "row", gap: 3, alignItems: "center", paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.surface, opacity: these.length || on ? 1 : 0.55 }}
          >
            <Text style={{ fontSize: 13 }}>{emoji}</Text>
            {these.length > 0 && <Text style={{ fontSize: 12, color: c.text }}>{these.length}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

function PlanCard({ plan, live }: { plan: Plan; live: LiveState }) {
  const c = useColors();
  const options = live.options.filter((o) => o.planId === plan.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const votes = live.votes.filter((v) => v.planId === plan.id);
  const myVote = votes.find((v) => v.friendId === live.me?.id)?.optionId;

  return (
    <View style={{ gap: 6 }}>
      {plan.status === "confirmed" && <Txt bold style={{ color: c.good }}>✅ Confirmed</Txt>}
      {plan.status === "cancelled" && <Txt bold style={{ color: c.warn }}>Cancelled</Txt>}
      {options.map((o) => {
        const picked = plan.confirmedOptionId === o.id;
        const voters = votes.filter((v) => v.optionId === o.id).map((v) => live.friends.find((f) => f.id === v.friendId)?.avatar || "🙂");
        return (
          <Pressable
            key={String(o.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: myVote === o.id, disabled: plan.status !== "open" }}
            disabled={plan.status !== "open"}
            onPress={() => votePlan(plan.id, o.id).catch(() => {})}
            style={{ padding: 10, borderRadius: radius.md, borderWidth: myVote === o.id ? 2 : 1, borderColor: picked ? c.good : myVote === o.id ? c.accent : c.border, backgroundColor: picked ? c.goodSoft : c.surface, gap: 2 }}
          >
            <Txt bold>{o.label}</Txt>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Txt small muted>{o.detail}</Txt>
              <Text>{voters.join(" ")}</Text>
            </View>
          </Pressable>
        );
      })}
      {plan.status === "open" && <Txt small muted>Tap a time. It's confirmed when most of the group picks the same one.</Txt>}
    </View>
  );
}
