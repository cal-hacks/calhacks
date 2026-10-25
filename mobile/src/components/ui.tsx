import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Text, TextInput } from "./Text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import type { User } from "../lib/types";
import { border, hardShadow, radius, useColors, waggle } from "./theme";

// Waggle's base pieces: 2px ink outlines, honey fills for active / chosen,
// and the hard shadow only on primary buttons.

/** Scrollable page. Pass `header` when a native navigation header already covers the safe area. */
export function Screen({ children, title, subtitle, right, header }: { children: ReactNode; title?: string; subtitle?: string; right?: ReactNode; header?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 18, paddingTop: header ? 18 : insets.top + 14, paddingBottom: 40, gap: 16 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {title && (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[s.h1, { color: c.text }]} accessibilityRole="header">{title}</Text>
            {subtitle && <Txt muted>{subtitle}</Txt>}
          </View>
          {right}
        </View>
      )}
      {children}
    </ScrollView>
  );
}

export function Txt({ children, muted, small, bold, style, center }: { children: ReactNode; muted?: boolean; small?: boolean; bold?: boolean; center?: boolean; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return (
    <Text
      style={[
        { color: muted ? c.text2 : c.text, fontSize: small ? 15 : 18, lineHeight: small ? 20 : 24 },
        // Patrick Hand has one weight; "bold" text is a touch larger instead.
        bold && { fontSize: small ? 16 : 19 },
        center && { textAlign: "center" },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function H2({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[s.h2, { color: c.text }]} accessibilityRole="header">{children}</Text>;
}

/** Section label: underlined, like the mockups' "Daily" / "Weekly". */
export function Eyebrow({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[s.eyebrow, { color: c.text }]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>{children}</View>;
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  title,
  onPress,
  variant = "primary",
  small,
  disabled,
  loading,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = { primary: c.accent, secondary: c.surface, ghost: "transparent", danger: c.surface }[variant];
  const fg = { primary: c.text, secondary: c.text, ghost: c.text2, danger: c.danger }[variant];
  const outline = { primary: c.border, secondary: c.border, ghost: "transparent", danger: c.danger }[variant];
  const raised = variant === "primary" && !disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSm,
        { backgroundColor: bg, borderColor: outline, opacity: disabled ? 0.45 : 1 },
        raised && hardShadow,
        // Pressing pushes the button into its shadow.
        raised && pressed && { transform: [{ translateX: 2 }, { translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
        !raised && pressed && { backgroundColor: variant === "ghost" ? "transparent" : c.accentSoft },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Text style={{ color: fg, fontSize: small ? 16 : 20, textDecorationLine: variant === "ghost" ? "underline" : "none" }}>{title}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string; hint?: string }) {
  const c = useColors();
  const { label, hint, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label && <Txt>{label}</Txt>}
      <TextInput
        placeholderTextColor="#8A8578"
        accessibilityLabel={label}
        style={[s.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }, props.multiline && { minHeight: 80, textAlignVertical: "top" }, style]}
        {...rest}
      />
      {hint && <Txt small muted>{hint}</Txt>}
    </View>
  );
}

export function ToggleRow({ label, hint, icon, value, onChange, disabled, last }: { label: string; hint?: string; icon?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; last?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      style={[s.toggleRow, { borderBottomColor: waggle.dividerDashed, borderBottomWidth: last ? 0 : border, opacity: disabled ? 0.45 : 1 }]}
    >
      {icon && <Text style={{ fontSize: 18, width: 26, textAlign: "center" }}>{icon}</Text>}
      <View style={{ flex: 1 }}>
        <Txt>{label}</Txt>
        {hint && <Txt small muted>{hint}</Txt>}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: c.accent, false: c.miss }} ios_backgroundColor={c.miss} />
    </Pressable>
  );
}

export function ToggleList({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[s.toggleList, { borderColor: c.border, backgroundColor: c.surface }]}>{children}</View>;
}

/** Options in one ink outline; the chosen one is honey. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={[s.segmented, { borderColor: c.border, backgroundColor: c.surface }]} accessibilityRole="radiogroup">
      {options.map((o, i) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(o.key);
            }}
            style={[s.segment, i > 0 && { borderLeftWidth: border, borderLeftColor: c.border }, { backgroundColor: active ? c.accent : c.surface }]}
          >
            <Text style={{ color: c.text, fontSize: 16 }} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [s.chip, { borderColor: c.border, backgroundColor: active ? c.accent : pressed ? c.accentSoft : c.surface }]}
    >
      <Text style={{ color: c.text, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

export function Pill({ on, text }: { on: boolean; text: string }) {
  const c = useColors();
  return (
    <View style={[s.pill, { borderColor: c.border, borderStyle: on ? "solid" : "dashed", backgroundColor: on ? c.accent : c.surface }]}>
      <Text style={{ color: on ? c.text : c.text2, fontSize: 15 }}>{on ? "✓ " : ""}{text}</Text>
    </View>
  );
}

export type AvatarTone = "white" | "honey" | "soft";

/** The initial in an ink circle; a photo when the person has one. */
export function Avatar({ user, size = 40, tone = "white" }: { user: Pick<User, "avatar" | "displayName">; size?: number; tone?: AvatarTone }) {
  const c = useColors();
  const { avatar } = user;
  const bg = { white: c.surface, honey: c.accent, soft: c.accentSoft }[tone];
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: border, borderColor: c.border, backgroundColor: bg, alignItems: "center", justifyContent: "center", overflow: "hidden" }}
      accessibilityElementsHidden
    >
      {avatar.imageDataUrl ? (
        <Image source={{ uri: avatar.imageDataUrl }} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ fontSize: size * 0.48, color: c.text }}>{user.displayName.trim().charAt(0).toUpperCase() || "?"}</Text>
      )}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const c = useColors();
  if (!children) return null;
  return <Text style={{ color: c.danger, fontSize: 16 }} accessibilityLiveRegion="polite">{children}</Text>;
}

export function Row({ children, gap = 8, style, wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, wrap && { flexWrap: "wrap" }, style]}>{children}</View>;
}

export const s = StyleSheet.create({
  h1: { fontSize: 36, lineHeight: 40 },
  h2: { fontSize: 24, lineHeight: 28 },
  eyebrow: { fontSize: 19, textDecorationLine: "underline" },
  card: { borderRadius: radius.lg, borderWidth: border, padding: 16, gap: 12 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, paddingVertical: 8, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: border },
  btnSm: { minHeight: 38, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 10 },
  input: { borderWidth: border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, minHeight: 46 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  toggleList: { borderWidth: border, borderRadius: radius.md, overflow: "hidden" },
  segmented: { flexDirection: "row", borderRadius: 10, borderWidth: border, overflow: "hidden" },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 38, paddingHorizontal: 8 },
  chip: { minHeight: 38, justifyContent: "center", paddingVertical: 4, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: border },
  pill: { paddingVertical: 1, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: border, alignSelf: "flex-start" },
});
