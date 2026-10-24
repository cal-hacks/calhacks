import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import type { User } from "../lib/types";
import { radius, useColors } from "./theme";

/** Scrollable page. Pass `header` when a native navigation header already covers the safe area. */
export function Screen({ children, title, subtitle, right, header }: { children: ReactNode; title?: string; subtitle?: string; right?: ReactNode; header?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 16, paddingTop: header ? 16 : insets.top + 12, paddingBottom: 40, gap: 16 }}
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
        { color: muted ? c.text2 : c.text, fontSize: small ? 13 : 15, lineHeight: small ? 18 : 21 },
        bold && { fontWeight: "600" },
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

export function Eyebrow({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[s.eyebrow, { color: c.text2 }]}>{children}</Text>;
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
  const bg = { primary: c.accent, secondary: c.surface, ghost: "transparent", danger: "transparent" }[variant];
  const fg = { primary: c.accentInk, secondary: c.text, ghost: c.text2, danger: c.danger }[variant];
  const border = { primary: c.accent, secondary: c.border, ghost: "transparent", danger: c.dangerSoft }[variant];
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
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Text style={{ color: fg, fontWeight: "600", fontSize: small ? 13 : 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string; hint?: string }) {
  const c = useColors();
  const { label, hint, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label && <Txt small bold>{label}</Txt>}
      <TextInput
        placeholderTextColor={c.text3}
        accessibilityLabel={label}
        style={[s.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }, props.multiline && { minHeight: 72, textAlignVertical: "top" }, style]}
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
      style={[s.toggleRow, { borderBottomColor: c.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, opacity: disabled ? 0.45 : 1 }]}
    >
      {icon && <Text style={{ fontSize: 18, width: 26, textAlign: "center" }}>{icon}</Text>}
      <View style={{ flex: 1 }}>
        <Txt bold>{label}</Txt>
        {hint && <Txt small muted>{hint}</Txt>}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: c.accent, false: c.miss }} />
    </Pressable>
  );
}

export function ToggleList({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[s.toggleList, { borderColor: c.border, backgroundColor: c.surface }]}>{children}</View>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={[s.segmented, { backgroundColor: c.surface2 }]} accessibilityRole="radiogroup">
      {options.map((o) => {
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
            style={[s.segment, active && { backgroundColor: c.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }]}
          >
            <Text style={{ color: active ? c.text : c.text2, fontWeight: active ? "600" : "500", fontSize: 14 }} numberOfLines={1}>{o.label}</Text>
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
      style={[s.chip, { borderColor: active ? c.accent : c.border, backgroundColor: active ? c.accentSoft : c.surface }]}
    >
      <Text style={{ color: c.text, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

export function Pill({ on, text }: { on: boolean; text: string }) {
  const c = useColors();
  return (
    <View style={[s.pill, { backgroundColor: on ? c.goodSoft : c.surface2 }]}>
      <Text style={{ color: on ? c.good : c.text2, fontSize: 12, fontWeight: "600" }}>{on ? "✓ " : "○ "}{text}</Text>
    </View>
  );
}

export function Avatar({ user, size = 40 }: { user: Pick<User, "avatar" | "displayName">; size?: number }) {
  const { avatar } = user;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatar.imageDataUrl ? undefined : avatar.color, alignItems: "center", justifyContent: "center", overflow: "hidden" }} accessibilityElementsHidden>
      {avatar.imageDataUrl ? (
        <Image source={{ uri: avatar.imageDataUrl }} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ fontSize: size * 0.5 }}>{avatar.emoji}</Text>
      )}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const c = useColors();
  if (!children) return null;
  return <Text style={{ color: c.danger, fontSize: 14 }} accessibilityLiveRegion="polite">{children}</Text>;
}

export function Row({ children, gap = 8, style, wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, wrap && { flexWrap: "wrap" }, style]}>{children}</View>;
}

export const s = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "700", letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: "700" },
  eyebrow: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1 },
  btnSm: { paddingVertical: 7, paddingHorizontal: 12 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  toggleList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: "hidden" },
  segmented: { flexDirection: "row", borderRadius: radius.pill, padding: 3, gap: 2 },
  segment: { flex: 1, alignItems: "center", paddingVertical: 7, paddingHorizontal: 8, borderRadius: radius.pill },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1 },
  pill: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.pill, alignSelf: "flex-start" },
});
