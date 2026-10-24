import { useState } from "react";
import { Alert, Pressable, Share, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useDB } from "../../lib/db";
import {
  acceptFriendRequest,
  currentUser,
  friendsOf,
  matchContacts,
  relationship,
  removeConnection,
  searchUsers,
  sendFriendRequest,
  setPermissions,
  sharingWith,
  type ContactEntry,
} from "../../lib/api";
import { parseContactsText, readContacts } from "../../lib/integrations";
import { APP_NAME, FREQUENCIES, SHARE_CATEGORIES } from "../../lib/meta";
import type { DB, User } from "../../lib/types";
import { Avatar, Button, Card, Eyebrow, H2, Input, Pill, Row, Screen, Txt } from "../../components/ui";
import { Steps } from "../../components/Steps";
import { useColors } from "../../components/theme";

export default function FriendsScreen() {
  const db = useDB();
  const c = useColors();
  const me = currentUser(db);
  const { welcome } = useLocalSearchParams<{ welcome?: string }>();
  if (!me) return null;

  const friends = friendsOf(db, me.id);
  const incoming = db.connections.filter((x) => x.toId === me.id && x.status === "pending");
  const outgoing = db.connections.filter((x) => x.fromId === me.id && x.status === "pending");
  const userById = (id: string) => db.users.find((u) => u.id === id);

  return (
    <Screen title="Friends" subtitle={`Connect with friends on ${APP_NAME} and choose how often, and what, your agent shares with each.`}>
      {welcome === "1" && (
        <Card style={{ backgroundColor: c.accentSoft, borderColor: c.accentSoft }}>
          <Steps current={2} />
          <Txt>Last step: add the friends you want to stay close to. You decide what each one sees.</Txt>
          <Button small title="Go to my dashboard →" onPress={() => router.replace("/")} style={{ alignSelf: "flex-start" }} />
        </Card>
      )}

      {(incoming.length > 0 || outgoing.length > 0) && (
        <Card>
          <H2>Requests</H2>
          {incoming.map((x) => {
            const u = userById(x.fromId);
            return u ? (
              <PersonRow key={x.id} user={u} extra="wants to connect">
                <Button small variant="ghost" title="Decline" onPress={() => removeConnection(u.id)} />
                <Button small title="Accept" onPress={() => acceptFriendRequest(x.id)} />
              </PersonRow>
            ) : null;
          })}
          {outgoing.map((x) => {
            const u = userById(x.toId);
            return u ? (
              <PersonRow key={x.id} user={u} extra="request sent">
                <Button small variant="ghost" title="Cancel" onPress={() => removeConnection(u.id)} />
              </PersonRow>
            ) : null;
          })}
        </Card>
      )}

      <FindFriends db={db} me={me} />

      <H2>
        Your connections <Txt muted>({friends.length})</Txt>
      </H2>
      {friends.length === 0 ? (
        <Card style={{ alignItems: "center", paddingVertical: 24 }}>
          <Txt muted center>No connections yet. Search for a username above or link your contacts to find friends already on {APP_NAME}.</Txt>
        </Card>
      ) : (
        friends.map((f) => <FriendSummary key={f.id} db={db} me={me} friend={f} />)
      )}
    </Screen>
  );
}

function PersonRow({ user, extra, children }: { user: User; extra?: string; children?: React.ReactNode }) {
  return (
    <Row gap={12}>
      <Avatar user={user} />
      <View style={{ flex: 1 }}>
        <Txt bold>{user.displayName}</Txt>
        <Txt small muted>
          @{user.username}
          {user.city && user.profileVisibility.city ? ` · ${user.city}` : ""}
          {extra ? ` · ${extra}` : ""}
        </Txt>
      </View>
      {children}
    </Row>
  );
}

function RelationButton({ db, me, user }: { db: DB; me: User; user: User }) {
  const rel = relationship(db, me.id, user.id);
  if (rel === "friends") return <Pill on text="Connected" />;
  if (rel === "outgoing") return <Pill on={false} text="Requested" />;
  return <Button small variant="secondary" title={rel === "incoming" ? "Accept" : "Add"} onPress={() => sendFriendRequest(user.id)} />;
}

function FindFriends({ db, me }: { db: DB; me: User }) {
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [contacts, setContacts] = useState<ContactEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Recomputed on every db change so request status stays live.
  const results = query.trim().length >= 2 ? searchUsers(query) : [];
  const matches = contacts ? matchContacts(contacts) : [];
  const onApp = [...new Map(matches.filter((m) => m.user).map((m) => [m.user!.id, m.user!])).values()];
  const notOnApp = matches.filter((m) => !m.user).slice(0, 15);

  const onLink = async () => {
    setBusy(true);
    try {
      const { granted, contacts: list } = await readContacts();
      setPermissions({ contacts: granted ? "granted" : "denied" });
      if (!granted) {
        Alert.alert("Contacts access is off", "You can allow it in Settings, or paste emails and numbers instead.");
        return;
      }
      setContacts(list);
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    Share.share({ message: `Join me on ${APP_NAME} so we actually keep up! My username is @${me.username}.` }).catch(() => {});

  return (
    <Card>
      <H2>Find friends</H2>
      <Input value={query} onChangeText={setQuery} placeholder="Search by name, @username or email" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search people" />
      {query.trim().length >= 2 && (
        <View style={{ gap: 10 }}>
          {results.length === 0 && <Txt small muted>No one matches “{query}”.</Txt>}
          {results.map((u) => (
            <PersonRow key={u.id} user={u}>
              <RelationButton db={db} me={me} user={u} />
            </PersonRow>
          ))}
        </View>
      )}

      <View style={{ gap: 4 }}>
        <Txt bold>Link your contacts</Txt>
        <Txt small muted>We match emails and phone numbers to people on {APP_NAME}. Contacts aren't stored or messaged.</Txt>
      </View>
      <Row wrap>
        <Button small title="Link contacts" loading={busy} onPress={onLink} />
        <Button small variant="ghost" title={pasteOpen ? "Hide" : "Paste emails or numbers"} onPress={() => setPasteOpen((v) => !v)} />
      </Row>
      {pasteOpen && (
        <View style={{ gap: 8 }}>
          <Input multiline value={pasted} onChangeText={setPasted} placeholder={"maya@example.com\n(206) 555-0103"} autoCapitalize="none" accessibilityLabel="Emails or phone numbers" />
          <Button small variant="secondary" title="Find matches" onPress={() => setContacts(parseContactsText(pasted))} style={{ alignSelf: "flex-start" }} />
        </View>
      )}

      {contacts && (
        <View style={{ gap: 10 }}>
          <Eyebrow>On {APP_NAME} ({onApp.length})</Eyebrow>
          {onApp.length === 0 && <Txt small muted>None of these contacts are here yet. Invite them below.</Txt>}
          {onApp.map((u) => (
            <PersonRow key={u.id} user={u}>
              <RelationButton db={db} me={me} user={u} />
            </PersonRow>
          ))}
          {notOnApp.length > 0 && <Eyebrow>Invite</Eyebrow>}
          {notOnApp.map(({ contact }, i) => (
            <Row key={i} gap={12}>
              <View style={{ flex: 1 }}>
                <Txt bold>{contact.name ?? contact.email ?? contact.phone}</Txt>
                <Txt small muted>{contact.email ?? contact.phone}</Txt>
              </View>
              <Button small variant="ghost" title="Invite" onPress={invite} />
            </Row>
          ))}
        </View>
      )}
    </Card>
  );
}

function FriendSummary({ db, me, friend }: { db: DB; me: User; friend: User }) {
  const c = useColors();
  const prefs = sharingWith(db, me.id, friend.id);
  const freq = FREQUENCIES.find((f) => f.key === prefs.frequency)!;
  const enabled = SHARE_CATEGORIES.filter((x) => prefs.categories[x.key]);
  const summary = prefs.frequency === "paused" ? "Paused: nothing is shared" : `${freq.label} · ${enabled.length ? enabled.map((x) => x.label).join(", ") : "nothing selected"}`;

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/friend/[id]", params: { id: friend.id } })}
      accessibilityRole="button"
      accessibilityHint="Manage what you share with this friend"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card>
        <Row gap={12}>
          <Avatar user={friend} size={44} />
          <View style={{ flex: 1 }}>
            <Txt bold>{friend.displayName}</Txt>
            <Txt small muted>{summary}</Txt>
          </View>
          <Txt style={{ color: c.text3, fontSize: 20 }}>›</Txt>
        </Row>
      </Card>
    </Pressable>
  );
}
