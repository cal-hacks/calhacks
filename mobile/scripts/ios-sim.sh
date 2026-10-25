#!/usr/bin/env bash
# Build Orbit for the iOS Simulator *with* Apple Screen Time, no Apple
# Developer account needed: the Simulator accepts locally signed apps ("sign
# to run locally"), so the Family Controls entitlement can be embedded without
# a team. Real iPhones and the App Store still need a paid team.
#
# Usage: npm run ios:sim   (then `npm start` if Metro isn't running)
set -euo pipefail
cd "$(dirname "$0")/.."

# A placeholder team ID switches on the Screen Time plugin and extensions.
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-0000000000}"
export LANG="${LANG:-en_US.UTF-8}"

DEVICE="${SIM_DEVICE:-iPhone 16 Pro}"
UDID=$(xcrun simctl list devices available | grep -m1 "$DEVICE (" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$UDID" ] || { echo "No simulator named '$DEVICE' (set SIM_DEVICE)"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator

npx expo prebuild --platform ios
# Prebuild only installs pods on a clean run; new native modules need this.
(cd ios && pod install)
# Prebuild keeps the project's original folder name, so find it.
WORKSPACE=$(ls -d ios/*.xcworkspace | head -1)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug \
  -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath ios/build \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= \
  PROVISIONING_PROFILE_SPECIFIER= PROVISIONING_PROFILE= \
  build | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || true

# The .app is named after the display name (app.json "name").
APP=$(ls -dt ios/build/Build/Products/Debug-iphonesimulator/*.app 2>/dev/null | head -1)
[ -n "$APP" ] || { echo "Build failed"; exit 1; }
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" com.orbitfriends.app >/dev/null
xcrun simctl openurl "$UDID" "exp+orbit://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
echo "Installed on $DEVICE. Make sure Metro is running: npm start"
