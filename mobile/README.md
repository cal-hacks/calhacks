# Orbit (iOS / Android app)

React Native + Expo SDK 54 + Expo Router. Same screens as `web/`, built natively.

## Run in the iOS Simulator

```bash
cd mobile
npm install
npx expo run:ios            # builds the native app, installs it, starts Metro
```

If `expo run:ios` says "No code signing certificates", boot a simulator first
(`open -a Simulator`) and pass its ID: `npx expo run:ios --device <udid>`
(`xcrun simctl list devices available`). After the first build, `npm start`
is enough for JS changes.

Demo account: `demo` / `demo1234`.

## Screens (`src/app/`)

| File | Screen |
|---|---|
| `auth.tsx` | Sign up / log in: username + password, Sign in with Apple, Google |
| `welcome.tsx` | Permissions, shown once after sign-up: calendars, location, photos, Screen Time |
| `(tabs)/index.tsx` | Dashboard: study hours, goals met per cadence, streaks, history |
| `(tabs)/goals.tsx`, `goal/[id].tsx` | Goals list, create/edit modal, manual logging |
| `(tabs)/agent.tsx` | Chat with the agent to set goals and log progress (needs `agent/` running) |
| `(tabs)/friends.tsx`, `friend/[id].tsx` | Requests, search, link contacts; per-friend frequency + what to share |
| `(tabs)/settings.tsx` | Profile friends see, connected data, password, log out, delete account |

Route guards live in `src/app/_layout.tsx` (`Stack.Protected`).
Data lives on-device in `src/lib/db.ts` (AsyncStorage) and only changes through
`src/lib/api.ts`, named after the plan's SpacetimeDB reducers.

## Shipping to the App Store

1. Join the Apple Developer Program ($99/yr) and pick a unique bundle ID in
   `app.json` (`ios.bundleIdentifier`, currently `com.orbitfriends.app`).
2. `npx eas-cli@latest login`, then `npx eas-cli@latest build -p ios --profile production`
   (EAS builds in the cloud with a current Xcode, as App Store Connect requires).
3. `npx eas-cli@latest submit -p ios` uploads to App Store Connect / TestFlight.
4. In App Store Connect: privacy policy URL, App Privacy answers (contacts,
   location, photos, calendar), screenshots, and a demo login for App Review.

Already handled for review: a purpose string for every permission, Sign in with
Apple alongside Google (Guideline 4.8), in-app account deletion (5.1.1(v)),
and `ITSAppUsesNonExemptEncryption: false`.

## Agent chat

Start the agent service (`agent/README.md`). The Simulator uses
`http://localhost:8000` by default; on a phone set `EXPO_PUBLIC_AGENT_API_URL`.

## Apple Screen Time

Uses Apple's Screen Time API (FamilyControls + DeviceActivity) through
`react-native-device-activity`. Apple never gives apps raw usage numbers, so the
app schedules "reached N minutes" events over the apps the user picks, and a
background extension records which ones fired. The highest one today becomes
the reading for Screen Time goals (15-minute steps up to 4h, coarser after).

**Simulator, no Apple Developer account:** `npm run ios:sim`. The Simulator
accepts locally signed apps, so the build embeds the Family Controls
entitlement with a placeholder team ID (`mobile/.env`). Apple's real Screen
Time permission prompt and app picker work there. The Simulator records little
real app usage, so expect few threshold events.

Physical iPhone and App Store requirements, all from Apple:
- **A paid Apple Developer team.** Build with `APPLE_TEAM_ID=<team id>`, then
  `npx expo prebuild --clean` and `npx expo run:ios --device` on a real iPhone.
  This adds three extensions (`ActivityMonitorExtension`, `ShieldAction`,
  `ShieldConfiguration`) and the `group.com.orbitfriends.app` App Group.
- **A real iPhone on iOS 16+.** Screen Time authorization doesn't work in the Simulator.
- **For the App Store / TestFlight:** request the Family Controls (Distribution)
  entitlement at https://developer.apple.com/contact/request/family-controls-distribution
  for the app and each extension's bundle ID. Approval can take weeks; until
  then only local development builds work.

Without `APPLE_TEAM_ID`, the Screen Time card offers the screenshot option instead.

## Env (`.env`, see `.env.example`)

- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`: real
  Google sign-in. Requires a rebuild (`npx expo prebuild --clean && npx expo run:ios`).
  Without them, Google runs a demo flow.
- `EXPO_PUBLIC_AGENT_API_URL`, `EXPO_PUBLIC_AGENT_KEY`: agent service URL and optional shared secret.
- `APPLE_TEAM_ID` (build-time): turns on Apple Screen Time.
