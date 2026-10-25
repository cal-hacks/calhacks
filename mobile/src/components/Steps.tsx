import { View } from "react-native";
import { Text } from "./Text";
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
          <View key={label} style={{ paddingVertical: 1, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: c.border, backgroundColor: active ? c.accent : done ? c.accentSoft : c.surface }}>
            <Text style={{ fontSize: 16, color: active || done ? c.text : c.text2 }}>
              {done ? "✓ " : ""}
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
