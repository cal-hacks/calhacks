import { useState } from "react";
import { Linking, View } from "react-native";
import { Text } from "./Text";
import { useDB } from "../lib/db";
import { currentUser, permissionsOf, setCalendar, setPermissions } from "../lib/api";
import { CALENDAR_PROVIDERS } from "../lib/meta";
import { requestCalendarAccess, requestLocation, requestPhotos } from "../lib/integrations";
import {
  SELECTION_ID,
  deviceActivity,
  hasTrackedApps,
  requestScreenTime,
  screenTimeMinutesToday,
  screenTimeNative,
  screenTimeStatus,
  startScreenTimeTracking,
  syncScreenTimeGoals,
  type ScreenTimeStatus,
} from "../lib/screenTime";
import type { ScreenTimeMethod } from "../lib/types";
import { Button, Card, Pill, Row, Segmented, Txt } from "./ui";
import { useColors } from "./theme";

type Section = "calendar" | "location" | "photos" | "screenTime";

/** Calendar, location, photo and screen time access, or just the `only` ones. Used in onboarding and Settings. */
export function PermissionCards({ only }: { only?: Section[] } = {}) {
  const show = (s: Section) => !only || only.includes(s);
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
      {show("calendar") && <PermCard icon="🗓️" title="Calendars" on={calendarOn} status={calendarOn ? "Connected" : "Not connected"} body="Your agent reads free/busy only, so it can suggest times. Event titles stay private.">
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
      </PermCard>}

      {show("location") && <PermCard icon="📍" title="Location" on={perms.location === "granted"} status={perms.location === "granted" ? "Allowed" : perms.location === "denied" ? "Blocked" : "Off"} body="Tracks time at places you name in a goal, like “the library”. Friends only see places you choose to share, at city level.">
        <Row wrap>
          {perms.location === "granted" ? (
            <Button small variant="ghost" title="Turn off" onPress={() => setPermissions({ location: "off" })} />
          ) : (
            <Button small title="Allow location" loading={busy === "location"} onPress={onLocation} />
          )}
          {perms.location === "denied" && <Button small variant="secondary" title="Open Settings" onPress={() => Linking.openSettings()} />}
        </Row>
      </PermCard>}

      {show("photos") && <PermCard icon="📸" title="Photos" on={perms.photos === "granted"} status={perms.photos === "granted" ? "Allowed" : perms.photos === "denied" ? "Blocked" : "Off"} body="Your agent never scans your library. It only sees photos you pick, and reads where and when they were taken.">
        <Row wrap>
          {perms.photos === "granted" ? (
            <Button small variant="ghost" title="Turn off" onPress={() => setPermissions({ photos: "off" })} />
          ) : (
            <Button small title="Allow photos" loading={busy === "photos"} onPress={onPhotos} />
          )}
          {perms.photos === "denied" && <Button small variant="secondary" title="Open Settings" onPress={() => Linking.openSettings()} />}
        </Row>
      </PermCard>}

      {show("screenTime") && <ScreenTimeCard />}
    </View>
  );
}

function ScreenTimeCard() {
  const db = useDB();
  const me = currentUser(db)!;
  const perms = permissionsOf(db, me.id);
  const [status, setStatus] = useState<ScreenTimeStatus>(() => screenTimeStatus());
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const minutes = perms.screenTime === "apple" ? screenTimeMinutesToday() : null;
  const Picker = picking ? deviceActivity()?.DeviceActivitySelectionSheetViewPersisted : undefined;

  const onAllow = async () => {
    setBusy(true);
    try {
      const s = await requestScreenTime();
      setStatus(s);
      if (s === "approved") setPicking(true);
    } finally {
      setBusy(false);
    }
  };

  const onPicked = async () => {
    setPicking(false);
    if (await startScreenTimeTracking()) {
      setPermissions({ screenTime: "apple" });
      syncScreenTimeGoals();
    }
  };

  const on = perms.screenTime !== "off";
  const statusText = { apple: "Apple Screen Time", shortcut: "Shortcut", screenshot: "Screenshots", off: "Off" }[perms.screenTime];

  return (
    <PermCard icon="📱" title="Screen Time" on={on} status={statusText} body="Counts time in the apps you choose, for goals like “screen time under 3h”. Friends never see app names or totals unless you share Screen Time with them.">
      {screenTimeNative ? (
        <View style={{ gap: 8 }}>
          {perms.screenTime === "apple" && hasTrackedApps() ? (
            <>
              <Txt small>Today so far: {minutes === null ? "–" : minutes < 15 ? "under 15m" : `at least ${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60 ? `${minutes % 60}m` : ""}`}</Txt>
              <Row wrap>
                <Button small variant="secondary" title="Change apps" onPress={() => setPicking(true)} />
                <Button small variant="ghost" title="Stop tracking" onPress={() => { deviceActivity()?.stopMonitoring(); setPermissions({ screenTime: "off" }); }} />
              </Row>
            </>
          ) : status === "approved" ? (
            <Button small title="Choose apps to count" onPress={() => setPicking(true)} style={{ alignSelf: "flex-start" }} />
          ) : (
            <Row wrap>
              <Button small title="Allow Screen Time" loading={busy} onPress={onAllow} />
              {status === "denied" && <Button small variant="secondary" title="Open Settings" onPress={() => Linking.openSettings()} />}
            </Row>
          )}
          <Txt small muted>Uses Apple's Screen Time API. Apple shares time in steps (15 min at first), never what you did in an app.</Txt>
          {Picker && (
            <Picker
              familyActivitySelectionId={SELECTION_ID}
              style={{ width: 1, height: 1, position: "absolute" }}
              onDismissRequest={onPicked}
            />
          )}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Segmented<ScreenTimeMethod>
            value={perms.screenTime === "screenshot" ? "screenshot" : "off"}
            options={[
              { key: "screenshot", label: "Screenshots" },
              { key: "off", label: "Off" },
            ]}
            onChange={(v) => setPermissions({ screenTime: v })}
          />
          <Txt small muted>Automatic tracking uses Apple Screen Time, which this build doesn't include. Run npm run ios:sim for the Simulator, or build with an Apple Developer team for a real iPhone.</Txt>
        </View>
      )}
    </PermCard>
  );
}

function PermCard({ icon, title, body, on, status, children }: { icon: string; title: string; body: string; on: boolean; status: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Card>
      <Row gap={12}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 20 }}>{icon}</Text>
        </View>
        <Txt bold style={{ fontSize: 16, flex: 1 }}>{title}</Txt>
        <Pill on={on} text={status} />
      </Row>
      {/* Full-width body: nesting it beside the icon made iOS mis-measure wrapped lines. */}
      <Txt small muted>{body}</Txt>
      {children}
    </Card>
  );
}
