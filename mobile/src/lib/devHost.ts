import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * The Mac running the dev servers, as this device can reach it: the page's
 * host on web, otherwise the host Expo's dev server was opened from (the
 * Mac's LAN IP on a phone, localhost in the Simulator).
 */
export function devHost(): string {
  if (Platform.OS === "web") return window.location.hostname;
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "10.35.126.5:8081"
  return hostUri?.split(":")[0] || "localhost";
}
