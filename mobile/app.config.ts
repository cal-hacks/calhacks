import type { ConfigContext, ExpoConfig } from "expo/config";

// Google Sign-In's config plugin requires a real iOS client ID, so it is only
// added when one is configured. Without it, the app uses a demo Google flow.
// Get the ID from Google Cloud Console → Credentials → OAuth client (iOS).
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])];
  if (iosClientId) {
    const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace(".apps.googleusercontent.com", "")}`;
    plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme }]);
  }
  return { ...config, name: config.name ?? "Orbit", slug: config.slug ?? "orbit", plugins };
};
