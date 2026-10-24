import type { ConfigContext, ExpoConfig } from "expo/config";

// Google Sign-In's config plugin requires a real iOS client ID, so it is only
// added when one is configured. Without it, the app uses a demo Google flow.
// Get the ID from Google Cloud Console → Credentials → OAuth client (iOS).
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// Apple Screen Time (FamilyControls + DeviceActivity) needs a paid Apple
// Developer team to sign its three app extensions, and only runs on a real
// iPhone. Set APPLE_TEAM_ID to turn it on; otherwise Screen Time falls back
// to the iOS Shortcut / screenshot options.
const appleTeamId = process.env.APPLE_TEAM_ID;

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])];
  if (iosClientId) {
    const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace(".apps.googleusercontent.com", "")}`;
    plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme }]);
  }

  const bundleId = config.ios?.bundleIdentifier ?? "com.orbitfriends.app";
  if (appleTeamId) {
    plugins.push(["react-native-device-activity", { appleTeamId, appGroup: `group.${bundleId}` }]);
  }

  return {
    ...config,
    name: config.name ?? "Orbit",
    slug: config.slug ?? "orbit",
    ios: { ...config.ios, ...(appleTeamId ? { appleTeamId } : {}) },
    plugins,
    extra: { ...config.extra, screenTimeNative: !!appleTeamId },
  };
};
