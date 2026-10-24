import { Text, View } from "react-native";
import { useColors } from "./theme";

const STEPS = ["Account", "Permissions", "Friends"];

/** Onboarding progress: Account → Permissions → Friends. */
export function Steps({ current }: { current: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }} accessibilityLabel={`Step ${current + 1} of ${STEPS.length}: ${STEPS[current]}`}>
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={label} style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: active ? c.accent : done ? c.goodSoft : c.surface2 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: active ? c.accentInk : done ? c.good : c.text3 }}>
              {done ? "✓ " : ""}
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
