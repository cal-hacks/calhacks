import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { useDB } from "../lib/db";
import { currentUser, permissionsOf, setCalendar, setPermissions } from "../lib/api";
import { CALENDAR_PROVIDERS } from "../lib/meta";
import { requestCalendarAccess, requestLocation, requestPhotos } from "../lib/integrations";
import type { ScreenTimeMethod } from "../lib/types";
import { Button, Card, Pill, Row, Segmented, Txt } from "./ui";
import { useColors } from "./theme";

/** Calendar, location, photo and screen time access. Used in onboarding and Settings. */
export function PermissionCards() {
  const db = useDB();
  const me = currentUser(db)!;
  const perms = permissionsOf(db, me.id);
  const [busy, setBusy] = useState<string | null>(null);

  const calendarAccounts = perms.calendarAccounts ?? [];
  const calendarOn = CALENDAR_PROVIDERS.some((p) => perms.calendars[p.key].connected) || calendarAccounts.length > 0;

  const onCalendar = async () => {
    setBusy("calendar");
    try {
      const { granted, accounts } = await requestCalendarAccess();
      setPermissions({ calendarAccounts: granted ? accounts : [] });
      for (const p of CALENDAR_PROVIDERS) {
        const found = accounts.filter((a) => a.provider === p.key).map((a) => a.account);
        setCalendar(p.key, found.length > 0, found.join(", ") || undefined);
      }
    } finally {
      setBusy(null);
    }
  };

  const onCalendarOff = () => {
    setPermissions({ calendarAccounts: [] });
    for (const p of CALENDAR_PROVIDERS) setCalendar(p.key, false);
  };

  const onLocation = async () => {
    setBusy("location");
    setPermissions({ location: await requestLocation() });
    setBusy(null);
  };

  const onPhotos = async () => {
    setBusy("photos");
    setPermissions({ photos: await requestPhotos() });
    setBusy(null);
  };

  return (
    <View style={{ gap: 12 }}>
      <PermCard icon="🗓️" title="Calendars" on={calendarOn} status={calendarOn ? "Connected" : "Not connected"} body="Your agent reads free/busy only, so it can suggest times. Event titles stay private.">
        {calendarAccounts.length > 0 && (
          <View style={{ gap: 6 }}>
            {calendarAccounts.map((a) => (
              <Row key={a.account}>
                <Text>{CALENDAR_PROVIDERS.find((p) => p.key === a.provider)?.icon ?? "📅"}</Text>
                <Txt style={{ flex: 1 }}>{a.account}</Txt>
                <Txt small muted>{a.calendars} calendar{a.calendars > 1 ? "s" : ""}</Txt>
              </Row>
            ))}
          </View>
        )}
        <Row wrap>
          <Button small variant={calendarOn ? "secondary" : "primary"} title={calendarOn ? "Refresh accounts" : "Allow calendar access"} loading={busy === "calendar"} onPress={onCalendar} />
          {calendarOn && <Button small variant="ghost" title="Stop using" onPress={onCalendarOff} />}
        </Row>
        <Txt small muted>
          Covers iCloud, Google and Outlook. Missing one? Add it in iOS Settings → Apps → Calendar → Calendar Accounts, then tap Refresh.
        </Txt>
      </PermCard>

      <PermCard icon="📍" title="Location" on={perms.location === "granted"} status={perms.location === "granted" ? "Allowed" : perms.location === "denied" ? "Blocked" : "Off"} body="Tracks time at places you name in a goal, like “the library”. Friends only see places you choose to share, at city level.">
        <Row wrap>
          {perms.location === "granted" ? (
            <Button small variant="ghost" title="Turn off" onPress={() => setPermissions({ location: "off" })} />
          ) : (
            <Button small title="Allow location" loading={busy === "location"} onPress={onLocation} />
          )}
          {perms.location === "denied" && <Button small variant="secondary" title="Open Settings" onPress={() => Linking.openSettings()} />}
        </Row>
      </PermCard>

      <PermCard icon="📸" title="Photos" on={perms.photos === "granted"} status={perms.photos === "granted" ? "Allowed" : perms.photos === "denied" ? "Blocked" : "Off"} body="Your agent never scans your library. It only sees photos you pick, and reads where and when they were taken.">
        <Row wrap>
          {perms.photos === "granted" ? (
            <Button small variant="ghost" title="Turn off" onPress={() => setPermissions({ photos: "off" })} />
          ) : (
            <Button small title="Allow photos" loading={busy === "photos"} onPress={onPhotos} />
          )}
          {perms.photos === "denied" && <Button small variant="secondary" title="Open Settings" onPress={() => Linking.openSettings()} />}
        </Row>
      </PermCard>

      <PermCard icon="📱" title="Screen Time" on={perms.screenTime !== "off"} status={perms.screenTime === "off" ? "Off" : perms.screenTime === "shortcut" ? "Shortcut" : "Screenshots"} body="Apple keeps Screen Time private to apps. Use our iOS Shortcut, or share a screenshot and your agent reads the numbers.">
        <Segmented<ScreenTimeMethod>
          value={perms.screenTime}
          options={[
            { key: "shortcut", label: "Shortcut" },
            { key: "screenshot", label: "Screenshots" },
            { key: "off", label: "Off" },
          ]}
          onChange={(v) => setPermissions({ screenTime: v })}
        />
      </PermCard>
    </View>
  );
}

function PermCard({ icon, title, body, on, status, children }: { icon: string; title: string; body: string; on: boolean; status: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Card>
      <Row gap={12} style={{ alignItems: "flex-start" }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 20 }}>{icon}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt bold style={{ fontSize: 16 }}>{title}</Txt>
            <Pill on={on} text={status} />
          </Row>
          <Txt small muted>{body}</Txt>
        </View>
      </Row>
      {children}
    </Card>
  );
}
